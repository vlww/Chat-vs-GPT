import React, { useEffect, useState } from 'react';
import { Avatar, Logo, TwitchGlyph } from './ui';
import { clock, readToken, request, saveToken, secondsLeft, useGame, useNow } from './lib';
import { Composer, RoomFeed } from './Host';

function JoinForm({ code: initial, onJoined }: { code: string; onJoined: (code: string, channel: string, token: string) => void }) {
  const [code, setCode] = useState(initial);
  const [name, setName] = useState('');
  const [user, setUser] = useState<{ login: string; displayName: string } | null>(null);
  const [twitch, setTwitch] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    request('/api/session').then((d) => { setUser(d.user); setTwitch(d.twitch); }).catch(() => {});
    if (new URLSearchParams(location.search).has('twitch_error')) setError('Twitch sign-in did not finish. Try again or type your name.');
  }, []);
  async function submit(event?: React.FormEvent) {
    event?.preventDefault();
    const clean = code.trim().toUpperCase();
    if (clean.length !== 4) return setError('Room codes are 4 letters. Check the stream!');
    setBusy(true); setError('');
    try {
      const data = await request(`/api/room/${clean}/join`, { name, token: readToken(clean) });
      saveToken(clean, data.token);
      onJoined(clean, data.channel, data.token);
    } catch (cause) { setError((cause as Error).message); } finally { setBusy(false); }
  }
  return <form className="phone-card join-form" onSubmit={submit}>
    <div className="join-faces">{['#b5484b', '#8fb3c9', '#e8b04a', '#ff8a3d'].map((c, i) => <Avatar key={c} color={c} size={44} index={i} />)}<Avatar color="" hidden size={44} /></div>
    <h1>Grab a seat</h1>
    <p className="muted">One of the suspects is GPT. Prove you aren't.</p>
    <label>Room code<input className="code-input" value={code} onChange={(e) => setCode(e.target.value.toUpperCase().slice(0, 4))} placeholder="ABCD" autoCapitalize="characters" autoComplete="off" /></label>
    {user ? <p className="signed-in">Joining as <b>{user.displayName}</b></p> : <>
      {twitch && <a className="btn btn-twitch btn-wide" href={`/auth/twitch?return=${encodeURIComponent(`/play/${code || ''}`)}`}><TwitchGlyph /> Sign in with Twitch</a>}
      <label>{twitch ? 'or your Twitch name' : 'Your Twitch name'}<input value={name} onChange={(e) => setName(e.target.value)} placeholder="username" autoComplete="off" /></label>
    </>}
    <button className="btn btn-lime btn-wide" disabled={busy}>Take my seat →</button>
    {error && <p className="form-error">{error}</p>}
  </form>;
}

export function Play({ code: initial }: { code: string }) {
  const [code, setCode] = useState(initial.toUpperCase());
  const [channel, setChannel] = useState<string | null>(null);
  const [token, setToken] = useState<string | undefined>(() => (initial ? readToken(initial) : undefined));
  const [seen, setSeen] = useState(false);
  const [error, setError] = useState('');
  const { game, you, missing } = useGame(channel, token);
  const now = useNow();

  useEffect(() => {
    if (!code || !token) return;
    request(`/api/room/${code}`).then((d) => setChannel(d.channel)).catch(() => { setToken(undefined); });
  }, [code, token]);

  if (!token || !channel || missing) {
    return <main className="phone"><header className="phone-head"><Logo small /></header>
      <JoinForm code={code} onJoined={(c, ch, t) => { setCode(c); setToken(t); setChannel(ch); history.replaceState({}, '', `/play/${c}`); }} />
    </main>;
  }
  if (!game) return <main className="phone center-screen"><p>Finding your seat…</p></main>;
  if (you === null && game.phase !== 'lobby') {
    return <main className="phone center-screen"><Logo /><p>This game started without you. You can still vote from Twitch chat with <code>!vote name</code>.</p></main>;
  }

  const seat = you?.seat;
  const seconds = secondsLeft(game, now);
  async function vote(seatId: string) {
    try { await request(`/api/room/${code}/vote`, { token, seatId }); setError(''); } catch (cause) { setError((cause as Error).message); }
  }
  async function leave() {
    await request(`/api/room/${code}/leave`, { token }).catch(() => {});
    setToken(undefined); setChannel(null);
  }

  if (game.phase === 'lobby') {
    return <main className="phone"><header className="phone-head"><Logo small /><span className="phase-chip chip-lobby">Seated</span></header>
      <div className="phone-card waiting">
        <Avatar color="" hidden size={96} />
        <h1>You're in, {you?.owner}</h1>
        <p className="muted">{game.lobby.length} suspect{game.lobby.length === 1 ? '' : 's'} seated. You'll get your codename when the host deals.</p>
        <div className="waiting-dots"><i /><i /><i /></div>
        <button className="btn btn-ghost btn-sm" onClick={leave}>Leave seat</button>
      </div>
    </main>;
  }

  if (seat && !seen && game.phase === 'talk' && game.round === 1) {
    return <main className="phone center-screen codename-reveal" onClick={() => setSeen(true)}>
      <small>Your codename</small>
      <Avatar color={seat.color} size={140} index={0} />
      <b style={{ color: seat.color }}>{seat.name.toUpperCase()}</b>
      <p>Nobody knows it's you. Chat on this screen, answer the questions, and don't get voted out.</p>
      <button className="btn btn-lime" onClick={() => setSeen(true)}>Got it →</button>
    </main>;
  }

  const over = game.phase === 'over';
  return <main className={`phone phone-game phase-${game.phase}`}>
    <header className="phone-head">
      {seat && <div className="me"><Avatar color={seat.color} size={34} index={0} dead={!seat.alive} /><b style={{ color: seat.color }}>{seat.name}</b></div>}
      <span className={`phase-chip chip-${game.phase}`}>{game.phase === 'talk' ? 'Talk' : game.phase === 'vote' ? 'Vote' : game.phase === 'reveal' ? 'Reveal' : 'Over'}</span>
      <b className="phone-clock">{over ? '' : clock(seconds)}</b>
    </header>

    {game.phase === 'talk' && <div className="phone-prompt"><span className="eyebrow">Round {game.round}</span>{game.prompt}</div>}
    {seat && !seat.alive && !over && <div className="phone-banner">You were unmasked as human. You can still vote.</div>}

    {(game.phase === 'vote' || game.phase === 'reveal') && <div className="phone-vote">
      <span className="eyebrow">{game.phase === 'vote' ? 'Who is GPT? Tap to vote' : 'Votes are in'}</span>
      <div className="vote-grid">{game.seats.filter((s) => s.alive).map((s) => {
        const mine = s.id === seat?.id;
        return <button key={s.id} disabled={mine || game.phase !== 'vote'} className={`vote-pick ${you?.voted === s.id ? 'picked' : ''}`} style={{ '--seat': s.color } as React.CSSProperties} onClick={() => vote(s.id)}>
          <Avatar color={s.color} size={44} index={s.index} /><b>{s.name}</b>{mine ? <small>you</small> : <small>{game.tally[s.id] || 0} votes</small>}
        </button>;
      })}</div>
    </div>}

    {over && <div className="phone-card">
      <h1>{game.winner === 'chat' ? 'Chat wins' : 'GPT wins'}</h1>
      <p className="muted">{game.recap?.aiName} was GPT.</p>
      <a className="btn btn-lime" href="/">Done</a>
    </div>}

    {!over && game.phase !== 'vote' && <RoomFeed game={game} youSeat={seat?.id} />}
    {!over && seat && game.phase === 'talk' && <Composer code={code} token={token} disabled={!seat.alive} placeholder={seat.alive ? 'Say something human…' : 'You were unmasked'} />}
    {error && <div className="toast" role="alert">{error}<button onClick={() => setError('')} aria-label="Dismiss">×</button></div>}
  </main>;
}
