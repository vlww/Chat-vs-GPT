# Chat vs GPT

**A room of suspects. One of them is AI. Chat decides.**

Chat vs GPT is a social deduction game for Twitch. A few viewers take seats as suspects and talk under shuffled codenames. One seat is secretly an AI. The rest of chat is the jury: viewers grill the room with `!ask` and type `!vote` to unmask one suspect per round. If chat unmasks the AI, chat wins. If chat keeps guessing wrong until only one human is left, the AI wins.

- Live site: https://chat-vs-gpt.vercel.app
- Everything needed to run it is in this repository: source code (`src/`, `server/`), assets (inline SVG in `src/ui.tsx`, styles in `src/style.css`), config (`.env.example`, `render.yaml`, `vercel.ts`) and the instructions below.

---

## Setup and run

### 1. Requirements

- [Node.js](https://nodejs.org) **20 or newer** (includes npm)
- Git
- Optional: an [Anthropic API key](https://console.anthropic.com) for real AI turns
- Optional: a [Twitch developer app](https://dev.twitch.tv/console/apps) to host games in a real Twitch chat

### 2. Install

```sh
git clone https://github.com/vlww/Chat-vs-GPT.git
cd Chat-vs-GPT
npm install
cp .env.example .env
```

### 3. Run it (no keys needed)

```sh
npm run dev
```

Open http://localhost:3000 and click **Play the demo**. You sit at the table as a suspect next to four simulated viewers and one hidden AI, with simulated chat as the jury. Without any keys, every player uses scripted lines, so the full game (deal, talk, vote, reveal, recap) is playable right away.

### 4. Turn on the real AI

Add your key to `.env` and restart `npm run dev`:

```sh
ANTHROPIC_API_KEY=sk-ant-...
ANTHROPIC_MODEL=claude-opus-5-5
```

The hidden AI seat (and the simulated players in the demo) now talk through Claude.

### 5. Connect Twitch (to host in your own channel)

1. Go to the [Twitch Developer Console](https://dev.twitch.tv/console/apps) and click **Register Your Application**.
2. Add this OAuth Redirect URL: `http://localhost:3000/auth/twitch/callback` (add your production URL too if you deploy, for example `https://YOUR-SITE/auth/twitch/callback`).
3. Category: **Game Integration**. Create it, then copy the **Client ID** and generate a **Client Secret**.
4. Fill in `.env`:

   ```sh
   TWITCH_CLIENT_ID=your_client_id
   TWITCH_CLIENT_SECRET=your_client_secret
   TWITCH_REDIRECT_URI=http://localhost:3000/auth/twitch/callback
   SESSION_SECRET=any_long_random_string
   ```

5. Restart `npm run dev`, open http://localhost:3000 and click **Host on Twitch**. Approve the chat permissions (`user:read:chat`, `user:write:chat`).

### 6. Play a live game on Twitch

1. After signing in, the host screen opens at `/game/<your_channel>`. Show it on stream, or add `http://localhost:3000/overlay/<your_channel>` as an OBS **Browser Source** (1920×1080).
2. The game posts a join link and a 4-letter room code in your chat. Suspects open it on their phones (`/play/<CODE>`) and take a seat. At least 2 human suspects are needed.
3. Click **Deal the cards**. Each round the room gets a prompt, suspects answer, and chat uses `!ask` and `!vote`.

### 7. Build for production

```sh
npm run build
npm start          # serves the built site and the game server on PORT (default 3000)
```

### Environment variables

| Variable | Required | What it does |
| --- | --- | --- |
| `ANTHROPIC_API_KEY` | No | Real AI turns. Without it, scripted lines are used |
| `ANTHROPIC_MODEL` | No | Model id, defaults to `claude-opus-5-5` |
| `TWITCH_CLIENT_ID` / `TWITCH_CLIENT_SECRET` | For Twitch | From your Twitch developer app |
| `TWITCH_REDIRECT_URI` | For Twitch | Must exactly match a redirect in the Twitch console |
| `SESSION_SECRET` | For Twitch | Any long random string, signs login sessions |
| `PUBLIC_URL` | No | Public site URL used in join links (defaults to the redirect's origin) |
| `TWITCH_BOT_*` | No | Optional separate bot account for narration (see below) |
| `VITE_SOCKET_ORIGIN` | Split hosting only | Backend URL when the frontend is hosted separately |
| `PORT` | No | Server port, defaults to 3000 |

### Troubleshooting

- **"redirect_mismatch" on Twitch sign in:** the redirect in `.env` must match the Twitch console exactly, including `http` vs `https`.
- **The game doesn't react to chat:** sign in again with **Host on Twitch** and approve the chat permissions.
- **AI players only use short scripted lines:** `ANTHROPIC_API_KEY` is missing or has no credit.
- Games live in memory, so restarting the server ends any game in progress.

---

## How a round works

1. **Grab a seat.** The streamer opens a table. The stream shows a QR code, link and room code, and the game posts the link in chat. Suspects join at `/play`, by signing in with Twitch or typing their name.
2. **Deal.** Every human suspect plus one AI seat gets a random codename (`lucky`, `velvet`, `ace`…) and a playing card avatar, and the seat order is shuffled. Nobody, including the streamer, can tell which seat is the AI.
3. **Talk (90s).** The room gets a prompt like "What did you eat today? Be specific." Suspects chat, and chat sends questions into the room with `!ask`.
4. **Vote (30s).** Chat types `!vote velvet` (or the seat number), and suspects vote from their phones. Tallies update live.
5. **Unmask.** The most-voted suspect is revealed. A human shows their Twitch name and the game goes on. Catching the AI ends the game. Ties unmask nobody.

### Why the AI is hard to spot

- the same avatar style, shuffled seat order and codename pool as everyone else
- realistic typing delays, so it never replies instantly
- a new typing style each game and a different message length each turn
- output cleanup that strips em dashes, tidy punctuation and anything that leaks its AI identity
- a hidden personality and a secret goal, revealed in the end-of-game recap

## Chat commands

| Command | Effect |
| --- | --- |
| `!join` | Replies with the seat link and room code |
| `!ask <question>` | Sends a question into the room during the talk phase (rate-limited) |
| `!vote <name or number>` | Votes during the vote phase. Your latest vote counts |
| `!suspects` | Lists the suspects still in |
| `!help` | Explains how to play |

## Pages

| Path | What it is |
| --- | --- |
| `/` | Landing page with a playable demo |
| `/game/<channel>` | Host stage: capture this window on stream |
| `/play/<CODE>` | Suspect phone page (join, codename, chat, vote) |
| `/overlay/<channel>` | Transparent OBS browser source (HUD, suspects, latest lines, reveals) |

## Architecture

- **Frontend:** React, TypeScript and Vite (`src/`). The landing page, host stage, phone page and OBS overlay share one realtime state.
- **Game server:** Express and Socket.IO (`server/`). The server owns all state and timers. Public state never includes a seat's role or owner until that seat is unmasked.
  - `server/game.ts`: rules, phases, voting, the AI seat scheduler and the demo simulation
  - `server/ai.ts`: Claude via the Anthropic SDK (structured JSON output), prompts and output cleanup
  - `server/twitch.ts`: token refresh, the EventSub WebSocket (`channel.chat.message`) and Helix Send Chat Message
  - `server/content.ts`: codenames, prompts, personas and fallback lines

**Optional bot account.** To narrate from a separate account, generate its token with the [Twitch CLI](https://dev.twitch.tv/docs/cli/) (`twitch token --user-token --scopes 'user:bot user:read:chat user:write:chat'`) and set the `TWITCH_BOT_*` variables. If Twitch drops the bot's messages, `/mod` it in your channel.

## Deploy

- **Backend (Render):** `render.yaml` runs one Node service (EventSub and in-memory games need one persistent process). Build: `npm install --include=dev && npm run build`. Start: `npm run start`. Set `ANTHROPIC_API_KEY`, `TWITCH_CLIENT_ID`, `TWITCH_CLIENT_SECRET`, `TWITCH_REDIRECT_URI`, `PUBLIC_URL` and `SESSION_SECRET`.
- **Frontend (Vercel):** `vercel.ts` builds the Vite app and proxies `/api/*` and `/auth/*` to `BACKEND_ORIGIN`. Set `BACKEND_ORIGIN` and `VITE_SOCKET_ORIGIN` to the backend URL.
