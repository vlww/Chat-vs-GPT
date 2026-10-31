# Chat vs. GPT

**Who's the impostor?** A Twitch chat social deduction game. Viewers join with `!join`; one hidden player is controlled by an OpenAI model. This repository starts as an empty-repo MVP and now contains the playable app, game server, simulation mode, streamer view, and OBS browser source.

## Architecture

- React + TypeScript + Vite render the landing page, streamer game room, and overlay.
- An Express + Socket.IO server owns game state and deterministic rules. Independent sessions are keyed by channel. Hidden role/personality/objective stay in server memory and are returned only after game over.
- The AI receives recent discussion and public accusations, returns a structured speak/silence decision, and is rate-limited to one turn per 12 seconds.
- Twitch streamer sign-in uses OAuth authorization code. The bot receives chat through EventSub WebSockets and sends through Twitch’s Send Chat Message API. Bot tokens stay server-side and refresh automatically when a refresh token is configured.
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

Create an API key from the [OpenAI API keys page](https://platform.openai.com/api-keys) and set `OPENAI_API_KEY` in `.env`. Optional `OPENAI_MODEL` defaults to `gpt-4o-mini`. API usage is billed separately from a ChatGPT subscription, so configure API billing before expecting live AI turns. Without a key the game rules work, but the AI remains quiet; there is no canned-response fallback.

### Streamer login

1. Verify your Twitch account email and enable 2FA, then register one app in the [Twitch Developer Console](https://dev.twitch.tv/console/apps). Twitch currently requires both for developer registration.
2. Set its OAuth redirect URL to exactly `http://localhost:3000/auth/twitch/callback` for local use. For a hosted app, register the full public callback URL instead.
3. Copy the app’s client ID and generate a client secret. Put them in `TWITCH_CLIENT_ID` and `TWITCH_CLIENT_SECRET`; keep the secret private. Set the same callback in `TWITCH_REDIRECT_URI`.
4. Set a long random `SESSION_SECRET` outside local development. Streamer sign-in requests no additional Twitch scopes; it only identifies the streamer.

The streamer login is used to identify the broadcaster and control only that broadcaster's live game. The OAuth callback validates state, exchanges the code server-side, and keeps the access token out of browser JavaScript.

### Chat bot account and EventSub

1. Create a separate Twitch account for the game bot. Make its profile clear that it is the game’s bot account; the mystery is the in-game role, not ownership.
2. Install the official Twitch CLI, then configure it with the same Twitch app client ID and secret:

   ```sh
   brew install twitchdev/twitch/twitch-cli
   twitch configure
   ```

3. Generate the bot account’s user token with the exact scopes required by Twitch’s current chatbot example:

   ```sh
   twitch token --user-token --scopes 'user:bot user:read:chat user:write:chat'
   ```

   Sign in as the bot account in the browser that opens. The CLI prints an access token and refresh token. Put the bot’s login in `TWITCH_BOT_USERNAME`, and put those two token values in `TWITCH_BOT_OAUTH_TOKEN` and `TWITCH_BOT_REFRESH_TOKEN` in `.env`. Never paste tokens into chat or frontend code. The app validates the token, confirms its scopes/account, and automatically refreshes it; refreshed values are saved back to `.env`.

4. If Twitch refuses the bot’s chat messages, grant the bot moderator status in the channel with `/mod bot_login`.
5. Start the server and connect the streamer account through the app. Starting a live game creates the `channel.chat.message` EventSub WebSocket subscription for that broadcaster. The AI and game responses are sent with Helix `POST /chat/messages`.

Twitch recommends EventSub for receiving chat and the Send Chat Message API for sending; this app uses those interfaces rather than legacy IRC. The EventSub socket reconnects and restores active game subscriptions. Twitch’s WebSocket flow does not report chat joins/leaves, so inactive viewers are not automatically removed from a game.

## Production deployment

The Vercel site serves the Vite frontend and proxies `/api/*`, `/auth/*`, and `/overlay/*` to the persistent backend. The backend needs a running Node process for Twitch EventSub and the in-memory game state, so deploy it as a Render web service using `render.yaml`. Keep one Render instance because active games currently live in process memory.

1. Deploy this GitHub repository as a Render Blueprint using `render.yaml`. Render builds with `npm ci && npm run build`, starts with `npm start`, and checks `/api/health`.
2. Set the server variables in Render: `TWITCH_CLIENT_ID`, `TWITCH_CLIENT_SECRET`, `TWITCH_REDIRECT_URI=https://chat-vs-gpt.vercel.app/auth/twitch/callback`, `TWITCH_BOT_USERNAME`, `TWITCH_BOT_OAUTH_TOKEN`, `TWITCH_BOT_REFRESH_TOKEN`, `OPENAI_API_KEY` (or update the AI provider integration), and a long random `SESSION_SECRET`. Add `OPENAI_MODEL` only if changing the default. Do not set `PORT`; Render supplies it.
3. Use the Render service's HTTPS URL as `BACKEND_ORIGIN` in Vercel. Set `VITE_SOCKET_ORIGIN` to that same HTTPS origin in Vercel so the browser can open the Socket.IO connection to Render.
4. Import the GitHub repository into Vercel. It uses `vercel.ts` to build the frontend and proxy API, OAuth, and overlay requests to `BACKEND_ORIGIN`. Set both Vercel variables for the Production environment, then deploy.
5. In the Twitch Developer Console, use `https://chat-vs-gpt.vercel.app/auth/twitch/callback` as the app’s OAuth redirect URI. It must match `TWITCH_REDIRECT_URI` exactly. Redeploy Railway after changing its environment variables.

The Vercel URL is the public app and Twitch callback domain. Render hosts the live game process; its generated URL is only used for the browser’s Socket.IO connection and as Vercel’s API origin. The Render Blueprint uses its free plan, which can spin down after inactivity; choose an always-on plan if the bot must remain connected while nobody has the app open.

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
- A single process can host independent channel games over one EventSub WebSocket, but games and session metadata are in memory. Durable storage, multi-instance coordination, and extended Twitch profile lookups remain deployment work.
- The overlay and controls are real-time; timer ownership and all game outcomes stay on the server.
- No API key or Twitch token is required for the explicitly labeled simulation mode.
