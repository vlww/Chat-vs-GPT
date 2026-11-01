# Chat vs GPT

**A room of suspects. One of them is AI. Chat decides.**

Chat vs GPT is a social deduction game for Twitch. A few viewers take seats as suspects and talk under codenames that get shuffled when the cards are dealt. One seat is secretly GPT. The rest of chat is the jury: viewers grill the room with `!ask` and type `!vote` to unmask one suspect per round. If chat unmasks GPT, chat wins. If GPT makes it to the final two, GPT wins.

Live: https://chat-vs-gpt.vercel.app

## How a round works

1. **Grab a seat.** The streamer opens a table. The stream shows a QR code, a link and a 4-letter room code, and the bot posts the link in chat. Suspects join on their phones at `/play`, either by signing in with Twitch or by typing their name.
2. **Deal.** Every human suspect plus one GPT seat gets a random codename (`lucky`, `velvet`, `ace`…) and a playing card with a chess piece, and the seat order is shuffled. Nobody, including the streamer, can tell which seat is which.
3. **Talk (90s).** The room gets a prompt like "What did you eat today? Be specific." Suspects chat from their phones and the conversation shows up on stream. Chat sends questions into the room with `!ask`.
4. **Vote (30s).** Chat types `!vote otter` (or the seat number), and suspects vote from their phones. The tallies update live on stream.
5. **Unmask.** The most-voted suspect is flipped. A human shows their Twitch name and the game goes on. GPT ends the game. Ties unmask nobody.

### Why GPT can't be spotted by its name

Everything a suspect says goes through the game under its codename. The bot account in chat only narrates. GPT also gets the same treatment as the human seats:
- the same avatar style, shuffled seat order and codename pool
- realistic typing delays, so it never replies instantly
- the same chance as every other seat to pick up a chat question
- output cleanup that strips em dashes, tidy punctuation and anything that leaks its AI identity
- a hidden personality and a secret goal (for example "Convince the room that moth is the AI"), revealed in the end-of-game recap

## Chat commands

| Command | Effect |
| --- | --- |
| `!join` | The bot replies with the seat link and room code |
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

## Demo mode

**Play the demo** seats you as a suspect next to four simulated viewers and GPT, with simulated Twitch chat as the jury. With `ANTHROPIC_API_KEY` set, every simulated player is Claude-driven, and each has its own typing style. Without a key, everyone (GPT included) falls back to the same scripted, on-prompt lines, so the game is still fully playable.

## Run locally

Requires Node.js 20+.

```sh
cp .env.example .env     # add ANTHROPIC_API_KEY for real AI turns
npm install
npm run dev              # http://localhost:3000
```

## Architecture

- **Frontend:** React, TypeScript and Vite (`src/`). The landing page, host stage, phone page and OBS overlay all share one realtime state.
- **Game server:** Express and Socket.IO (`server/`). The server owns all state and timers. Public state never includes a seat's role or owner until that seat is unmasked. Each suspect's codename is sent only to that suspect's socket.
  - `server/game.ts`: rules, phases, voting, the bot-seat scheduler and the demo simulation
  - `server/ai.ts`: Claude via the Anthropic SDK (structured JSON output, low effort for chat speed), plus prompts and output cleanup
  - `server/twitch.ts`: token validation and refresh, the EventSub WebSocket (`channel.chat.message`) and Helix Send Chat Message, through a bot account or the streamer's own sign-in
  - `server/content.ts`: codenames, prompts, personas and fallback lines

## Twitch setup

1. Register an app in the [Twitch Developer Console](https://dev.twitch.tv/console/apps). Add the OAuth redirects `http://localhost:3000/auth/twitch/callback` and `https://chat-vs-gpt.vercel.app/auth/twitch/callback`, then put the client ID, secret and redirect in `.env`.
2. Start the server and click **Host on Twitch**. Twitch asks the streamer to allow `user:read:chat` and `user:write:chat`, and the game reads commands and narrates from the streamer's account.
3. Capture `/game/<channel>` on stream, or add the overlay URL as an OBS browser source at 1920×1080.

**Optional bot account.** To narrate from a separate account, generate its token with the [Twitch CLI](https://dev.twitch.tv/docs/cli/) (`twitch token --user-token --scopes 'user:bot user:read:chat user:write:chat'`) and set the `TWITCH_BOT_*` variables. Tokens refresh automatically. If Twitch drops the bot's messages, `/mod` it in your channel.

## Deploy

- **Backend (Render):** `render.yaml` runs one Node service (EventSub and in-memory games need one persistent process). Set `ANTHROPIC_API_KEY`, `TWITCH_CLIENT_ID`, `TWITCH_CLIENT_SECRET` and `SESSION_SECRET`.
- **Frontend (Vercel):** `vercel.ts` builds the Vite app and proxies `/api/*` and `/auth/*` to `BACKEND_ORIGIN`. Set `BACKEND_ORIGIN` and `VITE_SOCKET_ORIGIN` to the Render URL.

Games live in memory, so restarting the backend ends any game in progress.
