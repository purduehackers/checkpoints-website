# Development

How to run, test and deploy Checkpoints. For running a checkpoint night, see the [README](../README.md). Product docs: [MVP_PLAN.md](MVP_PLAN.md) and [USER_STORIES.md](USER_STORIES.md).

## Run it

Needs [Bun](https://bun.sh) (or `direnv allow` with Nix). Copy `.env.example` to `.env` and fill it in. Leave the Turso vars unset to use a local `local.db` file.

Sign-in needs an application in [Purdue Hackers ID](https://id.purduehackers.com) (Applications → new) with the scopes `openid`, `profile` and `roles` and the redirect URL `http://localhost:4321/api/auth/callback`. Put its client ID in `ID_CLIENT_ID` (and `ID_CLIENT_SECRET` if you made it confidential), and set `SESSION_SECRET`. To work against a local ID instead, run it from `../id` and set `ID_ISSUER=http://localhost:5173/api/auth`. To get to `/admin`, your ID account needs the organizer role.

```
bun install
bun dev          # Elysia on :3000 + Astro on :4321 (proxies /api). Open http://localhost:4321
                 # Astro's dev server runs in the background; stop it with `bunx astro dev stop`
bun test         # queue logic + API, auth and abuse tests (in-memory db, fake ID)
bun run build    # static site into dist/
```

Browsers only allow screen sharing, camera access and notifications on `localhost` or HTTPS. Testing from a phone on the LAN over plain http won't work; use a tunnel (for example Cloudflare or ngrok) or a deployed preview.

## How it works

- `server/queue.ts` holds all SQL and every state transition. Turso is the only source of truth, so a restart loses nothing. `snapshot()` reads a session and its entries; `view()` turns that into one client's state.
- `server/index.ts` is the Elysia app: REST actions plus one WebSocket (`/api/ws`) that pushes each client its own view. Every second each instance runs `expire()` (the server-owned cutoff), takes one snapshot, and re-sends any view that changed.
- Invariant: if the stage is empty and someone is waiting, the first waiting entry is `called`. `advance()` (one atomic UPDATE) runs after `join` and at the end of every `expire()` (each tick and each reply), so it also heals slots finished by older code sharing the database.
- Closing a hacker tab: `pagehide` beacons `POST /api/bye`, which sets `queue_entries.bye_at`. A new socket hello (or any hacker action) clears it; if it is still set after 15s (`BYE_GRACE_MS`), `expire()` marks the entry `left` and auto-advances if they were called/live. A Wi-Fi blip fires no `pagehide`, so it never kicks anyone.
- `src/lib/vdo.tsx` holds VDO.Ninja sharing and viewing. Hackers capture their screen on our page (`getDisplayMedia`, so we know exactly when sharing starts and stops) and publish it with the [VDO.Ninja SDK](https://github.com/steveseguin/ninjasdk) (`@vdoninja/sdk`, MPL-2.0), which handles signalling, peer connections and TURN. Admin preview and projector watch plain `vdo.ninja/?view=<id>` iframes. The server only hands out private stream IDs (to the admin, and to /host while someone is live).
- Quality is set on the sender: the SDK publisher ignores vdo.ninja viewer params like `&bitrate`/`&scale`, so the presenter's browser caps the capture (`applyConstraints`, `crop-and-scale`) and the encoder bitrate from the organizer's preset. Audio is captured raw (no echo cancel/denoise/auto gain), sent at 128 kbps, and muted until the presenter is live; the projector's `&stereo` makes it stereo.
- `src/lib/stats.tsx` is "Stats for nerds": the presenter measures its own send stats and pipes them over the VDO.Ninja data channel; `/host` and `/admin` listen with a data-only viewer.
- Live reactions (`src/lib/reactions.tsx`): queued hackers send `{react: emoji}` over their socket; the server checks the allowlist, a 200ms per-socket cooldown and the organizer's Reactions toggle (`sessions.reactions`), counts them in memory and sends hosts one `{reactions: {emoji: n}}` message per 250ms. Spam guard: 8 taps inside the cooldown within 3s is an offense; the first shows the hacker a warning, a repeat within 2 minutes starts 30s of slow mode (one reaction per 2s). Nothing is stored, and counts are per instance, so a host on another instance won't see them (fine for a room this size). The projector animates with plain DOM + Web Animations, capped at 80 emojis in flight.
- Organizers sign in with Purdue Hackers ID over OIDC (`server/auth.ts`, using [`openid-client`](https://github.com/panva/openid-client)): `/api/auth/login` → ID → `/api/auth/callback` (code flow, PKCE, state and nonce, ID token signature check), then userinfo for `name` and `roles`. The result is a stateless HMAC-signed HttpOnly cookie `{ sub, name, organizer }` that lasts 12 hours, so any instance can read it and Turso stores nothing about users. Role changes in ID apply at the next sign-in.
- Organizer actions and the admin socket need `roles` to include `organizer` (ID's `admin` role grants it). Hackers don't sign in: their identity is a random token in `localStorage`. `/host` stays public.
- Cookies are `SameSite=Lax`, which still lets other `*.purduehackers.com` sites send them, so every non-GET request and every socket hello checks that `Origin` matches the host.

## Deploy (Vercel Pro)

One project: Astro static build plus `api/server.ts` as a Bun function with native WebSockets (Fluid compute, public beta). Set `TURSO_DATABASE_URL`, `TURSO_AUTH_TOKEN`, `ID_CLIENT_ID`, `ID_CLIENT_SECRET` (if confidential) and `SESSION_SECRET` for both Production and Preview. Register `https://<domain>/api/auth/callback` in the ID application for every domain people sign in on: a preview URL that isn't registered can't sign in. `vercel.json` sets `bunVersion`, rewrites `/api/*` and sends anti-framing headers.

## Limits

These live in `server/index.ts` and are counted per server instance. They're sized so a whole room behind one campus IP still works:

- requests and sockets per IP
- total sockets
- socket message size and request body size
- the waiting line (`MAX_WAITING` in `server/queue.ts`)

Names are cleaned of control and invisible characters. Stats from a presenter's browser are treated as untrusted.

## Not verified yet

- **VDO.Ninja on real laptops and campus Wi-Fi.** It has been tested end to end in automated Chrome with a fake tab share, but not yet across two real laptops or on campus Wi-Fi. Open Stats for nerds and watch `limited by` and `path` (relay = TURN).
- **Vercel deploy.** WebSocket routing through the `/api/:path*` rewrite is untested. The socket closes at max duration; the client reconnects on its own.
- **Poll cost.** `TICK_MS` is 1s (marked `??` in `server/index.ts`). Each tick is a constant few Turso reads per instance, not per socket.

Post-MVP: Recording, mic picker, moderation. The old prototype (recording, mic finder, designs) is in git history.
