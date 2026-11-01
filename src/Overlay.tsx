import React, { useEffect } from 'react';
import { Avatar } from './ui';
import { clock, joinHost, secondsLeft, useGame, useNow } from './lib';

// Transparent browser source for OBS: compact HUD, suspects, the latest lines and the unmasking.
export function Overlay({ channel }: { channel: string }) {
  const { game } = useGame(channel);
  const now = useNow();
  useEffect(() => {
    document.documentElement.classList.add('overlay-page');
    return () => document.documentElement.classList.remove('overlay-page');
  }, []);
  if (!game) return null;
  const seconds = secondsLeft(game, now);
  const reveal = game.phase === 'reveal' ? game.lastReveal : undefined;
  const revealed = reveal && game.seats.find((s) => s.id === reveal.seatId);
  const lines = game.room.filter((m) => m.kind !== 'system').slice(-4);
  const total = Object.values(game.tally).reduce((a, b) => a + b, 0) || 1;
  return <div className="ov">
    <div className="ov-hud">
      <span className="ov-logo">CHAT <i>vs</i> <b>GPT</b></span>
      {game.phase === 'lobby' ? <span className="ov-join">Grab a seat: <b>{joinHost()}/play</b> · code <b>{game.code}</b></span>
        : <span className="ov-phase">{game.phase === 'vote' ? 'Type !vote name' : game.phase === 'talk' ? `Round ${game.round} · !ask a question` : game.phase === 'over' ? (game.winner === 'chat' ? 'Chat wins' : 'GPT wins') : 'Unmasking…'}</span>}
      {game.phase !== 'lobby' && game.phase !== 'over' && <b className="ov-clock">{clock(seconds)}</b>}
    </div>
    {game.phase !== 'lobby' && <div className="ov-seats">{game.seats.map((s) => <div key={s.id} className={`ov-seat ${s.alive ? '' : 'ov-out'}`} style={{ '--seat': s.color } as React.CSSProperties}>
      <Avatar color={s.color} size={30} index={s.index} dead={!s.alive && s.role === 'human'} robot={!s.alive && s.role === 'ai'} />
      <span>{s.name}</span>
      {game.phase === 'vote' && s.alive && <i style={{ width: `${((game.tally[s.id] || 0) / total) * 100}%` }} />}
    </div>)}</div>}
    {game.phase === 'talk' && <div className="ov-lines">
      <p className="ov-prompt">{game.prompt}</p>
      {lines.map((m) => {
        const s = game.seats.find((x) => x.id === m.seatId);
        return <p key={m.id}>{m.kind === 'ask' ? <b className="ov-ask">{m.author} asks</b> : <b style={{ color: s?.color }}>{m.author}</b>} {m.text}</p>;
      })}
    </div>}
    {revealed && <div className={`ov-reveal ${reveal!.role === 'ai' ? 'ov-gpt' : ''}`}>
      <Avatar color={revealed.color} size={72} index={revealed.index} robot={reveal!.role === 'ai'} dead={reveal!.role === 'human'} />
      <b>{revealed.name}</b>
      <span className={`stamp ${reveal!.role === 'ai' ? 'stamp-gpt' : 'stamp-human'}`}>{reveal!.role === 'ai' ? 'WAS GPT' : `HUMAN · @${reveal!.owner}`}</span>
    </div>}
    {reveal && !revealed && <div className="ov-reveal"><b>Tie vote</b><span>Nobody leaves</span></div>}
  </div>;
}
