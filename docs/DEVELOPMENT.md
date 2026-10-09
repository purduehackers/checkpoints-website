# Development

How to run, test and deploy Checkpoints. For running a checkpoint night, see the [README](../README.md). Product docs: [MVP_PLAN.md](MVP_PLAN.md) and [USER_STORIES.md](USER_STORIES.md).

## Run it

Needs [Bun](https://bun.sh). Copy `.env.example` to `.env` and fill it in. Leave the Turso vars unset to use a local `local.db` file.

```
bun install
bun dev          # Elysia on :3000 + Astro on :4321 (proxies /api). Open http://localhost:4321
                 # Astro's dev server runs in the background; stop it with `bunx astro dev stop`
bun test         # queue logic + API abuse tests (in-memory db)
bun run build    # static site into dist/
```

Browsers only allow screen sharing and notifications on `localhost` or HTTPS.

## How it works

- `server/queue.ts` holds all SQL and every state transition. Turso is the only source of truth, so a restart loses nothing. `snapshot()` reads a session and its entries; `view()` turns that into one client's state.
- `server/index.ts` is the Elysia app: REST actions plus one WebSocket (`/api/ws`) that pushes each client its own view. Every second each instance runs `expire()` (the server-owned cutoff), takes one snapshot, and re-sends any view that changed.
- `src/lib/vdo.tsx` holds VDO.Ninja sharing and viewing. Hackers capture their screen on our page (`getDisplayMedia`, so we know exactly when sharing starts and stops) and publish it with the [VDO.Ninja SDK](https://github.com/steveseguin/ninjasdk) (`@vdoninja/sdk`, MPL-2.0), which handles signalling, peer connections and TURN. Admin preview and projector watch plain `vdo.ninja/?view=<id>` iframes. The server only hands out private stream IDs (to the admin, and to /host while someone is live).
- Quality is set on the sender: the SDK publisher ignores vdo.ninja viewer params like `&bitrate`/`&scale`, so the presenter's browser caps the capture (`applyConstraints`, `crop-and-scale`) and the encoder bitrate from the organizer's preset. Audio is captured raw (no echo cancel/denoise/auto gain), sent at 128 kbps, and muted until the presenter is live; the projector's `&stereo` makes it stereo.
- `src/lib/stats.tsx` is "Stats for nerds": the presenter measures its own send stats and pipes them over the VDO.Ninja data channel; `/host` and `/admin` listen with a data-only viewer.
- Hacker identity is a random token in `localStorage`. No Squid yet.

## Deploy (Vercel Pro)

One project: Astro static build plus `api/server.ts` as a Bun function with native WebSockets (Fluid compute, public beta). Set `TURSO_DATABASE_URL`, `TURSO_AUTH_TOKEN` and `ADMIN_PASSCODE` for both Production and Preview. `vercel.json` sets `bunVersion`, rewrites `/api/*` and sends anti-framing headers.

## Limits

These live in `server/index.ts` and are counted per server instance. They're sized so a whole room behind one campus IP still works:

- requests and sockets per IP
- total sockets
- socket message size and request body size
- login attempts per IP
- the waiting line (`MAX_WAITING` in `server/queue.ts`)

Names are cleaned of control and invisible characters. Stats from a presenter's browser are treated as untrusted.

## Not verified yet

- **VDO.Ninja on real laptops and campus Wi-Fi.** It has been tested end to end in automated Chrome with a fake tab share, but not yet across two real laptops or on campus Wi-Fi. Open Stats for nerds and watch `limited by` and `path` (relay = TURN).
- **Vercel deploy.** WebSocket routing through the `/api/:path*` rewrite is untested. The socket closes at max duration; the client reconnects on its own.
- **Poll cost.** `TICK_MS` is 1s (marked `??` in `server/index.ts`). Each tick is a constant few Turso reads per instance, not per socket.

Post-MVP: Squid login, recording, mic picker, moderation. The old prototype (recording, mic finder, designs) is in git history.
