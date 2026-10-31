import React, { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { io, Socket } from 'socket.io-client';
import './style.css';

type Player = { id: string; name: string; alive: boolean; avatar?: string };
type Chat = { id: string; name: string; text: string; at: number; kind: string; simulated?: boolean };
type Game = {
  channel: string;
  mode: 'simulation' | 'twitch';
  phase: string;
  round: number;
  players: Player[];
  eliminated: string[];
  accusations: Record<string, string>;
  votes: Record<string, string>;
  chat: Chat[];
  deadline: number | null;
  settings: { minPlayers: number; maxPlayers: number; discussionSeconds: number };
  recap?: Record<string, any>;
  reveal?: { personality: string; objective: string };
};

const socket: Socket = io(import.meta.env.VITE_SOCKET_ORIGIN || undefined, { autoConnect: true });
const phaseTitle: Record<string, string> = {
  lobby: 'The Gathering', discussion: 'Discussion', voting: 'Cast your vote', reveal: 'The Reveal', over: 'Case closed',
};
const formatTime = (seconds: number) => `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;

async function request(path: string, body?: unknown) {
  const response = await fetch(path, {
    method: body ? 'POST' : 'GET', headers: { 'content-type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined, credentials: 'include',
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw Error(data.error || 'Something went wrong');
  return data;
}

function App() {
  const [streamer, setStreamer] = useState<any>(null);
  const [game, setGame] = useState<Game | null>(null);
  const [channel, setChannel] = useState('');
  const [name, setName] = useState('');
  const [text, setText] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [minPlayers, setMinPlayers] = useState(4);
  const [maxPlayers, setMaxPlayers] = useState(12);
  const [discussionSeconds, setDiscussionSeconds] = useState(90);
  const [now, setNow] = useState(Date.now());
  const overlay = new URLSearchParams(location.search).has('overlay');

  useEffect(() => {
    request('/api/session').then((data) => {
      setStreamer(data.streamer);
      if (data.streamer) {
        setChannel(data.streamer.login);
        request(`/api/state/${data.streamer.login}`).then(setGame).catch(() => {});
      }
    }).catch(() => {});
    const timer = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    if (!game) return;
    socket.emit('watch', game.channel);
    const onState = (state: Game) => { if (state.channel === game.channel) setGame(state); };
    socket.on('state', onState);
    return () => { socket.off('state', onState); };
  }, [game?.channel]);

  const alive = game?.players.filter((player) => player.alive) || [];
  const seconds = game?.deadline ? Math.max(0, Math.ceil((game.deadline - now) / 1000)) : null;
  const phaseDuration = game?.phase === 'voting' ? 45 : game?.phase === 'reveal' ? 7 : game?.settings.discussionSeconds || 90;
  const progress = game?.deadline ? Math.max(0, Math.min(100, 100 - ((game.deadline - now) / (phaseDuration * 1000)) * 100)) : 0;

  async function act(operation: () => Promise<any>) {
    setError(''); setBusy(true);
    try { await operation(); } catch (cause) { setError((cause as Error).message); }
    finally { setBusy(false); }
  }
  async function start(mode: 'simulation' | 'twitch') {
    await act(async () => {
      const state = await request('/api/game/start', { channel, mode, settings: { minPlayers, maxPlayers, discussionSeconds } });
      setGame(state);
    });
  }
  async function sendCommand() {
    if (!game) return;
    await act(async () => {
      await request(`/api/game/${game.channel}/command`, { name: name || 'you', text });
      setText('');
    });
  }
  async function control(action: string, body?: unknown) {
    if (!game) return;
    await act(async () => {
      await request(`/api/game/${game.channel}/${action}`, body || {});
      setGame(await request(`/api/state/${game.channel}`));
    });
  }

  if (overlay) return <Overlay game={game} />;
  return (
    <main className="app-shell">
      <nav className="masthead">
        <a className="brand" href="/" aria-label="Chat vs. GPT home"><span>CHAT</span><i>vs.</i><span>GPT</span></a>
        <div className="masthead-note"><span className="status-lamp" /> A LIVE SOCIAL DEDUCTION GAME</div>
        <a className="masthead-link" href="#how">THE RULES <span>↓</span></a>
      </nav>

      {!game ? <>
        <section className="title-screen">
          <div className="title-copy">
            <div className="kicker"><span className="kicker-rule" /> AN OPEN CASE / TWITCH CHAT</div>
            <h1>WHO’S THE<br /><em>IMPOSTOR?</em></h1>
            <p>One of these players isn’t human.<br />Can you figure out who?</p>
            <div className="title-actions">
              {streamer ? <>
                <div className="host-status">HOSTED BY <b>{streamer.displayName}</b></div>
                <button className="button button-primary" disabled={busy} onClick={() => start('twitch')}>Open the table <span>↗</span></button>
              </> : <a className="button button-primary" href="/auth/twitch"><span className="twitch-glyph">◉</span> Connect with Twitch <span>↗</span></a>}
            </div>
            {streamer && <div className="settings-strip">
              <label>MIN. HUMAN PLAYERS<input type="number" min="2" max="10" value={minPlayers} onChange={(event) => setMinPlayers(Number(event.target.value))} /></label>
              <label>MAX. AT THE TABLE<input type="number" min={minPlayers + 1} max="16" value={maxPlayers} onChange={(event) => setMaxPlayers(Number(event.target.value))} /></label>
              <label>DISCUSSION · SEC<input type="number" min="30" max="300" step="15" value={discussionSeconds} onChange={(event) => setDiscussionSeconds(Number(event.target.value))} /></label>
            </div>}
            <div className="title-footnote"><span className="wax-dot" /> THE CHAT IS THE GAME. THE AI IS IN THE ROOM.</div>
          </div>
          <TableScene />
          <div className="title-coordinates"><span>CASE 001</span><span>EST. AFTER DARK</span></div>
        </section>

        <section className="rules-line" id="how">
          <div className="kicker">HOW THE NIGHT GOES</div>
          <div><b>01</b><span>Join with <code>!join</code></span></div>
          <div><b>02</b><span>Talk. Watch. Accuse.</span></div>
          <div><b>03</b><span>Vote before time runs out.</span></div>
          <div className="rules-aside">One AI. A room full of suspects.</div>
        </section>
        <section className="sim-entry">
          <div><span className="kicker">THE PRACTICE ROOM</span><p>Try the full game loop without Twitch. Simulated messages stay clearly marked.</p></div>
          <div className="sim-launch"><input value={channel} onChange={(event) => setChannel(event.target.value)} placeholder="case room name" aria-label="Simulation room name" /><button className="button button-quiet" disabled={busy || !channel} onClick={() => start('simulation')}>Enter simulation <span>↗</span></button></div>
        </section>
        <footer className="footer"><a className="brand brand-small" href="/"><span>CHAT</span><i>vs.</i><span>GPT</span></a><span>THE ONLY WAY OUT IS A GOOD GUESS.</span><span>CODEX × TWITCHCON</span></footer>
      </> : <GameRoom game={game} streamer={streamer} alive={alive} seconds={seconds} progress={progress} name={name} setName={setName} text={text} setText={setText} sendCommand={sendCommand} control={control} start={start} busy={busy} error={error} setGame={setGame} />}
    </main>
  );
}

function TableScene() {
  return <div className="table-scene" aria-label="A noir game table with player dossiers">
    <div className="table-ring ring-outer" /><div className="table-ring ring-inner" />
    <div className="table-center"><span>ONE OF YOU</span><b>IS LYING</b><i>✦</i></div>
    <div className="scene-caption caption-one">THE SUSPECTS</div><div className="scene-caption caption-two">THE FINAL VOTE</div>
    <div className="dossier dossier-one"><span className="dossier-number">01</span><b>mothradio</b><small>“i was literally afk”</small><i className="dossier-pin" /></div>
    <div className="dossier dossier-two"><span className="dossier-number">04</span><b>velvetknife</b><small>“why are you asking me”</small><i className="dossier-pin" /></div>
    <div className="playing-card"><span className="playing-card-corner">♠</span><span className="playing-card-mark">?</span><span className="playing-card-corner bottom">♠</span></div>
    <div className="table-light" />
  </div>;
}

function GameRoom({ game, streamer, alive, seconds, progress, name, setName, text, setText, sendCommand, control, start, busy, error, setGame }: any) {
  const isSimulation = game.mode === 'simulation';
  const countVotes = Object.keys(game.votes || {}).length;
  const url = `${location.origin}/overlay/${game.channel}?overlay`;
  const accusationCounts = (Object.values(game.accusations || {}) as string[]).reduce((counts: Record<string, number>, target: string) => {
    counts[target] = (counts[target] || 0) + 1; return counts;
  }, {});
  const eliminatedPlayer = game.phase === 'reveal' ? game.players.find((player: Player) => player.id === game.eliminated.at(-1)) : null;
  const eliminationMessage = eliminatedPlayer && game.chat.find((message: Chat) => message.kind === 'system' && message.text.includes(`${eliminatedPlayer.name} was eliminated.`));
  const eliminatedRole = eliminationMessage?.text.includes('They were the AI.') ? 'AI' : eliminationMessage ? 'HUMAN' : 'REMOVED';
  const accusationList = Object.entries(game.accusations || {}).map(([from, to]) => ({
    from: game.players.find((player: Player) => player.id === from)?.name || from,
    to: game.players.find((player: Player) => player.id === to)?.name || to,
  }));

  return <div className={`game-shell phase-${game.phase}`}>
    <header className="game-masthead">
      <a className="brand" href="/"><span>CHAT</span><i>vs.</i><span>GPT</span></a>
      <div className="room-ident"><span className="wax-dot" /> {game.channel} <i>/</i> ROUND {String(game.round || 0).padStart(2, '0')}</div>
      <div className="game-head-actions">
        <span className={isSimulation ? 'mode-tag mode-sim' : 'mode-tag'}>{isSimulation ? 'SIMULATION' : 'LIVE ON TWITCH'}</span>
        <button className="text-control" onClick={() => navigator.clipboard.writeText(url).then(() => alert('OBS URL copied'))}>OBS SOURCE <span>↗</span></button>
      </div>
    </header>

    <div className="phase-bar">
      <div className="phase-name"><span className="kicker">THE CASE FILE / {game.round ? `ROUND ${game.round}` : 'LOBBY'}</span><h1>{phaseTitle[game.phase] || game.phase}</h1></div>
      <div className="phase-time"><div><span className="kicker">{game.phase === 'lobby' ? 'PLAYERS AT THE TABLE' : game.phase === 'voting' ? 'BALLOTS RECEIVED' : 'TIME REMAINING'}</span><b>{game.phase === 'lobby' ? `${alive.length} / ${game.settings.maxPlayers}` : game.phase === 'over' ? '—' : game.phase === 'reveal' ? 'REVEAL' : `${seconds === null ? '00:00' : formatTime(seconds)}`}</b></div>{game.phase !== 'lobby' && game.phase !== 'over' && <div className="phase-meter"><i style={{ width: `${progress}%` }} /></div>}</div>
    </div>

    <div className="table-layout">
      <section className="roster-panel">
        <div className="panel-heading"><div><span className="kicker">SEATED AT THE TABLE</span><span className="panel-subtitle">One face here doesn’t belong.</span></div><span className="seat-count">{String(alive.length).padStart(2, '0')}<i> / {String(game.players.length).padStart(2, '0')}</i></span></div>
        {game.phase === 'lobby' && <div className="lobby-note"><span className="seal">✦</span><div><b>The door is open.</b><span>Viewers take a seat with <code>!join</code>.</span></div><span className="lobby-need">{Math.max(0, game.settings.minPlayers - alive.length)} MORE TO BEGIN</span></div>}
        <div className="suspect-table">
          {game.players.map((player: Player, index: number) => {
            const targetCount = accusationCounts[player.id] || 0;
            const accused = targetCount > 0;
            return <article className={`suspect-card ${!player.alive ? 'suspect-dead' : ''} ${accused ? 'suspect-accused' : ''}`} key={player.id}>
              <span className="card-index">{String(index + 1).padStart(2, '0')}</span>
              <div className={`suspect-portrait portrait-${index % 5}`}>{player.avatar ? <img src={player.avatar} alt="" /> : <span>{player.name.slice(0, 1).toUpperCase()}</span>}<i>{player.alive ? '●' : '×'}</i></div>
              <div className="suspect-info"><b>{player.name}</b><span>{player.alive ? 'STILL IN PLAY' : 'ELIMINATED'}</span></div>
              <div className="suspect-evidence"><span>{targetCount}</span><small>ACCUSATIONS</small></div>
              {player.alive && <button className="remove-player" title={`Remove ${player.name}`} aria-label={`Remove ${player.name}`} onClick={() => control('kick', { name: player.name })}>×</button>}
              {!player.alive && <span className="eliminated-stamp">OUT</span>}
            </article>;
          })}
        </div>

        {game.phase === 'reveal' && eliminatedPlayer && <div className="reveal-stage"><div className="reveal-label">THE TABLE HAS SPOKEN</div><div className="reveal-card"><span className="reveal-index">{String(game.players.indexOf(eliminatedPlayer) + 1).padStart(2, '0')}</span><b>{eliminatedPlayer.name}</b><span className={`role-stamp ${eliminatedRole === 'AI' ? 'role-ai' : ''}`}>{eliminatedRole}</span></div><p>{eliminatedRole === 'AI' ? 'The impostor was found.' : eliminatedRole === 'HUMAN' ? 'One less suspect. The game continues.' : 'Removed from the game by the host.'}</p></div>}
        {game.phase === 'over' && game.reveal && <div className="final-reveal"><div className="final-overline">THE FINAL REVEAL</div><div className="final-name">{game.recap?.aiName || 'The impostor'}</div><div className="final-verdict">WAS THE <b>AI</b></div><div className="final-details"><span>PERSONALITY <b>{game.reveal.personality}</b></span><span>SECRET OBJECTIVE <b>{game.reveal.objective}</b></span><span>ROUNDS SURVIVED <b>{game.recap?.roundsSurvived ?? game.round}</b></span><span>FIRST TO ACCUSE <b>{game.recap?.firstAccuser || 'Nobody'}</b></span></div></div>}

        <div className="host-console">
          <div className="host-console-label"><span className="kicker">HOST’S HAND</span><span>{streamer?.displayName || 'LOCAL HOST'}</span></div>
          <div className="host-controls">
            {game.phase === 'lobby' && <button className="button button-primary" disabled={busy || alive.length < game.settings.minPlayers} onClick={() => control('begin')}>Deal the cards <span>↗</span></button>}
            {['discussion', 'voting', 'reveal'].includes(game.phase) && <><button className="button button-quiet" onClick={() => control('pause')}>Pause / resume</button><button className="button button-outline" onClick={() => control('advance')}>Move to next phase <span>→</span></button></>}
            {game.phase === 'over' && <button className="button button-primary" disabled={busy} onClick={() => request('/api/game/start', { channel: game.channel, mode: game.mode }).then(setGame).catch((cause: Error) => alert(cause.message))}>Deal again <span>↗</span></button>}
          </div>
          <span className="console-note">GAME RULES STAY WITH THE HOUSE</span>
        </div>
      </section>

      <aside className="evidence-panel">
        <div className="evidence-tabs"><div className="active-tab">THE ROOM</div><div>ACCUSATIONS <span>{accusationList.length}</span></div></div>
        <div className="evidence-section"><div className="evidence-title"><span className="kicker">ON THE RECORD</span><span className="live-mark"><i /> {isSimulation ? 'SIM' : 'LIVE'}</span></div>
          <div className="discussion-feed" aria-live="polite">{game.chat.map((message: Chat) => <div className={`feed-entry ${message.kind === 'system' ? 'feed-system' : ''}`} key={message.id}><time>{new Date(message.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</time><div><b>{message.name}</b><p>{message.text}</p>{message.simulated && <small>SIMULATED</small>}</div></div>)}</div>
        </div>
        <div className="accusation-ledger"><div className="evidence-title"><span className="kicker">ACCUSATION LEDGER</span><span>{accusationList.length.toString().padStart(2, '0')}</span></div>{accusationList.length ? accusationList.map((entry: any, index: number) => <div className="ledger-row" key={`${entry.from}-${index}`}><span>{entry.from}</span><i>accuses</i><b>{entry.to}</b></div>) : <p className="ledger-empty">No accusations on record.</p>}</div>
        {isSimulation ? <div className="sim-composer"><div className="sim-disclaimer"><i /> PRACTICE ROOM · NOT CONNECTED TO TWITCH</div><div className="composer-row"><input value={name} onChange={(event) => setName(event.target.value)} placeholder="viewer" aria-label="Simulated viewer username" /><input value={text} onChange={(event) => setText(event.target.value)} onKeyDown={(event) => event.key === 'Enter' && sendCommand()} placeholder="Message or !join" aria-label="Simulated chat message" /><button onClick={sendCommand} aria-label="Send message">↗</button></div></div> : <div className="chat-instructions"><span>⌘</span> Chat plays in Twitch <code>!help</code></div>}
      </aside>
    </div>
    {error && <div className="error-toast">{error}</div>}
    <footer className="game-footer"><span>CHAT vs. GPT <i>·</i> WHO’S THE IMPOSTOR?</span><a href="/">LEAVE THE TABLE ↗</a></footer>
  </div>;
}

function Overlay({ game }: { game: Game | null }) {
  const [live, setLive] = useState<Game | null>(game);
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    document.documentElement.classList.add('overlay-page');
    const channel = location.pathname.split('/').pop();
    socket.emit('watch', channel);
    const onState = (state: Game) => { if (state.channel === channel) setLive(state); };
    socket.on('state', onState);
    const interval = setInterval(() => setNow(Date.now()), 500);
    return () => { socket.off('state', onState); clearInterval(interval); document.documentElement.classList.remove('overlay-page'); };
  }, []);
  const seconds = live?.deadline ? Math.max(0, Math.ceil((live.deadline - now) / 1000)) : null;
  const removed = live?.players.find((player) => player.id === live.eliminated.at(-1));
  const latestSystem = live?.chat.slice().reverse().find((message) => message.kind === 'system')?.text || '';
  const tied = live?.phase === 'reveal' && latestSystem.includes('vote is tied');
  const removalNotice = removed && live?.chat.find((message) => message.kind === 'system' && message.text.includes(`${removed.name} was eliminated.`));
  const role = removalNotice?.text.includes('They were the AI.') ? 'AI' : removalNotice ? 'HUMAN' : 'REMOVED';
  const accusationCounts = (Object.values(live?.accusations || {}) as string[]).reduce((counts: Record<string, number>, playerId) => {
    counts[playerId] = (counts[playerId] || 0) + 1;
    return counts;
  }, {});
  const leadingAccusations = Object.entries(accusationCounts).sort((a, b) => b[1] - a[1]).slice(0, 3);
  return <div className={`broadcast-overlay overlay-${live?.phase || 'lobby'}`}>
    <div className="broadcast-top"><div className="broadcast-brand">CHAT <i>vs.</i> GPT</div><span className="broadcast-phase"><i /> {phaseTitle[live?.phase || 'lobby'] || 'The Gathering'} {live?.round ? `· ROUND ${live.round}` : ''}</span><b>{seconds === null ? '—' : formatTime(seconds)}</b></div>
    <div className="broadcast-roster">{(live?.players || []).map((player, index) => <div className={`broadcast-card ${player.alive ? '' : 'broadcast-out'}`} key={player.id}><small>{String(index + 1).padStart(2, '0')}</small><i>{player.name.slice(0, 1).toUpperCase()}</i><span>{player.name}</span></div>)}</div>
    {live?.phase === 'voting' && <div className="broadcast-votes">BALLOTS IN <b>{Object.keys(live.votes || {}).length} / {live.players.filter((player) => player.alive).length}</b></div>}
    {!!leadingAccusations.length && <div className="broadcast-accusations"><span>UNDER SUSPICION</span>{leadingAccusations.map(([id, count]) => <b key={id}>{live?.players.find((player) => player.id === id)?.name || id} <i>× {count}</i></b>)}</div>}
    {live?.phase === 'reveal' && tied && <div className="broadcast-reveal"><span>THE BALLOT IS SPLIT</span><b>No one leaves.</b><i>THE VOTE IS TIED</i></div>}
    {live?.phase === 'reveal' && !tied && removed && <div className="broadcast-reveal"><span>ELIMINATED</span><b>{removed.name}</b><i>{role} / THE TABLE HAS SPOKEN</i></div>}
    {live?.phase === 'over' && <div className="broadcast-reveal broadcast-final"><span>THE IMPOSTOR WAS</span><b>{live.recap?.aiName}</b><i>THE AI</i></div>}
  </div>;
}

createRoot(document.getElementById('root')!).render(<App />);
