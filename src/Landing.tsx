import React, { useEffect, useRef, useState } from 'react';
import { Avatar, Logo, TwitchGlyph } from './ui';
import { request, saveToken } from './lib';

const cast = [
  { name: 'lucky', color: '#b5484b' }, { name: 'velvet', color: '#8fb3c9' }, { name: 'ace', color: '#e8b04a' },
  { name: 'smokey', color: '#ff8a3d' }, { name: 'duke', color: '#e9e2cf' }, { name: 'dice', color: '#3fa37a' },
];
const ticker = ['!join', 'trust nobody', '!ask', 'act natural', '!vote', 'spot the bot', '!suspects', 'someone is lying'];
const colorOf = (name: string) => cast.find((c) => c.name === name)?.color || '#fff';

type Beat = { t: number; room?: [string, string]; chat?: [string, string]; ask?: boolean; vote?: string; phase?: 'talk' | 'vote' | 'reveal' };
const script: Beat[] = [
  { t: 600, room: ['lucky', 'cold pizza at 2am dont judge me'] },
  { t: 2200, chat: ['pixelpanda', '!ask whats 17 x 3 no calculator'], ask: true },
  { t: 3600, room: ['velvet', 'Just a light salad and some sparkling water, nothing too exciting!'] },
  { t: 5000, chat: ['cozycrab', 'velvet typed that like an email KEKW'] },
  { t: 6200, room: ['ace', 'velvet who says sparkling water'] },
  { t: 7600, room: ['smokey', '51. did it in my head, genius'] },
  { t: 9000, room: ['velvet', 'lol fair i had leftover pasta tbh'] },
  { t: 10200, chat: ['rngesus', 'its velvet. i will not elaborate'] },
  { t: 11400, phase: 'vote' },
  ...['velvet', 'lucky', 'velvet', 'velvet', 'ace', 'velvet', 'velvet', 'lucky', 'velvet', 'velvet'].map((vote, i) => ({ t: 11900 + i * 380, vote, chat: [['ggnore', 'lurkmode', 'chairgang', 'byteme_', 'xXbreadXx', 'saltysalmon', 'potatoaim', 'modsasleep', 'snackattack', 'cozycrab'][i], `!vote ${vote}`] as [string, string] })),
  { t: 16200, phase: 'reveal' },
  { t: 21500, phase: 'talk' },
];

function HeroStage() {
  const [step, setStep] = useState(0);
  const [loop, setLoop] = useState(0);
  useEffect(() => {
    const timers = script.map((beat, i) => setTimeout(() => setStep(i + 1), beat.t));
    const restart = setTimeout(() => { setStep(0); setLoop((n) => n + 1); }, 22000);
    return () => { timers.forEach(clearTimeout); clearTimeout(restart); };
  }, [loop]);
  const seen = script.slice(0, step);
  const phase = [...seen].reverse().find((b) => b.phase)?.phase || 'talk';
  const room = seen.filter((b) => b.room || b.ask).slice(-5);
  const chat = seen.filter((b) => b.chat).slice(-7);
  const votes = seen.filter((b) => b.vote).reduce<Record<string, number>>((acc, b) => ({ ...acc, [b.vote!]: (acc[b.vote!] || 0) + 1 }), {});
  const total = Object.values(votes).reduce((a, b) => a + b, 0) || 1;
  return <div className={`hero-stage hsp-${phase}`} aria-label="A sample round of Chat vs GPT playing on stream">
    <div className="hs-top"><span className="live-dot" /> LIVE <b>ROUND 1</b><span className="hs-phase">{phase === 'vote' ? 'VOTING' : phase === 'reveal' ? 'UNMASKED' : 'TALKING'}</span></div>
    <div className="hs-body">
      <div className="hs-room">
        <div className="hs-seats">{cast.map((c, i) => <div key={c.name} className={`hs-seat ${phase !== 'talk' && votes[c.name] ? 'hs-voted' : ''}`}>
          <Avatar color={c.color} size={34} index={i} robot={phase === 'reveal' && c.name === 'velvet'} />
          <span>{c.name}</span>
          {phase !== 'talk' && <i style={{ width: `${((votes[c.name] || 0) / total) * 100}%`, background: c.color }} />}
        </div>)}</div>
        <div className="hs-prompt">What did you eat today? Be specific.</div>
        <div className="hs-feed">{room.map((b, i) => b.ask
          ? <p key={`${loop}-${i}`} className="hs-ask"><b>{b.chat![0]} asks</b> {b.chat![1].replace('!ask ', '')}</p>
          : <p key={`${loop}-${i}`}><b style={{ color: colorOf(b.room![0]) }}>{b.room![0]}</b> {b.room![1]}</p>)}</div>
      </div>
      <div className="hs-chat">
        <span className="hs-chat-title">STREAM CHAT</span>
        {chat.map((b, i) => <p key={`${loop}-${i}`}><b>{b.chat![0]}</b> <span className={b.chat![1].startsWith('!') ? 'cmd' : ''}>{b.chat![1]}</span></p>)}
      </div>
    </div>
    {phase === 'reveal' && <div className="hs-reveal">
      <Avatar color={colorOf('velvet')} size={74} robot />
      <b>VELVET</b><span className="stamp stamp-gpt">WAS GPT</span><small>10 of 12 chatters called it</small>
    </div>}
  </div>;
}

const steps = [
  { tone: 'violet', kicker: 'On their phone', title: 'Viewers grab a seat', body: 'Suspects join from a link on stream. At the deal, everyone gets a codename and the seats are shuffled.', visual: 'phone' },
  { tone: 'pink', kicker: 'The twist', title: 'One seat is GPT', body: 'It types like chat, it has a cover story, and it has a secret goal. Its avatar looks just like everyone else\'s.', visual: 'seats' },
  { tone: 'lime', kicker: 'Twitch chat', title: 'Chat interrogates', body: 'The suspects talk it out on stream while chat drops questions with !ask.', visual: 'ask' },
  { tone: 'amber', kicker: 'Every round', title: 'Chat votes someone out', body: 'Everyone in chat types !vote. The most-voted suspect gets unmasked live on stream.', visual: 'vote' },
  { tone: 'cyan', kicker: 'Endgame', title: 'Find it or lose', body: 'If chat unmasks GPT, chat wins. If GPT makes it to the final two, the bot wins.', visual: 'reveal' },
];

function StepVisual({ kind }: { kind: string }) {
  if (kind === 'phone') return <div className="v-phone"><div className="v-phone-notch" /><small>YOU ARE</small><Avatar color="#b5484b" size={86} index={0} /><b>LUCKY</b><span>Blend in. Find the bot.</span></div>;
  if (kind === 'seats') return <div className="v-seats">{cast.map((c, i) => <div key={c.name} className={c.name === 'duke' ? 'v-glitch' : ''}><Avatar color={c.color} size={58} index={i} /><span>{c.name}</span></div>)}</div>;
  if (kind === 'ask') return <div className="v-chat">
    <p><b className="c1">cozycrab</b> <span className="cmd">!ask describe your chair</span></p>
    <p className="v-room"><Avatar color="#8fb3c9" size={22} index={1} /><b>velvet</b> gaming chair, one armrest is held on with tape</p>
    <p className="v-room"><Avatar color="#ff8a3d" size={22} index={3} /><b>smokey</b> I sit on a comfortable ergonomic office chair.</p>
    <p><b className="c2">rngesus</b> SMOKEY LMAO</p>
  </div>;
  if (kind === 'vote') return <div className="v-votes">{[['smokey', 64, '#ff8a3d'], ['velvet', 21, '#8fb3c9'], ['lucky', 15, '#b5484b']].map(([name, pct, color]) => <div key={name}>
    <span>{name}</span><i style={{ width: `${pct}%`, background: color as string }} /><b>{pct}%</b>
  </div>)}<code>!vote smokey</code></div>;
  return <div className="v-reveal">
    <div className="v-card"><Avatar color="#8fb3c9" size={60} index={1} dead /><b>velvet</b><span className="stamp stamp-human">HUMAN</span><small>@tofu_bandit</small></div>
    <div className="v-card v-card-gpt"><Avatar color="#ff8a3d" size={60} robot /><b>smokey</b><span className="stamp stamp-gpt">GPT</span><small>chat wins</small></div>
  </div>;
}

// Sticky cards stack as you scroll, like a hand of cards being laid down.
function HowItPlays() {
  return <section className="how" id="how">
    <div className="how-copy">
      <span className="eyebrow">How it plays</span>
      <h2>Talk. Vote.<br /><em>Unmask.</em></h2>
      <p>Rounds run about two minutes. You need at least two viewers in seats, and the rest of chat plays as the jury.</p>
    </div>
    <div className="how-cards">
      {steps.map((s, i) => <article key={s.title} className={`step step-${s.tone}`} style={{ top: `${96 + i * 18}px` }}>
        <span className="step-num">0{i + 1}</span>
        <span className="step-kicker">{s.kicker}</span>
        <h3>{s.title}</h3>
        <p>{s.body}</p>
        <div className="step-visual"><StepVisual kind={s.visual} /></div>
      </article>)}
    </div>
  </section>;
}

function Reveal({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const [shown, setShown] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const observer = new IntersectionObserver(([entry]) => { if (entry.isIntersecting) { setShown(true); observer.disconnect(); } }, { threshold: 0.2 });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  return <div ref={ref} className={`reveal-in ${shown ? 'shown' : ''} ${className}`}>{children}</div>;
}

export function Landing() {
  const [user, setUser] = useState<{ login: string; displayName: string } | null>(null);
  const [canHost, setCanHost] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    request('/api/session').then((data) => { setUser(data.user); setCanHost(data.canHost); }).catch(() => {});
    const params = new URLSearchParams(location.search);
    if (params.has('twitch_error')) {
      setError('Twitch sign-in did not finish. Please try again.');
      history.replaceState({}, '', '/');
    }
  }, []);

  async function start(mode: 'demo' | 'twitch') {
    setBusy(true); setError('');
    try {
      const data = await request('/api/game/start', { mode });
      if (data.token) saveToken(data.code, data.token);
      location.assign(`/game/${data.channel}`);
    } catch (cause) {
      const message = (cause as Error).message;
      if (/already running/.test(message) && user) location.assign(`/game/${user.login}`);
      if (/chat access/.test(message)) return location.assign('/auth/twitch?host=1');
      setError(message);
      setBusy(false);
    }
  }

  const hostButton = user && canHost
    ? <button className="btn btn-twitch" disabled={busy} onClick={() => start('twitch')}><TwitchGlyph /> Host on {user.displayName}</button>
    : <a className="btn btn-twitch" href="/auth/twitch?host=1"><TwitchGlyph /> Host on Twitch</a>;

  return <main className="landing">
    <nav className="pill-nav">
      <Logo small />
      <a href="#how">How it plays</a>
      <a href="#stream">For streamers</a>
      <button className="btn btn-lime btn-sm" disabled={busy} onClick={() => start('demo')}>Play demo</button>
    </nav>
    {error && <div className="toast" role="alert">{error}<button onClick={() => setError('')} aria-label="Dismiss">×</button></div>}

    <section className="hero">
      <div className="hero-copy">
        <h1>
          <span>A room of suspects.</span>
          <span>One of them is <em className="glitch" data-text="AI">AI</em>.</span>
          <span className="verdict">Twitch chat decides.</span>
        </h1>
        <p>A social deduction game for Twitch. Your viewers have to spot the AI hiding among them before it makes it to the end.</p>
        <div className="hero-actions">
          <button className="btn btn-lime" disabled={busy} onClick={() => start('demo')}>▶ Play the demo</button>
          {hostButton}
        </div>
        {user && <span className="signed-in">Signed in as <b>{user.displayName}</b> · <a href="/auth/twitch">switch</a></span>}
      </div>
      <HeroStage />
    </section>

    <div className="marquee" aria-hidden><div>{Array.from({ length: 6 }, (_, k) => <span key={k}>{ticker.map((item) => <React.Fragment key={item}>{item.startsWith('!') ? <code>{item}</code> : item} ✦ </React.Fragment>)}</span>)}</div></div>

    <HowItPlays />

    <section className="stream" id="stream">
      <Reveal><h2>Built for <em>stream.</em></h2></Reveal>
      <div className="stream-grid">
        <Reveal className="tile">
          <div className="tile-visual t-overlay"><div className="t-cam" /><div className="t-hud"><span>ROUND 2</span><b>0:41</b></div><div className="t-row">{cast.slice(0, 5).map((c, i) => <Avatar key={c.name} color={c.color} size={24} index={i} />)}</div></div>
          <h3>OBS overlay</h3><p>Add one browser source. It has a transparent background and updates live.</p>
        </Reveal>
        <Reveal className="tile">
          <div className="tile-visual t-cmds"><code>!join</code><code>!ask</code><code>!vote</code><code>!help</code></div>
          <h3>Plays in real chat</h3><p>It reads commands straight from Twitch chat through EventSub. Viewers don't need to install anything.</p>
        </Reveal>
        <Reveal className="tile">
          <div className="tile-visual t-bot"><p><b>chatvsgpt</b> 🗳️ Voting is open! !vote &lt;name&gt;</p><p><b>chatvsgpt</b> VELVET was human (@tofu_bandit)…</p></div>
          <h3>Chat narrates</h3><p>The game posts each phase in chat, from your account or a bot. Every suspect, GPT included, gets a codename and a card.</p>
        </Reveal>
      </div>
    </section>

    <section className="final">
      <Reveal>
        <div className="final-faces">{cast.map((c, i) => <Avatar key={c.name} color={c.color} size={64} index={i} />)}</div>
        <h2>Can your chat<br />spot the <em>bot?</em></h2>
        <div className="hero-actions center">
          <button className="btn btn-lime" disabled={busy} onClick={() => start('demo')}>▶ Play the demo</button>
          {hostButton}
        </div>
      </Reveal>
    </section>

    <footer className="footer"><Logo small /><a href="https://github.com/vlww/Chat-vs-GPT">GitHub ↗</a></footer>
  </main>;
}
