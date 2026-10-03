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
| `/admin` | Organizer (passcode = `ADMIN_PASSCODE`): start/end, call next, preview, skip, remove, stop |
| `/host` | Projector: lobby, live share with name bar and 15s countdown. No audio: presenters talk to the room. |

Browsers only allow screen sharing and notifications on `localhost` or HTTPS.

## How it works

- `server/queue.ts` holds all SQL and every state transition. Turso is the only source of truth, so a restart loses nothing.
- `server/index.ts` is the Elysia app: REST actions plus one WebSocket (`/api/ws`) that pushes each client its own view of the state. Every second each instance runs `expire()` (the server-owned 2:00 cutoff) and re-sends any view that changed.
- `src/lib/vdo.tsx` is the only file that knows about VDO.Ninja. Hackers capture their screen on our page (`getDisplayMedia`, so we know exactly when sharing starts and stops) and publish it with the [VDO.Ninja SDK](https://github.com/steveseguin/ninjasdk) (`@vdoninja/sdk`, MPL-2.0), which handles signalling, peer connections and TURN. Admin preview and projector watch it in plain `vdo.ninja/?view=<id>` iframes. The server only hands out private stream IDs (admin, and the host while someone is live).
- Hacker identity is a random token in `localStorage`. No Squid yet.

## Deploy (Vercel Pro)

One project: Astro static build plus `api/server.ts` as a Bun function with native WebSockets (Fluid compute, public beta). Set `TURSO_DATABASE_URL`, `TURSO_AUTH_TOKEN`, `ADMIN_PASSCODE` in the project. `vercel.json` sets `bunVersion` and rewrites `/api/*`.

## Not verified yet (do these first)

- **VDO.Ninja on real laptops and campus Wi-Fi.** Tested end to end in automated Chrome with a fake screen (hacker preview, admin preview, projector, stop/share again). Not yet tried across two real laptops or on campus Wi-Fi.
- **Vercel deploy.** WebSocket routing through the `/api/:path*` rewrite and `Bun.serve` via Elysia's `listen()` are untested. The socket closes at max duration; the client reconnects on its own.
- **Poll cost.** `TICK_MS` is 1s (marked `??` in `server/index.ts`).
- **Mobile Safari/phones** show "use a laptop to share".

Post-MVP: Squid login, recording, mic picker, moderation. The old prototype (recording, mic finder, designs) is in git history before this branch.
