# Chat vs. GPT

**Who's the impostor?** A Twitch chat social deduction game. Viewers join with `!join`; one hidden player is controlled by an OpenAI model. This repository starts as an empty-repo MVP and now contains the playable app, game server, simulation mode, streamer view, and OBS browser source.

## Architecture

- React + TypeScript + Vite render the landing page, streamer game room, and overlay.
- An Express + Socket.IO server owns game state and deterministic rules. Independent sessions are keyed by channel. Hidden role/personality/objective stay in server memory and are returned only after game over.
- The AI receives recent discussion and public accusations, returns a structured speak/silence decision, and is rate-limited to one turn per 12 seconds.
- Twitch streamer sign-in uses the OAuth authorization-code flow. A dedicated bot account connects to Twitch IRC over TLS to receive commands and send AI/game messages. This keeps the MVP easy to run locally; see Twitch integration notes below.
- Development Simulation is a clearly marked local path. It lets you join simulated viewers, chat, accuse, vote, and finish the loop without presenting simulated messages as Twitch traffic.

## Run locally

Requirements: Node.js 20+ and npm.

```sh
cp .env.example .env
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000). Use **Development Simulation** on the landing page to try a full round without credentials. Add four sample viewers in the lobby, start the round, and use the simulation chat composer for normal messages, `!accuse name`, and `!vote name`. Discussion lasts 90 seconds and voting 45 seconds by default; the streamer can advance phases manually.

## Credentials and Twitch setup

### OpenAI

Set `OPENAI_API_KEY`. Optional `OPENAI_MODEL` defaults to `gpt-4o-mini`. Without a key the game rules work, but the AI remains quiet; there is no canned-response fallback.

### Streamer login

1. Register an app in the [Twitch Developer Console](https://dev.twitch.tv/console/apps).
2. Set the OAuth redirect URL to `http://localhost:3000/auth/twitch/callback` (or the public URL of your deployment plus `/auth/twitch/callback`).
3. Copy the client ID and secret into `TWITCH_CLIENT_ID` and `TWITCH_CLIENT_SECRET`; set the matching `TWITCH_REDIRECT_URI`.
4. Set a long random `SESSION_SECRET` outside local development.

The streamer login is used to identify the broadcaster and control only that broadcaster's live game. The OAuth callback validates state, exchanges the code server-side, and keeps the access token out of browser JavaScript.

### Chat bot account

1. Create a separate Twitch account for the game bot. Use a profile description that makes clear it is the game's bot account; the mystery is the in-game role, not ownership of the account.
2. Generate an OAuth user token for the bot with Twitch IRC's `chat:read` and `chat:edit` scopes (for local development, Twitch CLI can generate a test token). Set `TWITCH_BOT_USERNAME` and `TWITCH_BOT_OAUTH_TOKEN`.
3. The bot account must be able to join the streamer's chat. Keep its token in `.env`; never put it in frontend configuration.

The current MVP uses Twitch's secure IRC WebSocket (`wss://irc-ws.chat.twitch.tv:443`) because it supports the dedicated bot account with a straightforward local setup. Twitch's current docs recommend EventSub plus the Send Chat Message API for new chatbots; production deployment should migrate this adapter to EventSub and Twitch's chat API, including bot/broadcaster authorization, token refresh, reconnect handling, and subscription lifecycle. The current IRC client reconnects after disconnects but does not persist OAuth sessions or refresh credentials automatically.

## OBS overlay

While a game is active, use the **OBS URL** button in the game room to copy:

```text
https://your-app.example/overlay/yourchannel?overlay
```

Add it as an OBS Browser Source (typically 900 × 500). The page has a transparent background and subscribes to the same Socket.IO state as the dashboard, so it updates in real time without refresh. For local use, replace the hostname with `localhost:3000`.

## Commands

| Command | Effect |
| --- | --- |
| `!join` | Join the lobby |
| `!leave` | Leave before the game starts |
| `!players` | List living participants |
| `!status` | Show phase and round |
| `!help` | List commands |
| `!accuse username` | Record or replace an accusation during discussion |
| `!vote username` | Cast one vote during voting; no self-votes |

The game requires four human players by default, then adds exactly one AI player. Vote ties result in no elimination. Humans win by eliminating the AI; the AI wins when only one human remains. The streamer can pause, resume, or advance a phase in the dashboard.

## Current MVP boundaries

- Game state, sessions, and OAuth session metadata are in memory. Restarting the process clears active games and logins; use a persistent database and shared Socket.IO adapter before multi-instance hosting.
- A single process can host independent channel games, but the configured bot IRC connection is shared. Token refresh, EventSub, chat identity/profile lookup, and durable replay storage remain deployment work.
- The overlay and controls are real-time; timer ownership and all game outcomes stay on the server.
- No API key or Twitch token is required for the explicitly labeled simulation mode.
