import React from 'react';
import { createRoot } from 'react-dom/client';
import { Landing } from './Landing';
import { Host } from './Host';
import { Play } from './Play';
import { Overlay } from './Overlay';
import './style.css';

function App() {
  const path = location.pathname;
  const game = path.match(/^\/game\/([a-z0-9_]{2,25})\/?$/i);
  if (game) return <Host channel={game[1].toLowerCase()} />;
  const overlay = path.match(/^\/overlay\/([a-z0-9_]{2,25})\/?$/i);
  if (overlay) return <Overlay channel={overlay[1].toLowerCase()} />;
  const play = path.match(/^\/play\/?([a-z]{0,4})\/?$/i);
  if (play) return <Play code={play[1] || ''} />;
  return <Landing />;
}

createRoot(document.getElementById('root')!).render(<App />);
