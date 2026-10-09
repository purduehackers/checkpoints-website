# Checkpoints Website

Checkpoints Website is a planned web app for running Hack Night Checkpoints at Purdue Hackers.

Right now every presenter walks up with a laptop and plugs in over HDMI or USB C. Screen sharing breaks, people stand in line holding their laptops, and organizers have to cut in when someone goes over two minutes. This project moves all of that to the browser.

An organizer starts a checkpoint session and a join code shows up on the projector, much like a Kahoot lobby. Hackers log in with their Squid account, enter the code, and pick the screen or window they want to share while still at their seats. The page shows their place in the queue and a small preview of their share. When they are next, the page plays a sound, sends a browser notification, and highlights itself. At the podium they press Ready and their screen goes up. A countdown appears for the last 15 seconds and the share turns off on its own at two minutes.

Organizers get an admin panel to see the queue, preview each share before it goes live, and remove people when needed. If someone cannot connect, an organizer can help them while the next person presents.

The full plan is in PRD.docx. It covers the user flow, the MVP goals, and the features planned after the MVP, such as checkpoint recordings and a history of past checkpoints on the home page.

## Run it

Needs [Bun](https://bun.sh). Copy `.env.example` to `.env` and fill it in (leave the Turso vars unset to use a local `local.db` file).

```
bun install
bun dev          # Elysia on :3000 + Astro on :4321 (proxies /api). Open http://localhost:4321
                 # Astro's dev server runs in the background; stop it with `bunx astro dev stop`
bun test         # queue logic tests (in-memory db)
bun run build    # static site into dist/
```

| Page | Who |
|---|---|
| `/` | Hackers: join, share from your seat, Ready, End |
| `/admin` | Organizer (passcode = `ADMIN_PASSCODE`): start/end, call next, preview, skip, remove, stop, stream quality, projector sound on/off |
| `/host` | Projector: lobby, live share with name bar and 15s countdown, presenter's audio. **Log in at `/admin` on the projector machine first**: only a `/host` holding the admin token gets the live stream (others see the name only), so presenters watching `/host` on their laptops can't loop audio or add encodes. |

Browsers only allow screen sharing and notifications on `localhost` or HTTPS. Sound sharing needs Chrome or Edge (Firefox and Safari share video only). If the projector stays silent, click Fullscreen once (autoplay needs a click) or set the site's Sound permission to Allow.

**Stats for nerds:** button or right-click on any page. Shows the presenter's send fps, resolution, video/audio bitrate, RTT, loss, what's limiting quality (`cpu` / `bandwidth`), direct vs relayed path and viewer count. `/host` and `/admin` receive it from the presenter over the VDO.Ninja data channel.

## How it works

- `server/queue.ts` holds all SQL and every state transition. Turso is the only source of truth, so a restart loses nothing.
- `server/index.ts` is the Elysia app: REST actions plus one WebSocket (`/api/ws`) that pushes each client its own view of the state. Every second each instance runs `expire()` (the server-owned 2:00 cutoff) and re-sends any view that changed.
- `src/lib/vdo.tsx` holds the VDO.Ninja sharing and viewing (`src/lib/stats.tsx` only uses its data channel). Hackers capture their screen on our page (`getDisplayMedia`, so we know exactly when sharing starts and stops) and publish it with the [VDO.Ninja SDK](https://github.com/steveseguin/ninjasdk) (`@vdoninja/sdk`, MPL-2.0), which handles signalling, peer connections and TURN. Admin preview and projector watch it in plain `vdo.ninja/?view=<id>` iframes. The server only hands out private stream IDs (admin, and the logged-in projector while someone is live).
- Quality is set on the sender: the SDK publisher ignores vdo.ninja viewer params like `&bitrate`/`&scale`, so the presenter's browser caps the capture (`applyConstraints`, `crop-and-scale`) and the encoder bitrate from the organizer's preset. Audio is captured raw (no echo cancel/denoise/auto gain), sent at 128 kbps, and muted until the presenter is live; the projector's `&stereo` makes it stereo.
- Hacker identity is a random token in `localStorage`. No Squid yet.

## Deploy (Vercel Pro)

One project: Astro static build plus `api/server.ts` as a Bun function with native WebSockets (Fluid compute, public beta). Set `TURSO_DATABASE_URL`, `TURSO_AUTH_TOKEN`, `ADMIN_PASSCODE` in the project (Production and Preview). `vercel.json` sets `bunVersion`, rewrites `/api/*` and sends anti-framing headers.

## Security notes

- **Use a long random `ADMIN_PASSCODE`** (20+ characters). Login is rate limited per IP, but the passcode is the real defence. Changing it signs every organizer and the projector out.
- **The projector holds the admin token** (it logged in at `/admin`). Don't leave it unattended and unlocked.
- **Limits** (in `server/index.ts`, per server instance): requests and sockets per IP, total sockets, socket message size, request body size, and a 200-person waiting line. They're sized so a whole room behind one campus IP still works. If the line gets spammed, end the checkpoint and start a new one.
- Names are cleaned of control and invisible characters before they reach the projector. Stats from a presenter's browser are treated as untrusted.
- Until Squid login, anyone can join from a new browser; there are no accounts to ban.

## Not verified yet (do these first)

- **VDO.Ninja on real laptops and campus Wi-Fi.** Tested end to end in automated Chrome with a fake tab share (quality switch, live-only audio, projector-only stream, stats relay). Not yet tried across two real laptops or on campus Wi-Fi: open Stats for nerds and watch `limited by` and `path` (relay = TURN).
- **Vercel deploy.** WebSocket routing through the `/api/:path*` rewrite and `Bun.serve` via Elysia's `listen()` are untested. The socket closes at max duration; the client reconnects on its own.
- **Poll cost.** `TICK_MS` is 1s (marked `??` in `server/index.ts`). Each tick is a constant few Turso reads per instance, not per socket.
- **Mobile Safari/phones** show "use a laptop to share".

Post-MVP: Squid login, recording, mic picker, moderation. The old prototype (recording, mic finder, designs) is in git history before this branch.
