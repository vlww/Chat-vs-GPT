import 'dotenv/config';
import express from 'express';
import { createServer as createHttpServer } from 'node:http';
import { Server } from 'socket.io';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { aiProvider } from './ai.js';
import { configureTwitch, validateBot, botReady, subscribe, unsubscribe, sendChat, CHAT_SCOPES, type Tokens } from './twitch.js';
import {
  games, byCode, configureGame, createGame, join, leave, kick, deal, configure, advance, togglePause, roomSay, seatVote,
  handleChat, publicState, privateSeat, dispose, minHumans, type Game,
} from './game.js';

const app = express();
app.use(express.json());
const server = createHttpServer(app);
const io = new Server(server, { cors: { origin: true, credentials: true } });
const PORT = Number(process.env.PORT || 3000);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// ---------- sessions (Twitch sign-in for streamers and suspects) ----------
type User = { userId: string; login: string; displayName: string; avatar: string };
// Twitch tokens stay server-side; only streamers who host are asked for chat scopes.
const sessions = new Map<string, User & { tokens?: Tokens; scopes?: string[] }>();
const cookieSecret = process.env.SESSION_SECRET || 'development-only-change-me';
const sign = (value: string) => crypto.createHmac('sha256', cookieSecret).update(value).digest('hex');
const secure = process.env.NODE_ENV === 'production';
function cookie(req: express.Request, name: string) {
  const raw = req.headers.cookie?.split('; ').find((x) => x.startsWith(`${name}=`))?.split('=')[1];
  return raw ? decodeURIComponent(raw) : '';
}
function fullSession(req: express.Request) {
  const [id, sig] = cookie(req, 'cvg_session').split('.');
  return id && sig && sign(id) === sig ? sessions.get(id) || null : null;
}
function session(req: express.Request): User | null {
  const s = fullSession(req);
  return s && { userId: s.userId, login: s.login, displayName: s.displayName, avatar: s.avatar };
}
const canHost = (s: ReturnType<typeof fullSession>) => botReady() || Boolean(s?.tokens && CHAT_SCOPES.every((scope) => s.scopes?.includes(scope)));
const canManage = (req: express.Request, g: Game) => g.mode === 'demo' || session(req)?.login === g.channel;
const safeReturn = (value: unknown) => typeof value === 'string' && /^\/(?!\/)[\w\-/]*$/.test(value) ? value : '/';

app.get('/api/health', (_req, res) => res.json({ ok: true }));
app.get('/api/session', (req, res) => res.json({ user: session(req), ai: aiProvider(), twitch: Boolean(process.env.TWITCH_CLIENT_ID && process.env.TWITCH_REDIRECT_URI), canHost: canHost(fullSession(req)) }));

app.get('/auth/twitch', (req, res) => {
  if (!process.env.TWITCH_CLIENT_ID || !process.env.TWITCH_REDIRECT_URI) return res.status(503).send('Twitch sign-in is not configured yet.');
  const state = crypto.randomBytes(24).toString('hex');
  const back = safeReturn(req.query.return);
  const host = req.query.host === '1' && !botReady();
  res.cookie('cvg_oauth_state', `${state}.${sign(state)}.${encodeURIComponent(back)}`, { httpOnly: true, sameSite: 'lax', secure, maxAge: 600000, path: '/' });
  const params = new URLSearchParams({ client_id: process.env.TWITCH_CLIENT_ID, redirect_uri: process.env.TWITCH_REDIRECT_URI, response_type: 'code', state, force_verify: 'true' });
  if (host) params.set('scope', CHAT_SCOPES.join(' '));
  res.redirect(`https://id.twitch.tv/oauth2/authorize?${params}`);
});

app.get('/auth/twitch/callback', async (req, res) => {
  const { code, state } = req.query;
  const [savedState, savedSig, savedReturn] = cookie(req, 'cvg_oauth_state').split('.');
  const back = safeReturn(decodeURIComponent(savedReturn || '/'));
  res.clearCookie('cvg_oauth_state', { path: '/' });
  if (typeof state !== 'string' || typeof code !== 'string' || state !== savedState || !savedSig || sign(state) !== savedSig) return res.redirect(`${back}?twitch_error=state`);
  try {
    const tokenRes = await fetch('https://id.twitch.tv/oauth2/token', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ client_id: process.env.TWITCH_CLIENT_ID!, client_secret: process.env.TWITCH_CLIENT_SECRET!, code, grant_type: 'authorization_code', redirect_uri: process.env.TWITCH_REDIRECT_URI! }),
    });
    const token = await tokenRes.json() as any;
    if (!token.access_token) throw Error('Token exchange failed');
    const userRes = await fetch('https://api.twitch.tv/helix/users', { headers: { 'Client-Id': process.env.TWITCH_CLIENT_ID!, Authorization: `Bearer ${token.access_token}` } });
    const u = (await userRes.json() as any).data?.[0];
    if (!u) throw Error('Could not load Twitch user');
    const id = crypto.randomUUID();
    const scopes: string[] = Array.isArray(token.scope) ? token.scope : [];
    sessions.set(id, { userId: u.id, login: u.login, displayName: u.display_name, avatar: u.profile_image_url, tokens: { access: token.access_token, refresh: token.refresh_token || '' }, scopes });
    res.cookie('cvg_session', `${id}.${sign(id)}`, { httpOnly: true, sameSite: 'lax', secure, maxAge: 86400000, path: '/' });
    res.redirect(back);
  } catch (error) {
    console.error(error);
    res.redirect(`${back}?twitch_error=login`);
  }
});

app.post('/api/logout', (req, res) => {
  sessions.delete(cookie(req, 'cvg_session').split('.')[0]);
  res.clearCookie('cvg_session', { path: '/' });
  res.json({ ok: true });
});

// ---------- hosting ----------
app.post('/api/game/start', async (req, res) => {
  const user = fullSession(req);
  const { mode, settings } = req.body || {};
  if (mode === 'demo') {
    const channel = `demo${crypto.randomInt(100000, 999999)}`;
    const g = createGame(channel, 'demo', { host: 'you' });
    const { token } = join(g, 'you', true);
    return res.json({ channel, code: g.code, token });
  }
  if (mode !== 'twitch') return res.status(400).json({ error: 'Choose demo or live Twitch mode.' });
  if (!user) return res.status(401).json({ error: 'Connect Twitch to host a live game.' });
  if (!aiProvider()) return res.status(503).json({ error: 'Set ANTHROPIC_API_KEY before hosting a live game.' });
  if (!canHost(user)) return res.status(401).json({ error: 'Allow chat access to host a live game.', reauth: true });
  const existing = games.get(user.login);
  if (existing && existing.phase !== 'over' && existing.phase !== 'lobby') return res.status(409).json({ error: 'A game is already running on this channel.', channel: user.login });
  const g = createGame(user.login, 'twitch', { settings, broadcasterId: user.userId, host: user.displayName });
  try {
    await subscribe({ channel: g.channel, broadcasterId: user.userId, streamer: user.tokens && { tokens: user.tokens, onTokens: (tokens) => { user.tokens = tokens; } } });
  } catch (error) {
    dispose(g);
    return res.status(503).json({ error: `Could not connect Twitch chat: ${(error as Error).message}` });
  }
  res.json({ channel: g.channel, code: g.code });
});

app.get('/api/state/:channel', (req, res) => {
  const g = games.get(req.params.channel.toLowerCase());
  if (!g) return res.status(404).json({ error: 'This table is closed.' });
  res.json(publicState(g));
});

function managed(req: express.Request, res: express.Response) {
  const g = games.get(String(req.params.channel).toLowerCase());
  if (!g) { res.status(404).json({ error: 'Game not found' }); return null; }
  if (!canManage(req, g)) { res.status(403).json({ error: 'Only this channel’s streamer can control the game.' }); return null; }
  return g;
}
app.post('/api/game/:channel/deal', (req, res) => {
  const g = managed(req, res);
  if (!g) return;
  if (!deal(g)) return res.status(400).json({ error: `Need at least ${minHumans(g)} suspects to deal.` });
  res.json({ ok: true });
});
app.post('/api/game/:channel/advance', (req, res) => { const g = managed(req, res); if (g) { advance(g); res.json({ ok: true }); } });
app.post('/api/game/:channel/pause', (req, res) => { const g = managed(req, res); if (g) { togglePause(g); res.json({ ok: true }); } });
app.post('/api/game/:channel/settings', (req, res) => { const g = managed(req, res); if (g) { configure(g, req.body || {}); res.json({ ok: true }); } });
app.post('/api/game/:channel/kick', (req, res) => { const g = managed(req, res); if (g) { kick(g, String(req.body?.name || '')); res.json({ ok: true }); } });

// ---------- suspects (the burner phone) ----------
function room(req: express.Request, res: express.Response) {
  const g = byCode(String(req.params.code));
  if (!g) res.status(404).json({ error: 'No table with that code. Check the stream!' });
  return g;
}
app.get('/api/room/:code', (req, res) => { const g = room(req, res); if (g) res.json({ channel: g.channel, phase: g.phase }); });
app.post('/api/room/:code/join', (req, res) => {
  const g = room(req, res);
  if (!g) return;
  const user = session(req);
  const result = join(g, user?.login || String(req.body?.name || ''), Boolean(user), req.body?.token);
  if (result.error) return res.status(400).json({ error: result.error });
  res.json({ channel: g.channel, token: result.token });
});
app.post('/api/room/:code/leave', (req, res) => { const g = room(req, res); if (g) { leave(g, String(req.body?.token || '')); res.json({ ok: true }); } });
app.post('/api/room/:code/say', (req, res) => {
  const g = room(req, res);
  if (!g) return;
  const error = roomSay(g, String(req.body?.token || ''), String(req.body?.text || ''));
  if (error) return res.status(400).json({ error });
  res.json({ ok: true });
});
app.post('/api/room/:code/vote', (req, res) => {
  const g = room(req, res);
  if (!g) return;
  const error = seatVote(g, String(req.body?.token || ''), String(req.body?.seatId || ''));
  if (error) return res.status(400).json({ error });
  res.json({ ok: true });
});

// ---------- realtime ----------
io.on('connection', (socket) => {
  socket.on('watch', (payload: { channel?: string; token?: string } | string) => {
    const { channel, token } = typeof payload === 'string' ? { channel: payload, token: undefined } : payload || {};
    if (typeof channel !== 'string') return;
    const key = channel.toLowerCase();
    for (const joined of socket.rooms) if (joined !== socket.id) socket.leave(joined);
    socket.join(key);
    socket.data.token = typeof token === 'string' ? token : undefined;
    const g = games.get(key);
    if (g) {
      socket.emit('state', publicState(g));
      socket.emit('you', privateSeat(g, socket.data.token));
    }
  });
});

configureGame({
  onChange: (g) => {
    io.to(g.channel).emit('state', publicState(g));
    for (const socketId of io.sockets.adapter.rooms.get(g.channel) || []) {
      const socket = io.sockets.sockets.get(socketId);
      if (socket?.data.token) socket.emit('you', privateSeat(g, socket.data.token));
    }
  },
  narrate: (g, text) => {
    if (g.mode === 'twitch' && g.broadcasterId) sendChat(g.channel, g.broadcasterId, text).catch((error) => console.error('Twitch send:', error.message));
  },
  onEnd: (g) => { if (g.mode === 'twitch') void unsubscribe(g.channel); },
});

configureTwitch({
  onChat: (channel, login, display, text) => {
    const g = games.get(channel);
    if (g && g.mode === 'twitch' && g.phase !== 'over') handleChat(g, login, display, text);
  },
  liveChannels: () => [...games.values()].filter((g) => g.mode === 'twitch' && g.phase !== 'over' && g.broadcasterId).map((g) => ({ channel: g.channel, broadcasterId: g.broadcasterId! })),
});

// ---------- frontend ----------
if (process.env.NODE_ENV === 'production') {
  const dist = path.join(root, 'dist');
  app.use(express.static(dist));
  app.get(/^\/(?!api\/|auth\/|socket\.io\/).*/, (_req, res) => {
    const index = path.join(dist, 'index.html');
    if (fs.existsSync(index)) res.sendFile(index); else res.status(404).send('Frontend not built.');
  });
} else {
  const { createServer: createViteServer } = await import('vite');
  const vite = await createViteServer({ server: { middlewareMode: true, hmr: { server } }, appType: 'spa' });
  app.use(vite.middlewares);
}

void validateBot();
server.listen(PORT, () => console.log(`Chat vs. GPT running on http://localhost:${PORT}`));
