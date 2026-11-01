// Game rules and state. Suspects talk under shuffled codenames; one seat is GPT; Twitch chat is the jury.
import crypto from 'node:crypto';
import { codenames, seatColors, prompts, personalities, objectives, demoHumans, juryNames, juryLines, juryAsks, fallbackLines, promptAnswers } from './content.js';
import { askModel, humanize, impostorSystem, humanSystem, aiProvider } from './ai.js';

export type Phase = 'lobby' | 'talk' | 'vote' | 'reveal' | 'over';
type Role = 'human' | 'ai';
type Seat = {
  id: string; name: string; color: string; role: Role; owner: string; verified: boolean; token?: string;
  style?: string; alive: boolean; nextAt: number; busy: boolean; lastSaid: number;
};
type Joiner = { token: string; owner: string; verified: boolean; style?: string };
type RoomMsg = { id: string; seatId?: string; author: string; text: string; at: number; kind: 'say' | 'ask' | 'system' };
type ChatMsg = { id: string; author: string; text: string; at: number; kind: 'chat' | 'vote' | 'ask' | 'bot' };
type Reveal = { seatId: string | null; role: Role | null; owner?: string; votes: number; round: number };
type Settings = { maxSeats: number; talkSeconds: number; voteSeconds: number };

export type Game = {
  channel: string; code: string; mode: 'demo' | 'twitch'; broadcasterId?: string; host: string;
  phase: Phase; round: number; prompt: string; deadline: number | null; remaining: number | null;
  settings: Settings; joiners: Joiner[]; seats: Seat[]; room: RoomMsg[]; chat: ChatMsg[];
  votes: Record<string, string>; voteLog: { voter: string; target: string; round: number }[];
  secret: { personality: string; objective: string }; lastReveal?: Reveal; winner?: 'chat' | 'gpt';
  phaseTimer?: NodeJS.Timeout; ticker?: NodeJS.Timeout; roundStart: number; pending: NodeJS.Timeout[];
  lastAsk: number; askCooldown: Record<string, number>; touchedAt: number;
  plan: { at: number; run: () => void }[];
};

const REVEAL_MS = 7500;
const pick = <T,>(xs: T[]) => xs[Math.floor(Math.random() * xs.length)];
const shuffle = <T,>(xs: T[]) => xs.map((x) => [Math.random(), x] as const).sort((a, b) => a[0] - b[0]).map(([, x]) => x);
const rand = (min: number, max: number) => min + Math.random() * (max - min);
const id = () => crypto.randomBytes(5).toString('hex');
const clamp = (v: unknown, min: number, max: number, fallback: number) => Number.isFinite(Number(v)) ? Math.max(min, Math.min(max, Math.round(Number(v)))) : fallback;

export const games = new Map<string, Game>();
const codes = new Map<string, string>();

let onChange: (g: Game) => void = () => {};
let narrate: (g: Game, text: string) => void = () => {};
let onEnd: (g: Game) => void = () => {};
export function configureGame(hooks: { onChange: typeof onChange; narrate: typeof narrate; onEnd: typeof onEnd }) {
  onChange = hooks.onChange; narrate = hooks.narrate; onEnd = hooks.onEnd;
}

export const joinUrl = (g: Game) => {
  const origin = process.env.PUBLIC_URL || (process.env.TWITCH_REDIRECT_URI ? new URL(process.env.TWITCH_REDIRECT_URI).origin : 'http://localhost:3000');
  return `${origin.replace(/\/$/, '')}/play/${g.code}`;
};
export const byCode = (code: string) => games.get(codes.get(code.toUpperCase()) || '');
const changed = (g: Game) => { g.touchedAt = Date.now(); onChange(g); };
const humansAlive = (g: Game) => g.seats.filter((s) => s.alive && s.role === 'human');
const aiSeat = (g: Game) => g.seats.find((s) => s.role === 'ai')!;
const isBot = (g: Game, s: Seat) => s.role === 'ai' || Boolean(s.style);

function newCode() {
  const letters = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
  let code = '';
  do code = Array.from({ length: 4 }, () => pick([...letters])).join(''); while (codes.has(code));
  return code;
}

function system(g: Game, text: string, toTwitch = true) {
  g.room.push({ id: id(), author: 'SYSTEM', text, at: Date.now(), kind: 'system' });
  g.room = g.room.slice(-120);
  if (toTwitch) announce(g, text);
}

function announce(g: Game, text: string) {
  pushChat(g, 'chatvsgpt', text, 'bot');
  narrate(g, text);
}

function later(g: Game, ms: number, run: () => void) {
  const timer = setTimeout(() => { g.pending = g.pending.filter((t) => t !== timer); run(); }, ms);
  g.pending.push(timer);
}

export function createGame(channel: string, mode: Game['mode'], options: { settings?: Partial<Settings>; broadcasterId?: string; host: string }) {
  const old = games.get(channel);
  if (old) dispose(old);
  const demo = mode === 'demo';
  const g: Game = {
    channel, code: newCode(), mode, broadcasterId: options.broadcasterId, host: options.host,
    phase: 'lobby', round: 0, prompt: '', deadline: null, remaining: null,
    settings: {
      maxSeats: demo ? 5 : clamp(options.settings?.maxSeats, 2, 8, 6),
      talkSeconds: demo ? 75 : clamp(options.settings?.talkSeconds, 30, 300, 90),
      voteSeconds: demo ? 25 : clamp(options.settings?.voteSeconds, 15, 120, 30),
    },
    joiners: [], seats: [], room: [], chat: [], votes: {}, voteLog: [],
    secret: { personality: pick(personalities), objective: pick(objectives) },
    pending: [], roundStart: 0, lastAsk: 0, askCooldown: {}, touchedAt: Date.now(), plan: [],
  };
  games.set(channel, g);
  codes.set(g.code, channel);
  if (demo) {
    shuffle(demoHumans).slice(0, 4).forEach((npc, index) => later(g, 700 + index * 650, () => {
      g.joiners.push({ token: id(), owner: npc.login, verified: true, style: npc.style });
      changed(g);
    }));
  } else {
    announce(g, `🕵️ CHAT vs GPT is open! Want to be a suspect? Grab a seat at ${joinUrl(g)} (code ${g.code}). Everyone else: you're the jury.`);
  }
  return g;
}

export function dispose(g: Game) {
  if (g.phaseTimer) clearTimeout(g.phaseTimer);
  if (g.ticker) clearInterval(g.ticker);
  g.pending.forEach(clearTimeout);
  g.pending = [];
  codes.delete(g.code);
  games.delete(g.channel);
}

export function join(g: Game, owner: string, verified: boolean, token?: string): { token?: string; error?: string } {
  const existing = token && g.joiners.find((j) => j.token === token);
  if (existing) return { token: existing.token };
  if (g.phase !== 'lobby') return { error: 'This game already started. Catch the next one!' };
  const clean = owner.trim().replace(/^@/, '').slice(0, 25);
  if (!/^[\w]{2,25}$/.test(clean)) return { error: 'Use your Twitch username (letters, numbers, underscores).' };
  if (g.joiners.some((j) => j.owner.toLowerCase() === clean.toLowerCase())) return { error: 'That name already has a seat.' };
  if (g.joiners.length >= g.settings.maxSeats) return { error: 'All seats are taken.' };
  const joiner = { token: crypto.randomBytes(16).toString('hex'), owner: clean, verified };
  g.joiners.push(joiner);
  changed(g);
  return { token: joiner.token };
}

export function configure(g: Game, settings: Partial<Settings>) {
  if (g.phase !== 'lobby' || g.mode === 'demo') return;
  g.settings = {
    maxSeats: Math.max(g.joiners.length, clamp(settings.maxSeats, 2, 8, g.settings.maxSeats)),
    talkSeconds: clamp(settings.talkSeconds, 30, 300, g.settings.talkSeconds),
    voteSeconds: clamp(settings.voteSeconds, 15, 120, g.settings.voteSeconds),
  };
  changed(g);
}

export function leave(g: Game, token: string) {
  if (g.phase !== 'lobby') return;
  g.joiners = g.joiners.filter((j) => j.token !== token);
  changed(g);
}

export function kick(g: Game, owner: string) {
  if (g.phase !== 'lobby') return;
  g.joiners = g.joiners.filter((j) => j.owner !== owner);
  changed(g);
}

export const minHumans = (g: Game) => (g.mode === 'demo' ? 5 : 2);

export function deal(g: Game) {
  if (g.phase !== 'lobby' || g.joiners.length < minHumans(g)) return false;
  const names = shuffle(codenames);
  const seats: Omit<Seat, 'name' | 'color'>[] = [
    ...g.joiners.map((j) => ({ id: id(), role: 'human' as Role, owner: j.owner, verified: j.verified, token: j.token, style: j.style, alive: true, nextAt: 0, busy: false, lastSaid: 0 })),
    { id: id(), role: 'ai', owner: 'GPT', verified: false, alive: true, nextAt: 0, busy: false, lastSaid: 0 },
  ];
  g.seats = shuffle(seats).map((s, index) => ({ ...s, name: names[index], color: seatColors[index % seatColors.length] }));
  const target = pick(g.seats.filter((s) => s.role === 'human'));
  g.secret.objective = g.secret.objective.replace('{target}', target.name);
  g.ticker = setInterval(() => tick(g), 1000);
  startRound(g);
  return true;
}

function setPhase(g: Game, phase: Phase, seconds: number | null) {
  g.phase = phase;
  g.remaining = null;
  g.deadline = seconds === null ? null : Date.now() + seconds * 1000;
  schedule(g);
}

function schedule(g: Game) {
  if (g.phaseTimer) clearTimeout(g.phaseTimer);
  g.phaseTimer = undefined;
  if (!g.deadline) return;
  g.phaseTimer = setTimeout(() => advance(g), Math.max(0, g.deadline - Date.now()));
}

export function advance(g: Game) {
  if (g.phase === 'talk') startVote(g);
  else if (g.phase === 'vote') finishVote(g);
  else if (g.phase === 'reveal') afterReveal(g);
}

function startRound(g: Game) {
  g.round++;
  const used = new Set(g.room.filter((m) => m.kind === 'system').map((m) => m.text));
  g.prompt = pick(prompts.filter((p) => !used.has(`Prompt: ${p}`))) || pick(prompts);
  g.votes = {};
  g.plan = [];
  g.roundStart = Date.now();
  for (const s of g.seats) s.nextAt = Date.now() + rand(4000, 14000);
  setPhase(g, 'talk', g.settings.talkSeconds);
  system(g, `Round ${g.round}. One of these ${g.seats.filter((s) => s.alive).length} suspects is GPT.`, false);
  system(g, `Prompt: ${g.prompt}`, false);
  announce(g, `🔎 Round ${g.round}: the suspects are talking. Grill them with !ask <question>. Voting opens in ${g.settings.talkSeconds}s.`);
  changed(g);
}

function startVote(g: Game) {
  if (g.phase !== 'talk') return;
  setPhase(g, 'vote', g.settings.voteSeconds);
  const window = g.settings.voteSeconds * 1000;
  for (const s of g.seats.filter((seat) => isBot(g, seat))) {
    g.plan.push({ at: Date.now() + rand(2500, window * 0.8), run: () => botVote(g, s) });
  }
  if (g.mode === 'demo') {
    for (const juror of shuffle(juryNames).slice(0, 9)) {
      g.plan.push({ at: Date.now() + rand(1500, window * 0.85), run: () => {
        const target = suspicionPick(g, null, 0.5, 3.5);
        if (target) chatVote(g, juror, target.name, true);
      } });
    }
  }
  system(g, 'Voting is open.', false);
  announce(g, `🗳️ Voting is open for ${g.settings.voteSeconds}s! Type !vote <name>: ${g.seats.filter((s) => s.alive).map((s) => s.name).join(', ')}`);
  changed(g);
}

export function tally(g: Game) {
  const counts: Record<string, number> = {};
  for (const target of Object.values(g.votes)) counts[target] = (counts[target] || 0) + 1;
  return counts;
}

function finishVote(g: Game) {
  if (g.phase !== 'vote') return;
  const counts = tally(g);
  const ranked = Object.entries(counts).sort((a, b) => b[1] - a[1]);
  const [top, second] = ranked;
  const seat = top && (!second || second[1] < top[1]) ? g.seats.find((s) => s.id === top[0]) : undefined;
  for (const [voter, target] of Object.entries(g.votes)) g.voteLog.push({ voter, target, round: g.round });
  if (!seat) {
    g.lastReveal = { seatId: null, role: null, votes: top?.[1] || 0, round: g.round };
    system(g, ranked.length ? 'The vote is tied. Nobody is unmasked.' : 'Nobody voted. Nobody is unmasked.');
  } else {
    seat.alive = false;
    g.lastReveal = { seatId: seat.id, role: seat.role, owner: seat.owner, votes: top[1], round: g.round };
    system(g, seat.role === 'ai'
      ? `${seat.name.toUpperCase()} WAS GPT! 🤖 Chat wins.`
      : `${seat.name.toUpperCase()} was human (@${seat.owner}). GPT is still in the room…`);
  }
  setPhase(g, 'reveal', REVEAL_MS / 1000);
  changed(g);
}

function afterReveal(g: Game) {
  if (g.phase !== 'reveal') return;
  if (g.lastReveal?.role === 'ai') return end(g, 'chat');
  if (humansAlive(g).length <= 1 || g.round >= g.seats.length) return end(g, 'gpt');
  startRound(g);
}

function end(g: Game, winner: 'chat' | 'gpt') {
  g.winner = winner;
  setPhase(g, 'over', null);
  if (g.ticker) clearInterval(g.ticker);
  g.plan = [];
  const ai = aiSeat(g);
  if (winner === 'gpt') system(g, `GPT survived. It was ${ai.name.toUpperCase()} the whole time. 🤖`);
  changed(g);
  onEnd(g);
}

export function togglePause(g: Game) {
  if (!['talk', 'vote', 'reveal'].includes(g.phase)) return;
  if (g.deadline) {
    g.remaining = g.deadline - Date.now();
    g.deadline = null;
    schedule(g);
  } else if (g.remaining !== null) {
    g.deadline = Date.now() + g.remaining;
    g.remaining = null;
    schedule(g);
  }
  changed(g);
}

const paused = (g: Game) => g.remaining !== null;

function tick(g: Game) {
  if (paused(g)) return;
  const now = Date.now();
  const due = g.plan.filter((p) => p.at <= now);
  g.plan = g.plan.filter((p) => p.at > now);
  due.forEach((p) => p.run());
  if (g.phase !== 'talk') return;
  const ready = g.seats.filter((s) => s.alive && isBot(g, s) && !s.busy && s.nextAt <= now);
  if (ready.length) void botSpeak(g, pick(ready));
  if (g.mode === 'demo') juryTick(g);
}

function mentions(text: string, name: string) {
  return new RegExp(`\\b${name}\\b`, 'i').test(text);
}

function nudge(g: Game, text: string, from?: string) {
  const now = Date.now();
  for (const s of g.seats) {
    if (!s.alive || !isBot(g, s) || s.id === from) continue;
    if (mentions(text, s.name)) s.nextAt = Math.min(s.nextAt, now + rand(1200, 3500));
  }
}

export function roomSay(g: Game, token: string, text: string): string | null {
  const seat = g.seats.find((s) => s.token === token);
  if (!seat) return 'You do not have a seat in this game.';
  if (!seat.alive) return 'You were unmasked. You can still vote!';
  if (g.phase !== 'talk') return 'The room only talks during discussion.';
  const clean = text.replace(/[\r\n]+/g, ' ').trim().slice(0, 200);
  if (!clean) return null;
  if (Date.now() - seat.lastSaid < 900) return 'Slow down a little.';
  post(g, seat, clean);
  return null;
}

function post(g: Game, seat: Seat, text: string) {
  seat.lastSaid = Date.now();
  g.room.push({ id: id(), seatId: seat.id, author: seat.name, text, at: Date.now(), kind: 'say' });
  g.room = g.room.slice(-120);
  nudge(g, text, seat.id);
  changed(g);
}

function roomAsk(g: Game, author: string, question: string) {
  g.room.push({ id: id(), author, text: question, at: Date.now(), kind: 'ask' });
  g.room = g.room.slice(-120);
  g.lastAsk = Date.now();
  // Every bot seat has the same chance to pick up a question, so answering speed is not a tell.
  for (const s of g.seats) if (s.alive && isBot(g, s) && Math.random() < 0.5) s.nextAt = Math.min(s.nextAt, Date.now() + rand(2000, 6000));
}

function transcript(g: Game, self: Seat) {
  return g.room.slice(-22).map((m) => {
    if (m.kind === 'system') return `[game] ${m.text}`;
    if (m.kind === 'ask') return `[twitch chat asks the room] ${m.author}: ${m.text}`;
    return `${m.author}${m.seatId === self.id ? ' (you)' : ''}: ${m.text}`;
  }).join('\n');
}

async function botSpeak(g: Game, seat: Seat) {
  seat.busy = true;
  const round = g.round;
  try {
    const others = g.seats.filter((s) => s.alive && s.id !== seat.id);
    let line: string | null = null;
    const answered = g.room.some((m) => m.seatId === seat.id && m.at > g.roundStart);
    if (aiProvider()) {
      const out = g.seats.filter((s) => !s.alive).map((s) => `${s.name} (${s.role === 'ai' ? 'GPT' : 'human'})`).join(', ') || 'nobody yet';
      const prompt = `Round ${g.round}. Room prompt: "${g.prompt}"
Suspects still in: ${g.seats.filter((s) => s.alive).map((s) => s.id === seat.id ? `${s.name} (you)` : s.name).join(', ')}
Unmasked so far: ${out}
Room so far (oldest first):
${transcript(g, seat) || '(silence)'}
${answered ? '' : 'You have not answered the prompt yet this round.'}
Send a message now?`;
      const system = seat.role === 'ai'
        ? impostorSystem(seat.name, g.secret.personality, g.secret.objective)
        : humanSystem(seat.name, seat.owner, seat.style || 'casual');
      try {
        const turn = await askModel(system, prompt);
        line = turn?.speak ? humanize(turn.message) : null;
        if (!turn?.speak) { seat.nextAt = Date.now() + rand(4000, 9000); return; }
      } catch (error) {
        console.error('Model turn failed:', (error as Error).message);
      }
    }
    if (!line) {
      const [x, y] = shuffle(others);
      const said = new Set(g.room.map((m) => m.text));
      const answers = (promptAnswers[g.prompt] || []).filter((a) => !said.has(a));
      line = !answered && answers.length ? pick(answers) : pick(fallbackLines).replace('{x}', x?.name || 'someone').replace('{y}', y?.name || x?.name || 'someone');
    }
    // Simulate typing time so instant replies never give the bot away.
    await new Promise((resolve) => setTimeout(resolve, Math.min(4500, 700 + line!.length * rand(35, 60))));
    if (g.phase === 'talk' && g.round === round && seat.alive && games.get(g.channel) === g) post(g, seat, line);
    seat.nextAt = Date.now() + rand(7000, 16000);
  } finally {
    seat.busy = false;
  }
}

// Scores suspects by how often the room and chat have called them out this round.
function suspicionPick(g: Game, voter: Seat | null, aiBias: number, noise = 2.2) {
  const since = Date.now() - (g.settings.talkSeconds + g.settings.voteSeconds) * 1000;
  const recent = g.room.filter((m) => m.at > since && m.kind === 'say' && m.seatId !== voter?.id);
  const candidates = g.seats.filter((s) => s.alive && s.id !== voter?.id && !(voter?.role === 'ai' && s.role === 'ai'));
  let best: Seat | undefined; let bestScore = -1;
  for (const s of candidates) {
    let score = Math.min(3, recent.filter((m) => mentions(m.text, s.name)).length) * 0.45 + rand(0, noise);
    if (s.role === 'ai') score += aiBias;
    if (voter?.role === 'ai' && g.secret.objective.includes(s.name)) score += 1;
    if (score > bestScore) { best = s; bestScore = score; }
  }
  return best;
}

function botVote(g: Game, seat: Seat) {
  if (g.phase !== 'vote') return;
  const target = suspicionPick(g, seat, seat.role === 'ai' ? 0 : 0.6);
  if (target) g.votes[voterKey(seat)] = target.id;
  changed(g);
}

function juryTick(g: Game) {
  const alive = g.seats.filter((s) => s.alive);
  if (Math.random() < 0.2) {
    pushChat(g, pick(juryNames), pick(juryLines).replace('{x}', pick(alive).name), 'chat');
  }
  if (Math.random() < 0.05 && Date.now() - g.lastAsk > 15000) {
    const author = pick(juryNames);
    const question = pick(juryAsks);
    pushChat(g, author, `!ask ${question}`, 'ask');
    roomAsk(g, author, question);
  }
  changed(g);
}

function pushChat(g: Game, author: string, text: string, kind: ChatMsg['kind']) {
  g.chat.push({ id: id(), author, text, at: Date.now(), kind });
  g.chat = g.chat.slice(-60);
}

const voterKey = (seat: Seat) => (seat.verified ? `u:${seat.owner.toLowerCase()}` : `s:${seat.id}`);

function findSeat(g: Game, input: string) {
  const query = input.trim().replace(/^@/, '').toLowerCase();
  const alive = g.seats.filter((s) => s.alive);
  const number = Number(query);
  if (Number.isInteger(number) && number >= 1 && number <= g.seats.length) {
    const seat = g.seats[number - 1];
    return seat.alive ? seat : undefined;
  }
  if (query.length < 2) return undefined;
  const matches = alive.filter((s) => s.name.startsWith(query));
  return matches.length === 1 ? matches[0] : alive.find((s) => s.name === query);
}

function chatVote(g: Game, login: string, input: string, echo: boolean) {
  if (g.phase !== 'vote') return;
  const target = findSeat(g, input);
  if (!target) return;
  const seatOwned = g.seats.find((s) => s.verified && s.owner.toLowerCase() === login.toLowerCase());
  if (seatOwned?.id === target.id) return;
  g.votes[`u:${login.toLowerCase()}`] = target.id;
  if (echo) pushChat(g, login, `!vote ${target.name}`, 'vote');
  changed(g);
}

export function seatVote(g: Game, token: string, seatId: string): string | null {
  const seat = g.seats.find((s) => s.token === token);
  if (!seat) return 'You do not have a seat in this game.';
  if (g.phase !== 'vote') return 'Voting is not open.';
  const target = g.seats.find((s) => s.id === seatId && s.alive);
  if (!target || target.id === seat.id) return 'Pick another suspect.';
  g.votes[voterKey(seat)] = target.id;
  changed(g);
  return null;
}

export function handleChat(g: Game, login: string, display: string, text: string) {
  const command = text.trim().match(/^!(vote|v|ask|join|help|suspects)\b\s*(.*)$/i);
  if (!command) {
    pushChat(g, display, text.slice(0, 200), 'chat');
    changed(g);
    return;
  }
  const [, raw, arg] = command;
  const action = raw.toLowerCase();
  if (action === 'vote' || action === 'v') {
    pushChat(g, display, text.slice(0, 60), 'vote');
    return chatVote(g, login, arg, false);
  }
  if (action === 'ask') {
    const question = arg.trim().slice(0, 140);
    if (g.phase !== 'talk' || !question) return;
    if (Date.now() - (g.askCooldown[login] || 0) < 20000 || Date.now() - g.lastAsk < 6000) return;
    g.askCooldown[login] = Date.now();
    pushChat(g, display, text.slice(0, 160), 'ask');
    roomAsk(g, display, question);
    changed(g);
    return;
  }
  if (action === 'join') { announce(g, g.phase === 'lobby' ? `@${display} grab a seat at ${joinUrl(g)} (code ${g.code})` : `@${display} this round already started. You're on the jury: !vote <name>`); return changed(g); }
  if (action === 'suspects') { announce(g, g.phase === 'lobby' ? `${g.joiners.length} suspects seated so far.` : `Suspects: ${g.seats.filter((s) => s.alive).map((s) => s.name).join(', ')}`); return changed(g); }
  if (action === 'help') { announce(g, 'CHAT vs GPT: one suspect is secretly GPT. !ask <question> to grill them, !vote <name> when voting opens. Want to be a suspect? !join'); return changed(g); }
}

export function publicState(g: Game) {
  const over = g.phase === 'over';
  const seatIndex = (seatId?: string | null) => g.seats.findIndex((s) => s.id === seatId);
  return {
    channel: g.channel, code: g.code, mode: g.mode, phase: g.phase, round: g.round, prompt: g.prompt,
    deadline: g.deadline, paused: paused(g), remaining: g.remaining, settings: g.settings,
    aiOnline: Boolean(aiProvider()), minHumans: minHumans(g),
    lobby: g.joiners.map((j) => ({ name: j.owner, verified: j.verified })),
    seats: g.seats.map((s, index) => ({
      id: s.id, index, name: s.name, color: s.color, alive: s.alive,
      ...(over || !s.alive ? { role: s.role, owner: s.owner } : {}),
    })),
    room: g.room.slice(-60).map(({ id, seatId, author, text, at, kind }) => ({ id, seatId, author, text, at, kind })),
    chat: g.chat.slice(-40),
    tally: g.phase === 'vote' || g.phase === 'reveal' ? tally(g) : {},
    voters: Object.keys(g.votes).length,
    lastReveal: g.phase === 'reveal' || over ? g.lastReveal : undefined,
    winner: g.winner,
    recap: over ? recap(g) : undefined,
    revealIndex: g.lastReveal ? seatIndex(g.lastReveal.seatId) : -1,
  };
}

function recap(g: Game) {
  const ai = aiSeat(g);
  const spotted = g.voteLog.filter((v) => v.target === ai.id && v.voter.startsWith('u:')).map((v) => v.voter.slice(2));
  const firstRound = g.voteLog.find((v) => v.target === ai.id)?.round || null;
  return {
    aiName: ai.name, aiColor: ai.color, personality: g.secret.personality, objective: g.secret.objective, rounds: g.round,
    spotters: [...new Set(spotted)].slice(0, 8), aiVotes: g.voteLog.filter((v) => v.target === ai.id).length,
    firstSuspectedRound: firstRound, aiLines: g.room.filter((m) => m.seatId === ai.id).length,
  };
}

export function privateSeat(g: Game, token?: string) {
  if (!token) return null;
  const joiner = g.joiners.find((j) => j.token === token);
  if (!joiner) return null;
  const seat = g.seats.find((s) => s.token === token);
  const voted = seat ? g.votes[voterKey(seat)] || null : null;
  return { owner: joiner.owner, seat: seat ? { id: seat.id, name: seat.name, color: seat.color, alive: seat.alive } : null, voted };
}

// Free memory for finished or abandoned rooms.
setInterval(() => {
  for (const g of games.values()) {
    const idle = Date.now() - g.touchedAt;
    if (idle > 45 * 60_000 || (g.phase === 'over' && idle > 20 * 60_000)) dispose(g);
  }
}, 60_000).unref();
