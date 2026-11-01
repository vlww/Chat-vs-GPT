// Twitch chat: token validation/refresh, EventSub WebSocket for chat, and Helix Send Chat Message.
// A dedicated bot account (TWITCH_BOT_*) is used when configured; otherwise each streamer's own sign-in token runs their table.
import WebSocket from 'ws';
import fs from 'node:fs';

type ChatHandler = (channel: string, login: string, displayName: string, text: string) => void;
export type LiveChannel = { channel: string; broadcasterId: string };
export type Tokens = { access: string; refresh: string };

const EVENTSUB_URL = 'wss://eventsub.wss.twitch.tv/ws';
export const CHAT_SCOPES = ['user:read:chat', 'user:write:chat'];

let onChat: ChatHandler = () => {};
let liveChannels: () => LiveChannel[] = () => [];

export function configureTwitch(handlers: { onChat: ChatHandler; liveChannels: () => LiveChannel[] }) {
  onChat = handlers.onChat;
  liveChannels = handlers.liveChannels;
}

function persistEnvValue(key: string, value: string) {
  if (!fs.existsSync('.env')) return;
  const contents = fs.readFileSync('.env', 'utf8');
  const line = new RegExp(`^${key}=.*$`, 'm');
  fs.writeFileSync('.env', line.test(contents) ? contents.replace(line, `${key}=${value}`) : `${contents.trimEnd()}\n${key}=${value}\n`, { mode: 0o600 });
}

// One authenticated chat identity with its own EventSub connection.
class ChatLink {
  private socket: WebSocket | null = null;
  private sessionId = '';
  private ready = false;
  private retry: NodeJS.Timeout | null = null;
  private refreshing: Promise<void> | null = null;
  private waiters: Array<{ resolve: () => void; reject: (error: Error) => void; timer: NodeJS.Timeout }> = [];
  private subscriptions = new Map<string, string>();
  private inflight = new Map<string, Promise<void>>();
  private seen = new Set<string>();
  private sent = new Set<string>();

  constructor(
    public tokens: Tokens,
    public userId: string,
    public login: string,
    private dedicated: boolean,
    private onTokens: (tokens: Tokens) => void = () => {},
  ) {}

  get channels() { return [...this.subscriptions.keys()]; }

  private async refreshAccessToken() {
    if (this.refreshing) return this.refreshing;
    if (!this.tokens.refresh || !process.env.TWITCH_CLIENT_ID || !process.env.TWITCH_CLIENT_SECRET) throw Error('A Twitch refresh token and app secret are required to refresh the chat session.');
    this.refreshing = (async () => {
      const response = await fetch('https://id.twitch.tv/oauth2/token', {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ client_id: process.env.TWITCH_CLIENT_ID!, client_secret: process.env.TWITCH_CLIENT_SECRET!, grant_type: 'refresh_token', refresh_token: this.tokens.refresh }),
      });
      const body = await response.json() as any;
      if (!response.ok || !body.access_token) throw Error(`Twitch token refresh failed (${response.status}).`);
      this.tokens = { access: body.access_token, refresh: body.refresh_token || this.tokens.refresh };
      this.onTokens(this.tokens);
    })().finally(() => { this.refreshing = null; });
    return this.refreshing;
  }

  async helix(endpoint: string, init: RequestInit = {}, retryAuth = true): Promise<Response> {
    if (!this.tokens.access || !process.env.TWITCH_CLIENT_ID) throw Error('Twitch chat credentials are not configured.');
    const headers = new Headers(init.headers);
    headers.set('Authorization', `Bearer ${this.tokens.access}`);
    headers.set('Client-Id', process.env.TWITCH_CLIENT_ID);
    const response = await fetch(`https://api.twitch.tv/helix/${endpoint}`, { ...init, headers });
    if (response.status === 401 && retryAuth && this.tokens.refresh) {
      await this.refreshAccessToken();
      return this.helix(endpoint, init, false);
    }
    return response;
  }

  // Confirms the token belongs to this app and carries the chat scopes; returns the missing scopes.
  async validate(required: string[]) {
    let response = await fetch('https://id.twitch.tv/oauth2/validate', { headers: { Authorization: `OAuth ${this.tokens.access}` } });
    if (response.status === 401 && this.tokens.refresh) {
      await this.refreshAccessToken();
      response = await fetch('https://id.twitch.tv/oauth2/validate', { headers: { Authorization: `OAuth ${this.tokens.access}` } });
    }
    const body = await response.json() as any;
    if (!response.ok) throw Error(`Twitch token validation failed (${response.status}).`);
    if (body.client_id !== process.env.TWITCH_CLIENT_ID) throw Error('The Twitch token belongs to a different Twitch app.');
    this.userId = body.user_id;
    this.login = String(body.login || this.login).toLowerCase();
    return required.filter((scope) => !body.scopes?.includes(scope));
  }

  private settleWaiters(error?: Error) {
    for (const waiter of this.waiters.splice(0)) {
      clearTimeout(waiter.timer);
      if (error) waiter.reject(error); else waiter.resolve();
    }
  }

  private waitForReady(timeoutMs = 9000): Promise<void> {
    if (this.ready && this.sessionId && this.socket?.readyState === WebSocket.OPEN) return Promise.resolve();
    return new Promise((resolve, reject) => {
      const waiter = {
        resolve, reject,
        timer: setTimeout(() => {
          const index = this.waiters.indexOf(waiter);
          if (index >= 0) this.waiters.splice(index, 1);
          reject(Error('Timed out waiting for Twitch chat connection. Please try again.'));
        }, timeoutMs),
      };
      this.waiters.push(waiter);
    });
  }

  private wanted() { return liveChannels().filter((live) => linkFor(live.channel) === this); }

  private connect(url = EVENTSUB_URL) {
    if (!this.tokens.access) return;
    if (url === EVENTSUB_URL && this.socket && (this.socket.readyState === WebSocket.CONNECTING || this.socket.readyState === WebSocket.OPEN)) return;
    const next = new WebSocket(url);
    this.socket = next;
    next.on('message', (raw) => {
      let packet: any;
      try { packet = JSON.parse(raw.toString()); } catch { return; }
      void this.handlePacket(packet);
    });
    next.on('error', (error) => console.error('Twitch EventSub:', error.message));
    next.on('close', () => {
      if (next !== this.socket) return;
      this.ready = false;
      this.sessionId = '';
      this.subscriptions.clear();
      this.settleWaiters(Error('Twitch chat connection closed before it was ready.'));
      if (this.retry) clearTimeout(this.retry);
      this.retry = this.wanted().length ? setTimeout(() => this.connect(), 5000) : null;
    });
  }

  private async handlePacket(packet: any) {
    const type = packet.metadata?.message_type;
    if (type === 'session_welcome') {
      this.sessionId = packet.payload.session.id;
      this.ready = true;
      this.settleWaiters();
      if (this.retry) clearTimeout(this.retry);
      this.retry = null;
      for (const live of this.wanted()) {
        try { await this.subscribe(live); } catch (error) { console.error(`EventSub subscribe #${live.channel}:`, (error as Error).message); }
      }
      return;
    }
    if (type === 'session_reconnect') {
      const reconnectUrl = packet.payload?.session?.reconnect_url;
      if (reconnectUrl) this.connect(reconnectUrl);
      return;
    }
    if (type === 'notification' && packet.metadata?.subscription_type === 'channel.chat.message') {
      const eventId = packet.metadata.message_id;
      if (eventId && this.seen.has(eventId)) return;
      if (eventId) {
        this.seen.add(eventId);
        if (this.seen.size > 2000) this.seen.delete(this.seen.values().next().value!);
      }
      const event = packet.payload?.event;
      const chatter = String(event?.chatter_user_login || '').toLowerCase();
      // Skip the game's own narration: a dedicated bot by name, a streamer's token by sent message id.
      if (this.sent.delete(event?.message_id) || (this.dedicated && chatter === this.login)) return;
      if (typeof event?.message?.text === 'string' && chatter) {
        onChat(String(event.broadcaster_user_login || '').toLowerCase(), chatter, event.chatter_user_name || chatter, event.message.text);
      }
      return;
    }
    if (type === 'revocation') {
      const id = packet.payload?.subscription?.id;
      for (const [channel, subId] of this.subscriptions) if (subId === id) this.subscriptions.delete(channel);
      console.error('Twitch revoked an EventSub subscription:', packet.payload?.subscription?.status || 'unknown');
    }
  }

  async subscribe(live: LiveChannel): Promise<void> {
    if (this.subscriptions.has(live.channel)) return;
    const pending = this.inflight.get(live.channel);
    if (pending) return pending;
    const operation = (async () => {
      if (!this.ready || this.socket?.readyState !== WebSocket.OPEN) this.connect();
      await this.waitForReady();
      const send = async () => {
        const response = await this.helix('eventsub/subscriptions', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ type: 'channel.chat.message', version: '1', condition: { broadcaster_user_id: live.broadcasterId, user_id: this.userId }, transport: { method: 'websocket', session_id: this.sessionId } }),
        });
        const body = await response.json().catch(() => ({})) as any;
        if (response.status !== 202) throw Error(body.message || `Twitch EventSub subscription failed (${response.status}).`);
        this.subscriptions.set(live.channel, body.data?.[0]?.id || '');
        console.log(`EventSub listening to #${live.channel} as ${this.login}.`);
      };
      try {
        await send();
      } catch (error) {
        if (!/session.*(does not exist|disconnected)|session_id.*(invalid|not found)/i.test((error as Error).message)) throw error;
        console.warn('Twitch EventSub session expired; reconnecting before retrying the chat subscription.');
        const stale = this.socket;
        this.socket = null; this.ready = false; this.sessionId = ''; this.subscriptions.clear();
        stale?.close();
        this.connect();
        await this.waitForReady();
        await send();
      }
    })();
    this.inflight.set(live.channel, operation);
    try { await operation; } finally { this.inflight.delete(live.channel); }
  }

  async unsubscribe(channel: string) {
    const id = this.subscriptions.get(channel);
    if (!id) return;
    this.subscriptions.delete(channel);
    try {
      const response = await this.helix(`eventsub/subscriptions?id=${encodeURIComponent(id)}`, { method: 'DELETE' });
      if (!response.ok && response.status !== 404) console.error(`Twitch EventSub unsubscribe failed (${response.status}).`);
    } catch (error) {
      console.error('Twitch EventSub unsubscribe:', (error as Error).message);
    }
    if (!this.subscriptions.size) {
      const stale = this.socket;
      this.socket = null; this.ready = false; this.sessionId = '';
      if (this.retry) clearTimeout(this.retry);
      this.retry = null;
      stale?.close();
    }
  }

  async send(broadcasterId: string, text: string) {
    const response = await this.helix('chat/messages', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ broadcaster_id: broadcasterId, sender_id: this.userId, message: text.replace(/[\r\n]/g, ' ').slice(0, 450) }),
    });
    const body = await response.json().catch(() => ({})) as any;
    const result = body.data?.[0];
    if (result?.message_id) this.sent.add(result.message_id);
    if (!response.ok || result?.is_sent === false) throw Error(result?.drop_reason?.message || body.message || `Twitch chat send failed (${response.status}).`);
  }
}

// ---------- dedicated bot account ----------
const bot = process.env.TWITCH_BOT_OAUTH_TOKEN
  ? new ChatLink(
    { access: process.env.TWITCH_BOT_OAUTH_TOKEN, refresh: process.env.TWITCH_BOT_REFRESH_TOKEN || '' },
    process.env.TWITCH_BOT_USER_ID || '',
    process.env.TWITCH_BOT_USERNAME?.toLowerCase() || '',
    true,
    (tokens) => { persistEnvValue('TWITCH_BOT_OAUTH_TOKEN', tokens.access); persistEnvValue('TWITCH_BOT_REFRESH_TOKEN', tokens.refresh); },
  )
  : null;
let botOk = false;

export const botReady = () => Boolean(bot && botOk);
export const botLogin = () => bot?.login || '';

export async function validateBot() {
  if (!bot) return;
  try {
    const missing = await bot.validate(['user:bot', ...CHAT_SCOPES]);
    if (missing.length) throw Error(`The Twitch bot token is missing scopes: ${missing.join(', ')}.`);
    botOk = true;
  } catch (error) {
    console.error('Twitch bot setup:', (error as Error).message);
  }
}

// ---------- per-channel routing ----------
const links = new Map<string, ChatLink>();
const linkFor = (channel: string) => links.get(channel);

// Connects a channel's chat, through the bot when it is ready or the streamer's own token otherwise.
export async function subscribe(live: LiveChannel & { streamer?: { tokens: Tokens; onTokens: (tokens: Tokens) => void } }) {
  let link: ChatLink;
  if (botReady()) link = bot!;
  else {
    if (!live.streamer?.tokens.access) throw Error('Sign in with Twitch again to give the game chat access.');
    link = new ChatLink(live.streamer.tokens, live.broadcasterId, live.channel, false, live.streamer.onTokens);
    const missing = await link.validate(CHAT_SCOPES);
    if (missing.length) throw Error('Sign in with Twitch again to give the game chat access.');
  }
  links.get(live.channel)?.unsubscribe(live.channel);
  links.set(live.channel, link);
  try {
    await link.subscribe(live);
  } catch (error) {
    links.delete(live.channel);
    throw error;
  }
}

export async function unsubscribe(channel: string) {
  const link = links.get(channel);
  links.delete(channel);
  await link?.unsubscribe(channel);
}

export async function sendChat(channel: string, broadcasterId: string, text: string) {
  const link = links.get(channel);
  if (link && broadcasterId) await link.send(broadcasterId, text);
}
