import { useEffect, useState } from 'react';
import { io, Socket } from 'socket.io-client';

export type Seat = { id: string; index: number; name: string; color: string; alive: boolean; role?: 'human' | 'ai'; owner?: string };
export type RoomMsg = { id: string; seatId?: string; author: string; text: string; at: number; kind: 'say' | 'ask' | 'system' };
export type ChatMsg = { id: string; author: string; text: string; at: number; kind: 'chat' | 'vote' | 'ask' | 'bot' };
export type Phase = 'lobby' | 'talk' | 'vote' | 'reveal' | 'over';
export type Game = {
  channel: string; code: string; mode: 'demo' | 'twitch'; phase: Phase; round: number; prompt: string;
  deadline: number | null; paused: boolean; remaining: number | null;
  settings: { maxSeats: number; talkSeconds: number; voteSeconds: number };
  aiOnline: boolean; minHumans: number;
  lobby: { name: string; verified: boolean }[];
  seats: Seat[]; room: RoomMsg[]; chat: ChatMsg[]; tally: Record<string, number>; voters: number;
  lastReveal?: { seatId: string | null; role: 'human' | 'ai' | null; owner?: string; votes: number; round: number };
  winner?: 'chat' | 'gpt';
  recap?: { aiName: string; aiColor: string; personality: string; objective: string; rounds: number; spotters: string[]; aiVotes: number; firstSuspectedRound: number | null; aiLines: number };
};
export type You = { owner: string; seat: { id: string; name: string; color: string; alive: boolean } | null; voted: string | null } | null;

export const socket: Socket = io(import.meta.env.VITE_SOCKET_ORIGIN || undefined, { autoConnect: true });

export async function request(path: string, body?: unknown) {
  const response = await fetch(path, {
    method: body ? 'POST' : 'GET',
    headers: { 'content-type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
    credentials: 'include',
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw Error(data.error || 'Something went wrong');
  return data;
}

export const tokenKey = (code: string) => `cvg:token:${code.toUpperCase()}`;
export function readToken(code: string) {
  try { return localStorage.getItem(tokenKey(code)) || undefined; } catch { return undefined; }
}
export function saveToken(code: string, token: string) {
  try { localStorage.setItem(tokenKey(code), token); } catch { /* storage unavailable */ }
}

export function useNow(interval = 250) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), interval);
    return () => clearInterval(timer);
  }, [interval]);
  return now;
}

// Subscribes to a table's public state and, when a seat token is known, the private seat assignment.
export function useGame(channel: string | null, token?: string) {
  const [game, setGame] = useState<Game | null>(null);
  const [you, setYou] = useState<You | undefined>(undefined);
  const [missing, setMissing] = useState(false);
  useEffect(() => {
    if (!channel) return;
    const watch = () => socket.emit('watch', { channel, token });
    const onState = (state: Game) => { if (state.channel === channel) { setGame(state); setMissing(false); } };
    const onYou = (seat: You) => setYou(seat);
    request(`/api/state/${channel}`).then(onState).catch(() => setMissing(true));
    socket.on('state', onState);
    socket.on('you', onYou);
    socket.on('connect', watch);
    watch();
    return () => { socket.off('state', onState); socket.off('you', onYou); socket.off('connect', watch); };
  }, [channel, token]);
  return { game, you, missing };
}

export function secondsLeft(game: Game | null, now: number) {
  if (!game) return null;
  if (game.paused && game.remaining !== null) return Math.ceil(game.remaining / 1000);
  return game.deadline ? Math.max(0, Math.ceil((game.deadline - now) / 1000)) : null;
}

export function phaseLength(game: Game) {
  return game.phase === 'talk' ? game.settings.talkSeconds : game.phase === 'vote' ? game.settings.voteSeconds : game.phase === 'reveal' ? 7.5 : 1;
}

export const clock = (seconds: number | null) => seconds === null ? '--:--' : `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
export const joinHost = () => location.host;
