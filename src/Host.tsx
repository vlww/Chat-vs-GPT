import React, { useEffect, useRef, useState } from 'react';
import { Avatar, Logo, Meter, Qr } from './ui';
import { clock, Game, joinHost, phaseLength, readToken, request, saveToken, secondsLeft, Seat, useGame, useNow, You } from './lib';

const phaseLabel: Record<string, string> = { lobby: 'Seats open', talk: 'Interrogation', vote: 'Chat is voting', reveal: 'Unmasking', over: 'Case closed' };

export function useAutoScroll(dep: unknown) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => { ref.current?.scrollTo({ top: ref.current.scrollHeight, behavior: 'smooth' }); }, [dep]);
  return ref;
}

export function RoomFeed({ game, youSeat }: { game: Game; youSeat?: string }) {
  const ref = useAutoScroll(game.room.length);
  const seat = (id?: string) => game.seats.find((s) => s.id === id);
  return <div className="feed" ref={ref}>
    {game.room.map((m) => {
      if (m.kind === 'system') return <div key={m.id} className={`feed-system ${m.text.startsWith('Prompt:') ? 'feed-prompt' : ''}`}>{m.text.replace(/^Prompt: /, '')}</div>;
      if (m.kind === 'ask') return <div key={m.id} className="feed-ask"><span>💬 {m.author} asks</span>{m.text}</div>;
      const s = seat(m.seatId);
      return <div key={m.id} className={`bubble ${m.seatId === youSeat ? 'bubble-you' : ''}`}>
        {s && <Avatar color={s.color} size={30} index={s.index} robot={s.role === 'ai' && !s.alive} />}
        <div><b style={{ color: s?.color }}>{m.author}{m.seatId === youSeat ? ' (you)' : ''}</b><p>{m.text}</p></div>
      </div>;
    })}
    {!game.room.length && <div className="feed-empty">The room is quiet… for now.</div>}
  </div>;
}

function ChatFeed({ game }: { game: Game }) {
  const ref = useAutoScroll(game.chat.length);
  return <div className="chat-col">
    <div className="col-title"><span className="live-dot" /> {game.mode === 'demo' ? 'Simulated chat' : 'Twitch chat'}</div>
    <div className="chat-feed" ref={ref}>
      {game.chat.map((m) => <p key={m.id} className={`chat-line chat-${m.kind}`}><b>{m.author}</b> {m.text}</p>)}
      {!game.chat.length && <p className="feed-empty">Chat plays with <code>!ask</code> and <code>!vote</code></p>}
    </div>
  </div>;
}

function SuspectCard({ game, seat, now, youSeat, voted, onVote }: { game: Game; seat: Seat; now: number; youSeat?: string; voted?: string | null; onVote?: (id: string) => void }) {
  const last = [...game.room].reverse().find((m) => m.seatId === seat.id);
  const fresh = last && now - last.at < 7000;
  const votes = game.tally[seat.id] || 0;
  const total = Object.values(game.tally).reduce((a, b) => a + b, 0) || 1;
  const voting = game.phase === 'vote' && seat.alive;
  const canVote = voting && onVote && youSeat && seat.id !== youSeat;
  const revealedAi = !seat.alive && seat.role === 'ai';
  return <button
    className={`suspect ${!seat.alive ? 'suspect-out' : ''} ${revealedAi ? 'suspect-gpt' : ''} ${voted === seat.id ? 'suspect-picked' : ''} ${canVote ? 'suspect-votable' : ''}`}
    style={{ '--seat': seat.color } as React.CSSProperties}
    onClick={() => canVote && onVote!(seat.id)}
    disabled={!canVote}
    aria-label={canVote ? `Vote for ${seat.name}` : seat.name}
  >
    <span className="suspect-num">{seat.index + 1}</span>
    {seat.id === youSeat && <span className="you-tag">YOU</span>}
    <Avatar color={seat.color} size={64} index={seat.index} dead={!seat.alive && seat.role === 'human'} robot={revealedAi} talking={Boolean(fresh)} />
    <b>{seat.name}</b>
    {!seat.alive && <span className={`stamp ${seat.role === 'ai' ? 'stamp-gpt' : 'stamp-human'}`}>{seat.role === 'ai' ? 'GPT' : `@${seat.owner}`}</span>}
    {seat.alive && game.phase === 'talk' && fresh && <span className="speech">{last!.text}</span>}
    {(game.phase === 'vote' || game.phase === 'reveal') && seat.alive && <span className="votebar"><i style={{ width: `${(votes / total) * 100}%` }} /><em>{votes}</em></span>}
  </button>;
}

const options = { maxSeats: [3, 4, 5, 6, 8], talkSeconds: [60, 90, 120, 180], voteSeconds: [20, 30, 45] };
const optionLabel = { maxSeats: 'Seats', talkSeconds: 'Talk', voteSeconds: 'Vote' };

function Lobby({ game, isHost, onDeal, busy, act }: { game: Game; isHost: boolean; onDeal: () => void; busy: boolean; act: (path: string, body?: unknown) => void }) {
  const url = `${location.origin}/play/${game.code}`;
  const slots = Array.from({ length: game.settings.maxSeats }, (_, i) => game.lobby[i]);
  const ready = game.lobby.length >= game.minHumans;
  return <div className="lobby">
    {game.mode === 'demo' ? <div className="join-card demo-card">
      <span className="eyebrow">Practice room</span>
      <h2>You're a suspect</h2>
      <p>Four simulated viewers are taking seats next to you, and GPT gets one more. Simulated chat plays the jury.</p>
      <ol className="demo-rules">
        <li><span>1</span>Answer the prompt like a human would</li>
        <li><span>2</span>Read the room and figure out who's off</li>
        <li><span>3</span>Tap a suspect to vote when voting opens</li>
      </ol>
    </div> : <div className="join-card">
      <span className="eyebrow">Want to be a suspect?</span>
      <h2>Grab a seat</h2>
      <div className="join-row">
        <Qr value={url} />
        <div>
          <span className="join-url">{joinHost()}/play</span>
          <div className="code">{game.code.split('').map((c, i) => <span key={i}>{c}</span>)}</div>
          <span className="join-hint">Or type <code>!join</code> in chat</span>
        </div>
      </div>
    </div>}
    <div className="seat-list">
      <div className="seat-list-head"><span className="eyebrow">At the table</span><b>{game.lobby.length}<i>/{game.settings.maxSeats}</i></b></div>
      <div className="seat-slots">
        {slots.map((p, i) => <div key={i} className={`slot ${p ? 'slot-filled' : ''}`}>
          {p ? <><Avatar color="#4a3233" size={34} index={i} /><span>{p.name}</span>{p.verified && <i title="Signed in with Twitch">✓</i>}</> : <span className="slot-empty">empty seat</span>}
        </div>)}
        <div className="slot slot-gpt"><Avatar color="" hidden size={34} /><span>+1 hidden seat</span><i>GPT</i></div>
      </div>
      {isHost && game.mode === 'twitch' && <div className="settings">
        {(Object.keys(options) as (keyof typeof options)[]).map((key) => <div key={key} className="setting">
          <span>{optionLabel[key]}</span>
          <div className="seg">{options[key].map((value) => <button key={value} className={game.settings[key] === value ? 'on' : ''} disabled={key === 'maxSeats' && value < game.lobby.length} onClick={() => act('settings', { [key]: value })}>{key === 'maxSeats' ? value : `${value}s`}</button>)}</div>
        </div>)}
        <button className="btn btn-ghost btn-sm" onClick={() => navigator.clipboard.writeText(`${location.origin}/overlay/${game.channel}`)}>Copy OBS overlay URL</button>
      </div>}
      {isHost && <button className="btn btn-lime btn-wide" disabled={!ready || busy} onClick={onDeal}>
        {ready ? 'Deal the cards →' : `Waiting for ${game.minHumans - game.lobby.length} more`}
      </button>}
      {!isHost && <p className="muted center">The host deals when everyone's seated.</p>}
    </div>
  </div>;
}

function DealSplash({ game, you }: { game: Game; you?: You }) {
  return <div className="splash">
    <div className="splash-cards">{game.seats.map((s, i) => <div key={s.id} className="deal-card" style={{ animationDelay: `${i * 0.12}s` }}>
      <Avatar color={s.color} size={54} index={s.index} /><b>{s.name}</b>
    </div>)}</div>
    {you?.seat ? <div className="splash-you"><small>You are</small><b style={{ color: you.seat.color }}>{you.seat.name.toUpperCase()}</b><span>Blend in. Find the bot.</span></div>
      : <div className="splash-you"><small>Cards dealt</small><b>One of them is GPT</b></div>}
  </div>;
}

function RevealSplash({ game }: { game: Game }) {
  const r = game.lastReveal;
  if (!r) return null;
  const seat = game.seats.find((s) => s.id === r.seatId);
  if (!seat) return <div className="splash"><div className="reveal-card reveal-tie"><span className="eyebrow">The vote is split</span><b>Nobody leaves</b><small>GPT lives another round…</small></div></div>;
  const ai = r.role === 'ai';
  return <div className={`splash ${ai ? 'splash-gpt' : ''}`}>
    <div className={`reveal-card ${ai ? 'reveal-gpt' : 'reveal-human'}`}>
      <span className="eyebrow">{r.votes} vote{r.votes === 1 ? '' : 's'} · unmasking</span>
      <div className="flip"><div className="flip-front"><Avatar color={seat.color} size={110} index={seat.index} /></div><div className="flip-back"><Avatar color={seat.color} size={110} index={seat.index} robot={ai} dead={!ai} /></div></div>
      <b>{seat.name}</b>
      <span className={`stamp stamp-xl ${ai ? 'stamp-gpt' : 'stamp-human'}`}>{ai ? 'WAS GPT' : 'HUMAN'}</span>
      {!ai && <small>@{r.owner} · the bot is still in the room</small>}
    </div>
  </div>;
}

function GameOver({ game, onAgain, busy }: { game: Game; onAgain: () => void; busy: boolean }) {
  const r = game.recap!;
  const chatWon = game.winner === 'chat';
  return <div className={`over ${chatWon ? 'over-chat' : 'over-gpt'}`}>
    <div className="over-hero">
      <span className="eyebrow">{chatWon ? `Caught in round ${r.rounds}` : `Survived ${r.rounds} rounds`}</span>
      <h2>{chatWon ? <>Chat <em>wins.</em></> : <>GPT <em>wins.</em></>}</h2>
      <div className="over-ai"><Avatar color={r.aiColor} size={96} robot /><div><b>{r.aiName}</b><span>was GPT</span></div></div>
      <dl className="over-facts">
        <div><dt>Cover</dt><dd>{r.personality}</dd></div>
        <div><dt>Secret goal</dt><dd>{r.objective}</dd></div>
        <div><dt>Messages sent</dt><dd>{r.aiLines}</dd></div>
        <div><dt>Votes against it</dt><dd>{r.aiVotes}</dd></div>
      </dl>
      {!!r.spotters.length && <p className="spotters">🕵️ Called it: {r.spotters.map((s) => <b key={s}>{s}</b>)}</p>}
      <button className="btn btn-lime" disabled={busy} onClick={onAgain}>Play again →</button>
    </div>
    <div className="over-seats">{game.seats.map((s) => <div key={s.id} className={`over-seat ${s.role === 'ai' ? 'over-seat-gpt' : ''}`}>
      <Avatar color={s.color} size={44} index={s.index} robot={s.role === 'ai'} />
      <b>{s.name}</b><span>{s.role === 'ai' ? 'GPT' : `@${s.owner}`}</span>
    </div>)}</div>
  </div>;
}

export function Composer({ code, token, disabled, placeholder }: { code: string; token: string; disabled: boolean; placeholder: string }) {
  const [text, setText] = useState('');
  const [error, setError] = useState('');
  async function send(event: React.FormEvent) {
    event.preventDefault();
    if (!text.trim() || disabled) return;
    const message = text;
    setText('');
    try { await request(`/api/room/${code}/say`, { token, text: message }); setError(''); } catch (cause) { setError((cause as Error).message); setText(message); }
  }
  return <form className="composer" onSubmit={send}>
    <input value={text} onChange={(e) => setText(e.target.value)} placeholder={placeholder} disabled={disabled} maxLength={200} aria-label="Message the room" autoComplete="off" />
    <button className="btn btn-lime btn-sm" disabled={disabled || !text.trim()}>Send</button>
    {error && <span className="composer-error">{error}</span>}
  </form>;
}

export function Host({ channel }: { channel: string }) {
  const [session, setSession] = useState<{ login: string } | null>(null);
  const [token, setToken] = useState<string | undefined>();
  const { game, you, missing } = useGame(channel, token);
  const now = useNow();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [splash, setSplash] = useState(false);
  const [copied, setCopied] = useState(false);
  const lastPhase = useRef<string>('');

  useEffect(() => { request('/api/session').then((d) => setSession(d.user)).catch(() => {}); }, []);
  useEffect(() => { if (game?.code) setToken(readToken(game.code)); }, [game?.code]);
  useEffect(() => {
    if (!game) return;
    if (lastPhase.current === 'lobby' && game.phase === 'talk') {
      setSplash(true);
      const timer = setTimeout(() => setSplash(false), 3200);
      lastPhase.current = game.phase;
      return () => clearTimeout(timer);
    }
    lastPhase.current = game.phase;
  }, [game?.phase]);

  if (!game) return <main className="center-screen"><Logo /><p>{missing ? 'This table is closed.' : 'Opening the table…'}</p>{missing && <a className="btn btn-lime" href="/">Back home</a>}</main>;

  const isHost = game.mode === 'demo' || session?.login === game.channel;
  const seconds = secondsLeft(game, now);
  const progress = game.deadline ? 100 - ((game.deadline - now) / (phaseLength(game) * 1000)) * 100 : game.paused ? 50 : 0;
  const youSeat = you?.seat?.id;

  async function act(path: string, body?: unknown) {
    setBusy(true); setError('');
    try { await request(`/api/game/${game!.channel}/${path}`, body || {}); } catch (cause) { setError((cause as Error).message); } finally { setBusy(false); }
  }
  async function again() {
    setBusy(true);
    try {
      const data = await request('/api/game/start', { mode: game!.mode });
      if (data.token) saveToken(data.code, data.token);
      location.assign(`/game/${data.channel}`);
    } catch (cause) { setError((cause as Error).message); setBusy(false); }
  }
  async function vote(seatId: string) {
    if (!token) return;
    try { await request(`/api/room/${game!.code}/vote`, { token, seatId }); } catch (cause) { setError((cause as Error).message); }
  }
  function copyOverlay() {
    navigator.clipboard.writeText(`${location.origin}/overlay/${game!.channel}`).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1800); });
  }

  const youAlive = Boolean(you?.seat?.alive);
  return <div className={`stage phase-${game.phase}`}>
    <header className="stage-head">
      <Logo small />
      <div className="stage-status">
        <span className={`phase-chip chip-${game.phase}`}>{game.paused ? 'Paused' : phaseLabel[game.phase]}</span>
        {game.round > 0 && <span className="round">Round {game.round}</span>}
      </div>
      {game.mode === 'twitch' ? <div className="stage-join"><span>{joinHost()}/play</span><b>{game.code}</b></div> : <span className="stage-join stage-demo">Practice room · simulated chat</span>}
      <div className="stage-clock"><b className={seconds !== null && seconds <= 10 && game.phase !== 'reveal' ? 'hurry' : ''}>{game.phase === 'lobby' || game.phase === 'over' ? '—' : clock(seconds)}</b></div>
    </header>
    {game.phase !== 'lobby' && game.phase !== 'over' && <Meter value={progress} />}

    {game.phase === 'lobby' && <Lobby game={game} isHost={isHost} busy={busy} onDeal={() => act('deal')} act={act} />}
    {game.phase === 'over' && <GameOver game={game} onAgain={again} busy={busy} />}

    {game.phase !== 'lobby' && game.phase !== 'over' && <div className="stage-grid">
      <section className="stage-main">
        <div className="prompt-card">
          <span className="eyebrow">{game.phase === 'vote' ? 'Who is GPT?' : `Round ${game.round} prompt`}</span>
          <h2>{game.phase === 'vote' ? <>Type <code>!vote name</code> in chat</> : game.prompt}</h2>
          {game.phase === 'vote' && <span className="prompt-sub">{game.voters} vote{game.voters === 1 ? '' : 's'} in{youSeat && (youAlive || you?.seat) ? ' · tap a suspect to vote' : ''}</span>}
        </div>
        <div className="suspects">
          {game.seats.map((s) => <SuspectCard key={s.id} game={game} seat={s} now={now} youSeat={youSeat} voted={you?.voted} onVote={vote} />)}
        </div>
        {isHost && <div className="host-bar">
          <button className="btn btn-ghost btn-sm" onClick={() => act('pause')}>{game.paused ? '▶ Resume' : '❚❚ Pause'}</button>
          <button className="btn btn-ghost btn-sm" onClick={() => act('advance')}>Skip ahead ⏭</button>
          {game.mode === 'twitch' && <button className="btn btn-ghost btn-sm" onClick={copyOverlay}>{copied ? 'Copied!' : 'Copy OBS overlay URL'}</button>}
          {!game.aiOnline && <span className="warn">No model key set, so bots are using scripted lines</span>}
        </div>}
      </section>
      <section className="room-col">
        <div className="col-title">The room {you?.seat && <span className="you-pill" style={{ background: you.seat.color }}>you are {you.seat.name}</span>}</div>
        <RoomFeed game={game} youSeat={youSeat} />
        {token && you?.seat && <Composer code={game.code} token={token} disabled={game.phase !== 'talk' || !youAlive} placeholder={!youAlive ? 'You were unmasked' : game.phase === 'talk' ? `Talk as ${you.seat.name}…` : 'The room is quiet while chat votes'} />}
      </section>
      <ChatFeed game={game} />
    </div>}

    {splash && <DealSplash game={game} you={you} />}
    {game.phase === 'reveal' && <RevealSplash game={game} />}
    {error && <div className="toast" role="alert">{error}<button onClick={() => setError('')} aria-label="Dismiss">×</button></div>}
  </div>;
}
