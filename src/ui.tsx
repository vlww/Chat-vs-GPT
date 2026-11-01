import React, { useEffect, useState } from 'react';
import QRCode from 'qrcode';

export function Logo({ small }: { small?: boolean }) {
  return <a className={`logo ${small ? 'logo-small' : ''}`} href="/" aria-label="Chat vs GPT home">
    <span>CHAT</span><i>vs</i><b>GPT</b>
  </a>;
}

// Chess-piece silhouettes drawn on a 64x64 card face; each seat gets one, plus a suit in the corner.
const pieces = [
  // king
  'M30 7h4v4h4v4h-4v4h-4v-4h-4v-4h4z M23 22h18l-3 9 2 11H24l2-11z',
  // queen
  'M19 17l5 13 4-11 4 11 4-11 4 11 5-13-3 25H22z M19 15a2.5 2.5 0 1 1 0 .1z M45 15a2.5 2.5 0 1 1 0 .1z M32 13a2.5 2.5 0 1 1 0 .1z',
  // rook
  'M21 13h5v4h3.5v-4h5v4H38v-4h5v9l-4 3v17H25V25l-4-3z',
  // bishop
  'M32 10c7 7 8 15 4 21h-8c-4-6-3-14 4-21z M32 5a3 3 0 1 1 0 .1z M27 31h10l3 11H24z',
  // knight
  'M25 42c0-7 3-11 6-15-4 1-8 0-9-4l9-10c4-2 10 0 12 6 3 8 2 15 0 23z',
  // pawn
  'M32 12a7 7 0 1 1 0 .1z M28 25h8c1 6 3 12 5 17H23c2-5 4-11 5-17z',
];
const suits = ['♠', '♥', '♦', '♣'];

// Every suspect is the same kind of card so nothing but behaviour can give GPT away.
export function Avatar({ color, size = 56, index = 0, robot, hidden, dead, talking }: {
  color: string; size?: number; index?: number; robot?: boolean; hidden?: boolean; dead?: boolean; talking?: boolean;
}) {
  if (hidden) {
    return <svg className="avatar avatar-hidden" width={size} height={size} viewBox="0 0 64 64" aria-hidden>
      <rect x="9" y="2" width="46" height="60" rx="6" fill="#2a0d0f" stroke="var(--violet)" strokeWidth="2" />
      <rect x="14" y="7" width="36" height="50" rx="3" fill="none" stroke="var(--violet)" strokeOpacity=".5" />
      <path d="M32 14l10 18-10 18-10-18z" fill="var(--violet)" opacity=".8" />
      <text x="32" y="37" textAnchor="middle" fontSize="13" fontWeight="900" fill="#0b0909">?</text>
    </svg>;
  }
  if (robot) {
    return <svg className="avatar avatar-robot" width={size} height={size} viewBox="0 0 64 64" aria-hidden>
      <rect x="9" y="2" width="46" height="60" rx="6" fill="#140b0c" stroke="var(--pink)" strokeWidth="2.5" />
      <path d="M18 30q4-16 14-8 10-8 14 8-7-5-14 0-7-5-14 0z" fill="var(--pink)" />
      <circle className="led" cx="18" cy="30" r="3" fill="var(--lime)" /><circle className="led" cx="46" cy="30" r="3" fill="var(--lime)" />
      <circle cx="32" cy="40" r="9" fill="#f4ede1" />
      <circle cx="28.5" cy="38" r="1.6" fill="#140b0c" /><circle cx="35.5" cy="38" r="1.6" fill="#140b0c" />
      <path d="M27 42q5 5 10 0" stroke="var(--pink)" strokeWidth="2" strokeLinecap="round" fill="none" />
      <text x="14" y="13" fontSize="8" fontWeight="900" fill="var(--pink)">J</text>
      <text x="50" y="58" fontSize="8" fontWeight="900" fill="var(--pink)" textAnchor="end">J</text>
    </svg>;
  }
  const suit = suits[index % suits.length];
  return <svg className={`avatar ${dead ? 'avatar-dead' : ''} ${talking ? 'avatar-talking' : ''}`} width={size} height={size} viewBox="0 0 64 64" aria-hidden>
    <rect x="9" y="2" width="46" height="60" rx="6" fill="#1a1415" stroke={color} strokeWidth="2.5" />
    <path d={pieces[index % pieces.length]} transform="translate(32 34) scale(.82) translate(-32 -28)" fill={color} />
    <rect x="21" y="49" width="22" height="4" rx="2" fill={color} />
    <text x="14" y="14" fontSize="9" fill={color}>{suit}</text>
    <text x="50" y="58" fontSize="9" fill={color} textAnchor="end">{suit}</text>
    {dead && <path d="M14 8 50 56" stroke="var(--pink)" strokeWidth="4" strokeLinecap="round" />}
  </svg>;
}

export function TwitchGlyph() {
  return <svg width="16" height="16" viewBox="0 0 24 24" aria-hidden fill="currentColor"><path d="M4.3 2 3 5.4v14h4.8V22h2.7l2.6-2.6H17l5-5V2H4.3Zm15.9 11.4-3 3h-4.8l-2.6 2.6v-2.6H5.8V3.8h14.4v9.6ZM17.2 7.1v5.2h-1.8V7.1h1.8Zm-4.8 0v5.2h-1.8V7.1h1.8Z" /></svg>;
}

export function Qr({ value, size = 168 }: { value: string; size?: number }) {
  const [src, setSrc] = useState('');
  useEffect(() => {
    QRCode.toDataURL(value, { margin: 1, width: size * 2, color: { dark: '#0b0909', light: '#ffffff' } }).then(setSrc).catch(() => setSrc(''));
  }, [value, size]);
  return src ? <img className="qr" src={src} width={size} height={size} alt={`QR code for ${value}`} /> : <div className="qr" style={{ width: size, height: size }} />;
}

export function Meter({ value }: { value: number }) {
  return <div className="meter"><i style={{ width: `${Math.max(0, Math.min(100, value))}%` }} /></div>;
}
