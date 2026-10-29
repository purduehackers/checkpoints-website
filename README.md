# Checkpoints

Run Hack Night checkpoints from the browser. Hackers join a queue from their seats. When it's their turn they walk up and press **Start presenting**, and their screen goes on the projector. It turns off on its own after two minutes. Nobody plugs in a cable.

This guide is for the organizer running a checkpoint night. Developers: see [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md).

## What you need

- The site URL and a **Purdue Hackers ID with the organizer role**. Ask an ID admin to give you the role at [id.purduehackers.com](https://id.purduehackers.com).
- A **projector laptop** running Chrome or Edge, plugged into the projector and speakers.
- Optionally, a second laptop for yourself to run the queue. You can also run everything from the projector laptop.

There are three pages:

| Page | Who uses it |
|---|---|
| `/` | Hackers: join the line and share a screen |
| `/admin` | You: run the queue |
| `/host` | The projector |
| `/timer` | A big countdown for the speaker (optional second screen) |

## Before the night (5 minutes)

1. **On the projector laptop, open `/host`.** Click **Fullscreen**. The click also lets the page play sound.
2. **Open `/admin` and sign in with Purdue Hackers,** on your own laptop.
3. **Click Start checkpoint.** The projector now shows the join address and the line. The first person to join is up automatically.

## Running the queue

Hackers open the site, enter their name and project, and click **Join queue**. They can share their screen while they wait, but they don't have to. You see everyone in the list on `/admin`.

For each presenter:

1. **Check the Preview panel.** It automatically shows whoever is next, so you can catch the wrong window before the room sees it. Click **Preview** on any row to look at someone else. Click **follow next** to go back to following the line.
2. **The first person in line is up automatically.** Their page turns green and the projector tells them to walk up. The person after them sees their page flash yellow.
3. **They press Start presenting at the podium.** If they aren't sharing yet, that one button opens the share picker and starts as soon as they pick a screen. The clock only starts then, never while they're walking up.
4. **A small timer stays on screen** and turns red for the last 30 seconds. The slot ends by itself at the time limit. They can also click **End my checkpoint** when they finish early.
5. **The next person is up automatically** as soon as a slot ends. If the person who is up isn't ready, click **Skip** on the current card: they go back one place and the next person is up.

### Controls

| Control | What it does |
|---|---|
| **Start timer** | Starts the called person's time for them. Only use it if they can't press Start presenting themselves |
| **Stop** | Ends the current presenter now and the next person is up. Clicking it twice never ends the next person too |
| **Pause / Resume** | Freezes the presenter's timer. The projector shows a grey ⏸ timer |
| **−30s / +30s** | Takes away or adds 30 seconds for the current presenter |
| **Skip** | In the line: moves someone behind the next person. On the current card (before they start): sends a not-ready person back one place and the next person is up |
| **▲ / ▼** | Moves someone up or down the line |
| **Remove** | Takes someone out of the line (if they are on stage, the next person is called) |
| **Limit (s)** | Time per presenter in seconds (default 120). Applies to the next presenter |
| **Quality** | Stream bitrate: 720p, 1080p (default), 1440p or Source. Lower it if the stream is choppy. Changes the live stream without restarting it |
| **Projector sound** | Turns the presenter's sound on the projector on or off |
| **End checkpoints** | Closes the line for the night |

The row under each name shows whether that person is **sharing**, **not sharing**, **stopped** or **disconnected…**.

**The checkpoint ends by itself** (just like End checkpoints) if nobody has `/admin` open for 5 minutes, or if nothing happens for 10 minutes while nobody is presenting.

## What to tell hackers

- **Use Chrome or Edge on a laptop.** Phones and iPads can join the line too, but they share their **camera** instead of a screen (handy for showing off hardware). **Start presenting** opens the back camera, **Flip camera** switches to the front one, and no microphone sound is sent, so a phone near the speakers can't cause feedback. Firefox and Safari can share a screen but not sound. Brave, Opera and Arc work like Chrome. The page needs a recent browser (Chrome/Edge 111+, Firefox 128+, Safari 16.4+).
- **The share picker starts on Entire screen.** For sound, share a Chrome tab instead and tick "Share audio" (on a Mac, an entire screen can't share sound). Sound only plays on the projector while they're live.
- **On Linux, if sharing a screen or window fails or goes black, share a browser tab instead.**
- **Don't open the projector page on your own laptop.**
- **Keep the page open.** Refreshing is fine. Closing the tab takes you out of the line after 5 seconds (the browser asks first). While those 5 seconds run, the projector shows "disconnected…".

## When something goes wrong

| Problem | Fix |
|---|---|
| No sound on the projector | Check that **Projector sound** is On. Click **Fullscreen** on the projector once. Then check that the presenter ticked "Share audio" |
| Someone shared the wrong window | They click **Change window** on their page. They keep their spot |
| A presenter isn't ready | Click **Skip** on the current card. They keep a place just behind the next person |
| The stream is choppy | Click **Stats for nerds**, or right-click anywhere on the page. If **limited by** says `bandwidth`, lower **Quality**. If it says `cpu`, have the presenter close other apps or lower **Quality** |
| A "reconnecting…" badge stays on | Check the network connection. The page reconnects by itself |
| The line is full of fake names | Click **End checkpoints**, then **Start checkpoint**. This starts a fresh, empty line |
| A hacker's share fails with an error name in brackets, like `(NotReadableError)` | Have them click **Try basic share**. If that fails too, share a browser tab. Screenshot the error and send it to the devs |
| A share still won't work | Have them press **Present without sharing** to talk without a share, or you press **Start timer** for them. Last resort: plug their laptop into the projector over HDMI |
| `/admin` says your account isn't an organizer | Ask an ID admin for the organizer role, then click **Sign out** and sign in again. Role changes apply at the next sign-in |

## Keeping it safe

- **Only organizers in Purdue Hackers ID can run the queue.** Taking the role away in ID applies at that person's next sign-in. Sessions last 12 hours.
- **Anyone can join the line from a new browser.** Hackers don't sign in. Use **Remove** for anyone who shouldn't be there.
