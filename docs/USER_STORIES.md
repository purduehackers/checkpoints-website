# Checkpoints: User Stories

These stories turn the PRD into tasks a person can pick up and finish in one sitting. They are grouped by epic and listed **in build order**: each story assumes the ones above it are done.

- **Size:** S = a few hours, M = about half a day, L = a full day or more.
- **MVP** = needed for the one-week showcase. **Post** = after the MVP (PRD "Finished Product Goals").
- **Personas:** *Hacker* (presents a checkpoint), *Organizer* (runs the queue from the admin panel), *Projector* (the host screen the room watches).

**Status:** ✅ done, ❌ dropped, no mark = open.

Identity for the MVP: a hacker is a random token stored in their browser (one queue spot per browser). The organizer panel is behind a shared passcode. Squid login replaces both after the MVP.

---

## Epic 0: Foundation

### ✅ US-0.1 Project scaffold (MVP, M)
*As a developer, I can run the whole app with one command, so the team can work in parallel from day one.*
- Astro + React + Tailwind front end with three routes: `/` (hacker), `/admin`, `/host`.
- Elysia (Bun) server with a health check route.
- One `bun dev` (or two documented commands) starts both. README explains setup.
- Shared TypeScript types for session, queue entry and the state message.

### ✅ US-0.2 Database schema (MVP, S)
*As a developer, I can store sessions and queue entries in SQLite, so a server restart or a page refresh does not lose the queue.*
- Turso. Tables: `sessions` and `queue_entries` (see the data model in `MVP_PLAN.md`).
- A migration or push script creates the tables.

### ✅ US-0.3 Live state channel (MVP, M)
*As any client, I get the current session state pushed to me whenever it changes, so every screen stays in sync without refreshing.*
- WebSocket endpoint. On connect, the client says which session and role it is, and the server sends the full state right away.
- The server broadcasts the full state after every change. No diffing for the MVP.
- The client reconnects on its own and shows a small "reconnecting…" badge while offline.

---

## Epic 1: Sessions and join codes

### ✅ US-1.1 Start a session (MVP, S)
*As an organizer, I can start a checkpoint session so hackers can find the right queue.*
- "Start checkpoint" button on `/admin` creates a session.
- Only one session is open at a time for the MVP.
- Default time limit is 2:00.

### ✅ US-1.2 Lobby on the projector (MVP, S)
*As the projector, I show the join URL and the live queue, so the room knows how to join.*
- `/host` shows the site URL in large type, and the queue list (name and project).
- The list updates live as people join or leave.

### ✅ US-1.3 End a session (MVP, S)
*As an organizer, I can end the session, so nobody can join after checkpoints are over.*
- "End checkpoints" closes the session. The code then returns "This checkpoint has ended."
- Anyone still waiting sees an ended message.

---

## Epic 2: Joining the queue

### ❌ US-2.1 Enter a join code (MVP, S)
*Dropped: there are no join codes. Only one session is open at a time, so `/` goes straight to the name and project form.*

### ✅ US-2.2 Join with name and project (MVP, S)
*As a hacker, I enter my name and project name and get a spot in line.*
- Both fields are required and length-limited.
- One spot per browser token. Joining again returns the same spot instead of making a second one.

### ✅ US-2.3 See my place in line (MVP, S)
*As a hacker, I see my live queue position, so I know when to get ready.*
- Shows "You're 3rd in line" and the number of people ahead of me. It updates live.
- A "Leave queue" button removes me, after a confirm.

### ✅ US-2.4 Keep my spot after a refresh (MVP, M)
*As a hacker, I keep my spot if I refresh or my Wi-Fi drops, so a hiccup doesn't send me to the back.*
- The token in `localStorage` maps back to my entry. Reloading puts me back on the right screen.
- If I am gone for more than a grace period (about 3 minutes), my entry is marked disconnected. The organizer decides whether to remove me.

---

## Epic 3: Sharing my screen from my seat

### ✅ US-3.1 Share and preview (MVP, L) *(the riskiest story: spike it on day 1)*
*As a hacker, right after joining I'm asked to share a screen, window or tab, and I see a small preview of it, so I'm set up before I walk up.*
- After joining, a "Share your screen" step starts the share (done with the VDO.Ninja SDK; the hacker's page captures the screen and publishes it, viewers use iframes).
- My page shows a small preview in the corner while I wait.
- The server records my entry's private stream ID. Only the organizer and the projector get stream IDs.
- Joining and waiting still work without sharing (for example on a phone). The organizer sees "not sharing".

### ✅ US-3.2 Change what I'm sharing (MVP, S)
*As a hacker, I can switch to a different window, so I can fix a wrong pick without leaving the queue.*
- A "Change window" button restarts the share. I keep my queue spot.

### ✅ US-3.3 Share status and recovery (MVP, M)
*As a hacker, I see clearly when my share has stopped and can restart it. As an organizer, I can see who is not ready.*
- The client reports its share state to the server: `not_shared`, `sharing` or `stopped`.
- If the share ends (I closed it, or the browser killed it), I see a banner with a "Share again" button.

---

## Epic 4: My turn

### ✅ US-4.1 Up-next alert (MVP, M)
*As a hacker, I'm alerted when I'm next, so I don't miss my turn while I'm heads-down.*
- When I become #1 in line, my page plays a sound, shows a browser notification, and highlights itself (a full-page color pulse).
- Notification permission is requested at join time, after a click, so browsers allow it.
- The tab title changes, for example "You're up next! · Checkpoints".

### ✅ US-4.2 Ready screen (MVP, M)
*As a hacker, when the organizer calls me, my page dims and shows a big Ready button, so I can walk to the podium before my screen goes up.*
- On "called", the page shows a full-screen dimmed overlay with a large **Ready** button.
- The projector shows "Up now: <name> · <project>" with a "getting ready" state. My screen is not on the projector yet.
- The organizer can also press Ready for me (for example from the podium laptop).

### ✅ US-4.3 Go live (MVP, M)
*As the projector, I show the presenter's screen with their name and project above it once they press Ready.*
- Pressing Ready sets `started_at` on the server, and the projector switches to that hacker's stream.
- The name and project bar is visible the whole time.

### ✅ US-4.4 Two-minute limit (MVP, M)
*As an organizer, I never have to cut anyone off: a countdown shows for the last 15 seconds and the share ends on its own at 2:00.*
- The server owns the clock. It sets a deadline when the hacker goes live and ends the slot at the deadline, even if the hacker's tab is closed or asleep.
- The last 15 seconds show a countdown in the top left of the hacker's page and on the projector.
- At 0:00, the projector returns to the screensaver, the hacker's share stops, and their entry becomes `done`.

### ✅ US-4.5 End early (MVP, S)
*As a hacker, I can press "End my checkpoint" when I'm done talking.*
- It ends my slot right away and has the same effect as the timer running out.
- My page then shows "Thanks for presenting!"

---

## Epic 5: Organizer panel

### ✅ US-5.1 Admin passcode (MVP, S)
*As an organizer, only people with the passcode can control the queue.*
- `/admin` asks for a passcode, which the server checks against an environment variable. A successful check returns an admin token, and every admin action and admin socket requires it.

### ✅ US-5.2 Queue overview (MVP, S)
*As an organizer, I see everyone in line with their share status, so I know who is ready.*
- Each row shows the position, name, project, share status (sharing, not sharing, stopped, disconnected) and how long they have been waiting.
- The current presenter is pinned at the top with their timer.

### ✅ US-5.3 Preview a share (MVP, M)
*As an organizer, I can preview anyone's share before they go live, so nothing unexpected hits the projector.*
- A "Preview" button on each row opens that hacker's stream, muted, in a side panel.
- The next person's preview opens on its own (PRD: "default show screen in queue").

### ✅ US-5.4 Run the queue (MVP, M)
*As an organizer, I can call the next person, skip, remove, or stop the current presenter.*
- **Call next** ends the current slot (if any) and calls #1 (Ready screen, US-4.2).
- **Skip** moves a person behind the next one, for when they are not ready.
- **Remove** takes them out of the queue, after a confirm.
- **Stop** ends the current presenter now.

### ✅ US-5.5 Reorder and change the time limit (Stretch, S)
*As an organizer, I can use up and down buttons (not drag) to reorder the queue, and change the time limit for this session.*

---

## Epic 6: Projector

### ✅ US-6.1 Screensaver (MVP, M)
*As the projector, I show a branded screensaver between presenters, so the room never sees a blank or broken screen.*
- Purdue Hackers branding, the join code, and "Up next: <name>".
- It shows whenever nobody is live.

### ✅ US-6.2 Live view (MVP, S)
*As the projector, I show the live share full screen with the name bar and the final 15-second countdown.*
- One click to "Enable sound" on load, so the browser allows the shared tab/system audio to play.
- Fullscreen button, with the cursor hidden after a few seconds.

---

## Epic 7: Ready to show

### US-7.1 HTTPS deployment (MVP, M)
*As a team, the app runs on a public HTTPS URL, so laptops on campus Wi-Fi can share screens and get notifications (both need HTTPS).*
- Front end and server are deployed, and WebSockets work through the host or proxy.
- If VDO.Ninja is used, it loads over HTTPS and is allowed in the iframe (`allow="display-capture; autoplay; microphone"`).

### US-7.2 Dry run (MVP, S)
*As a team, we run a full fake checkpoint with at least 5 people on different laptops and networks before the showcase.*
- We follow the test script in `MVP_PLAN.md` and turn every bug into an issue.

---

## After the MVP (from the PRD "Finished Product Goals")

Rough order, with the highest value first:

| # | Story | Notes |
|---|---|---|
| P-1 | Log in with Squid; remove the name box | Replaces browser tokens and the admin passcode. Organizer role comes from Squid. |
| P-2 | One spot per Squid account; no re-joining after presenting | Organizer can allow a re-present. |
| P-3 | Mic prompt, mic picker, mic test | The local prototype already has a working mic meter to reuse. |
| P-4 | Recording opt-in checkbox and recording pipeline | OBS + recorder script → Cloudflare R2. |
| P-5 | Past checkpoints on the home page | Scrollable list with a badge-style artifact. Clicking one opens a small video player. |
| P-6 | Moderation: warn with a message modal, ban, "punished" portal | Persistent flags on the player profile. |
| P-7 | Projector polish | Smooth transitions, checkpoint counter, "Shh, be quiet" screen with custom text, celebratory end screen with confetti and a presenter list. |
| P-8 | Podium camera picture-in-picture | Second video source in a corner of the share. |
| P-9 | Stream quality setting, change project name while queued | |
| P-10 | Location check | Geolocation or IP check to keep joins in the room. |
