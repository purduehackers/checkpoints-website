# Checkpoints: One-Week MVP Plan

**Goal:** by the end of day 7, run a real checkpoint end to end in front of people. Hackers join from their seats with a code, share their screen while they wait, get pinged when they're next, press Ready at the podium, go live on the projector, and get cut off at 2:00, all without an HDMI cable.

This plan covers functionality only. Visual polish comes after the MVP. Stories are in [`USER_STORIES.md`](./USER_STORIES.md).

---

## What "MVP done" means

The showcase works if all of these hold during a live run with at least 5 laptops:

1. The organizer starts a session, and the projector shows the join code and the live queue.
2. Hackers join with the code, their name and their project, then share a screen from their seats and see their position and a preview.
3. The person next in line gets a sound, a notification and a highlighted page.
4. The organizer previews the next share, then presses **Call next**. The hacker's page dims to a **Ready** button.
5. On Ready, the share appears on the projector with the hacker's name and project.
6. A countdown shows for the last 15 seconds, and the share ends on its own at 2:00. The projector goes back to the screensaver.
7. The organizer can remove, skip or stop anyone, and refreshing any page loses nothing.

---

## Stack: follow the PRD, with a fallback for video

| Layer | Choice (from the PRD) | MVP notes |
|---|---|---|
| Front end | Astro + React + Tailwind | Three routes: `/`, `/admin`, `/host`. Plain Tailwind; no design work this week. |
| Server | Elysia on Bun | REST for actions, one WebSocket for pushing state. |
| DB | SQLite (`bun:sqlite`) + Drizzle | Sessions and queue entries only. |
| Video | VDO.Ninja embedded in iframes | The server only hands out private stream IDs and never touches video. |
| Auth | **Deferred.** Browser token for hackers, passcode for organizers | Squid is the first post-MVP story. |
| Hosting | One origin: Elysia also serves the Astro static build | Run it on a VM (Fly, Railway or similar) or on a laptop behind the Cloudflare tunnel. Vercel can't hold WebSockets or SQLite, so keep it for the real launch. |

**Video fallback:** if the day-1 VDO.Ninja spike fails (iframe screen capture is blocked, it can't connect on campus Wi-Fi, or start and stop can't be controlled), use direct WebRTC instead. The local prototype (`CheckPointPurdueHackers/public/core.js`) already does screen share to many viewers with STUN and a TURN fallback. Only its signalling needs to move from polling to the Elysia WebSocket. Decide by the end of day 1 and don't revisit the choice.

### Reuse from the local prototype

- The queue and turn flow (`callNext`, `endCurrent`, presenter start) maps directly onto the entry state machine below.
- Clock-skew handling for timers (`clockSkew = Date.now() - state.now`).
- Lessons learned:
  - Cloudflare tunnels buffer SSE, so use WebSockets or polling.
  - Background tabs throttle timers, so the server must own the 2:00 cutoff and the up-next alerts must not depend on page timers.
  - Mobile browsers can't screen share, so phones can join but must show "use a laptop to share".
- The mic test and recording code are post-MVP (P-3 and P-4), but they are ready to lift.

---

## Data model

```
sessions
  id            text pk
  code          text unique         -- 4–6 chars, no 0/O/1/I
  status        text                -- 'open' | 'closed'
  limit_sec     int  default 120
  created_at    int

queue_entries
  id            text pk
  session_id    text fk
  client_token  text                -- from localStorage; unique per (session, token)
  name          text
  project       text
  stream_id     text                -- private; only sent to admin and host
  status        text                -- 'waiting' | 'called' | 'live' | 'done' | 'left' | 'removed'
  share_state   text                -- 'not_shared' | 'sharing' | 'stopped'
  sort_key      real                -- ordering; skip and reorder just change this
  joined_at     int
  called_at     int null
  started_at    int null
  deadline      int null            -- started_at + limit_sec*1000; server enforces it
  last_seen_at  int                 -- drives the 'disconnected' badge
```

**Entry lifecycle:** `waiting → called → live → done`, and any state can move to `left` or `removed`. "Up next" isn't stored: it is the first `waiting` entry. At most one entry per session is `called` or `live`.

**State message** (server → client, sent in full after every change):

```ts
{
  serverNow, session: { code, status, limitSec },
  current: { entryId, name, project, status: 'called'|'live', startedAt, deadline, streamId? } | null,
  queue: [{ id, name, project, shareState, connected, joinedAt, streamId? }],
  me?: { entryId, status, position, streamId }   // only on the hacker's own socket
}
```

`streamId` goes out only on admin and host sockets, and to the hacker for their own entry.

**Actions** (REST, all return the new state):
- **Hacker:** `join`, `leave`, `share-state`, `ready`, `end`.
- **Admin (passcode token):** `session/start`, `session/end`, `call-next`, `skip`, `remove`, `stop`, `ready` (on behalf of a hacker), `limit`.

---

## Day-by-day

The plan assumes **2–4 people** in four tracks: **A** server, **B** hacker page, **C** admin and projector pages, **D** video. If you're working alone, follow the story order top to bottom and drop the stretch items.

### Day 1: Scaffold and the video spike
| Track | Work | Stories |
|---|---|---|
| A | Repo scaffold, Elysia and Drizzle schema, shared types, agreed state shape | US-0.1, US-0.2 |
| D | **Spike:** two laptops on campus Wi-Fi. One pushes a screen share through an embedded VDO.Ninja iframe; the other views it by stream ID in an iframe. Check that removing the iframe stops the share, that a preview shows on the push side, and that sound plays on the viewer after one click. | (US-3.1 risk) |
| B, C | Stub pages with routing, and a hard-coded fake state to build the UI against | |

**End of day:** commit to VDO.Ninja or the WebRTC fallback.

### Day 2: Walking skeleton (milestone M1)
| Track | Work | Stories |
|---|---|---|
| A | WebSocket broadcast, the join, leave and session endpoints, admin passcode | US-0.3, US-1.1, US-5.1 |
| B | Code page → name and project form → "You're #N" with Leave | US-2.1, US-2.2, US-2.3 |
| C | Admin start session and queue list; projector lobby with the code and queue | US-1.2, US-5.2 (no share status yet) |
| D | **Deploy the skeleton to HTTPS now.** Prove that WebSockets and VDO.Ninja work through it. | US-7.1 (first pass) |

**M1:** several browsers join with a code and every screen updates live. No video yet.

### Day 3: Sharing from your seat
| Track | Work | Stories |
|---|---|---|
| A | Stream ID per entry, share-state endpoint, token-based rejoin, `last_seen_at` and disconnect handling | US-2.4, US-3.3 (server) |
| B | Share step after joining, corner preview, "Change window", banner for a stopped share | US-3.1, US-3.2, US-3.3 |
| C | Share status and disconnected badges on admin rows | US-5.2 |
| D | Help B with the share integration, and handle phones and Safari ("use a laptop to share") | US-3.1 |

### Day 4: The handoff (milestone M2)
| Track | Work | Stories |
|---|---|---|
| A | `call-next`, `ready`, `skip`, `remove`, `stop`, and the waiting → called → live transitions | US-5.4 (server) |
| B | Dimmed Ready overlay on `called`; live view with an "End my checkpoint" button | US-4.2, US-4.5 |
| C | Admin preview panel (opens the next person's preview automatically) and the control buttons; projector switches to the live stream with a name bar | US-5.3, US-5.4, US-4.3, US-6.2 |

**M2:** one person goes from their seat to live on the projector without touching a cable.

### Day 5: Rules and alerts (milestone M3, feature-complete)
| Track | Work | Stories |
|---|---|---|
| A | Server-owned deadline timer (re-armed from the DB on restart) that auto-ends the slot; end-session endpoint | US-4.4, US-1.3 |
| B | Up-next sound, notification and highlight; last-15-second countdown; share stops at the end | US-4.1, US-4.4 |
| C | Projector screensaver and countdown; admin "End checkpoints" | US-6.1, US-1.3 |

**M3:** everything in "MVP done" works on localhost and on the deployed URL.

### Day 6: Dry run
- Run a full fake checkpoint with **at least 5 people on their own laptops**, on campus Wi-Fi, through the deployed URL, using the script below. Run it twice.
- Log every problem as a GitHub issue labeled `dry-run`, then fix the blockers the same day.

### Day 7: Harden, freeze and rehearse
- Fix the remaining `dry-run` issues. Stretch: reorder and time limit (US-5.5).
- Freeze the code by mid-day. Rehearse the showcase twice on the real projector, and keep a backup laptop with the admin panel open.

---

## Dry-run and showcase script

1. Open `/host` on the projector (fullscreen, sound enabled) and `/admin` on the organizer laptop. Start a session.
2. Three or more volunteers open the site, enter the code, their name and their project, and share a window. The admin sees all of them as "sharing".
3. **Edge cases to hit on purpose:**
   - one volunteer refreshes mid-queue and keeps their spot;
   - one stops their share and restarts it;
   - one joins from a phone and sees "use a laptop to share";
   - one enters a wrong code.
4. Call next. Check that the up-next alert reaches person #2 while person #1 is getting ready.
5. Person #1 presses Ready, goes live, and lets the timer run out: countdown at 0:15, auto-cut at 2:00, screensaver.
6. Person #2 presses "End my checkpoint" early. The organizer removes person #3 and skips person #4.
7. Restart the server mid-queue. The queue and the live presenter's deadline survive.
8. End the session. The code stops working.

---

## Risks and mitigations

| Risk | Mitigation |
|---|---|
| VDO.Ninja won't capture the screen inside an iframe, or can't be controlled | Day-1 spike with a firm go/no-go; use the prototype's WebRTC as the fallback. |
| Campus Wi-Fi blocks peer-to-peer video | Test on the real network on days 1 and 2. VDO.Ninja has its own TURN; the fallback already includes TURN. |
| Background tabs sleep, so alerts or the cutoff are missed | The server owns the deadline; up-next uses the Notification API, which works in background tabs. |
| Projector audio is blocked by autoplay rules | An "Enable sound" click on the host page at setup is part of the run checklist. |
| HTTPS issues show up late | Deploy the skeleton on day 2, not day 6. |
| Scope creep from the full PRD | Squid, recording, moderation and visual polish are explicitly post-MVP. |

## If you fall behind, cut in this order

1. US-5.5 reorder and time limit (already a stretch).
2. Skip, keeping Remove.
3. The disconnected grace logic in US-2.4. Keep a plain refresh restore.
4. The browser notification in US-4.1. Keep the sound and highlight.
5. The automatic preview of the next person in US-5.3. Keep the manual Preview button.

**Never cut** the server-owned 2:00 cutoff, the Ready gate, or sharing from your seat. They are the reason this project exists.
