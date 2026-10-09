# Checkpoints

Run Hack Night checkpoints from the browser. Hackers join a queue and share their screen from their seats. When it's their turn they walk up, press **Ready**, and their screen goes on the projector. It turns off on its own after two minutes. Nobody plugs in a cable.

This guide is for the organizer running a checkpoint night. Developers: see [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md).

## What you need

- The site URL and the **organizer passcode**. Ask whoever deployed it.
- A **projector laptop** running Chrome or Edge, plugged into the projector and speakers.
- Optionally, a second laptop for yourself to run the queue. You can also run everything from the projector laptop.

There are three pages:

| Page | Who uses it |
|---|---|
| `/` | Hackers: join the line and share a screen |
| `/admin` | You: run the queue |
| `/host` | The projector |

## Before the night (5 minutes)

1. **On the projector laptop, open `/admin` and enter the passcode.** This step is required. Only a browser that's logged in as an organizer shows people's screens on `/host`. Anyone else who opens `/host` sees names only.
2. **In a second tab on the same laptop, open `/host`.** Click **Fullscreen**. The click also lets the page play sound.
3. **On your own laptop, open `/admin`** and log in, if you're running the queue from there.
4. **Click Start checkpoint.** The projector now shows the join address and the line.

## Running the queue

Hackers open the site, enter their name and project, and click **Join queue**. They can share their screen while they wait. You see everyone in the list on `/admin`.

For each presenter:

1. **Check the Preview panel.** It automatically shows whoever is next, so you can catch the wrong window before the room sees it. Click **Preview** on any row to look at someone else. Click **follow next** to go back to following the line.
2. **Click Call next.** The presenter's page tells them to walk up and shows a big **Ready** button.
3. **They press Ready at the podium,** or you press **Ready** for them. Their screen goes on the projector with their name and project.
4. **The last 15 seconds show a countdown,** and the slot ends by itself at the time limit. They can also click **End my checkpoint** when they finish early.
5. **Click Call next** for the next person.

### Your controls

| Control | What it does |
|---|---|
| **Call next** | Ends the current slot, if any, and calls the next person |
| **Ready** | Puts the called person on screen, if they can't press it themselves |
| **Stop** | Ends the current presenter now |
| **Skip** | Moves someone behind the next person, for when they aren't ready yet |
| **▲ / ▼** | Moves someone up or down the line |
| **Remove** | Takes someone out of the line |
| **Limit (s)** | Time per presenter in seconds (default 120). Applies to the next presenter |
| **Quality** | Stream resolution: 720p, 1080p (default), 1440p or Source. Changes the live stream without restarting it |
| **Projector sound** | Turns the presenter's sound on the projector on or off |
| **End checkpoints** | Closes the line for the night |

The row under each name shows whether that person is **sharing**, **not sharing**, **stopped** or **disconnected**.

## What to tell hackers

- **Use Chrome or Edge on a laptop.** Phones can join the line but can't share a screen. Firefox and Safari can share a screen but not sound.
- **For sound, share a Chrome tab and tick "Share audio".** Sound only plays on the projector while they're live.
- **Don't open the projector page on your own laptop.**
- **Keep the page open.** Refreshing is fine, and they keep their spot.

## When something goes wrong

| Problem | Fix |
|---|---|
| The projector shows a name but no screen | The projector browser isn't logged in. Open `/admin` on it, log in, then reload `/host` |
| No sound on the projector | Check that **Projector sound** is On. Click **Fullscreen** on the projector once. Then check that the presenter ticked "Share audio" |
| Someone shared the wrong window | They click **Change window** on their page. They keep their spot |
| A presenter isn't ready | Click **Skip** |
| The stream is choppy | Click **Stats for nerds**, or right-click anywhere on the page. If **limited by** says `bandwidth`, lower **Quality**. If it says `cpu`, have the presenter close other apps or lower **Quality** |
| A "reconnecting…" badge stays on | Check the network connection. The page reconnects by itself |
| The line is full of fake names | Click **End checkpoints**, then **Start checkpoint**. This starts a fresh, empty line |
| "Too many attempts" when logging in | Wait 15 minutes. Check the passcode with whoever deployed the site |

## Keeping it safe

- **Use a long random passcode,** 20+ characters. Changing it logs out every organizer and the projector.
- **The projector laptop is logged in as an organizer.** Don't leave it unlocked and unattended.
- **Anyone can join the line from a new browser.** There are no accounts yet. Use **Remove** for anyone who shouldn't be there.
