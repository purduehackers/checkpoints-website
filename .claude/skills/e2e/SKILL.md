---
name: e2e
description: Run the Checkpoints end-to-end check. It drives a whole checkpoint night in a real browser (join, queue, called, live, handoff, add time, removed, ended across participant, admin, projector and timer pages) and writes e2e-report/index.html with pass/fail per step and a screenshot of every page. Use it to confirm the app works after a change, before merging or deploying, or when someone asks "is everything working?" or wants screenshots of every page.
---

# Checkpoints end-to-end check

## Run it
```
bun run e2e
```
- Takes about 2 minutes and keeps the CPU busy the whole time (about 10 headless Chrome pages). Run it once, not in a loop.
- Exit code: 0 means every step passed, 1 means a step failed, 2 means it couldn't start.
- One-time setup on a new machine: `bunx playwright install chromium`.

## What it needs
- **Port 3000 must be free.** It starts its own API there on a throwaway `e2e.db`; it never touches Turso, Redis or `local.db`. If `bun dev` is running, stop its API first, either by killing `bun api/server.ts` or by stopping `bun dev`.
- **Astro dev on :4321.** It reuses one that's already running. Otherwise it starts one, since Astro allows only one dev server per project.
- **The internet**, because shares stream through vdo.ninja. The screen picker is faked with a canvas stream.
- Password sign-in mode is forced (`ID_ISSUER` blank, admin password `123`).

## Read the result
- Terminal: one `PASS` or `FAIL` line per step, with the first line of the error for failures.
- Open `e2e-report/index.html`: the headline count, then each step with its screenshots. Failed steps add a `FAILED-<n>.png` of the page at the moment it failed.
- When you report back, give the pass/fail count, name the failed steps with their errors, and point to the report. Look at the relevant screenshots before you claim something works or is broken.

## When a step fails
- **Check whether the app changed on purpose** (new wording, a renamed button) or actually broke. The script matches on visible text, such as "You’re next in line!", "Pick a screen to share" and "I’m done", so a copy change fails it even though nothing is broken.
- **App changed on purpose:** update the text in `scripts/e2e.ts`.
- **App actually broke:** fix the app, not the test.
- **Steps build on each other,** so one early failure can make later steps fail too. Fix the first failure, then rerun.

## Add a step
In `scripts/e2e.ts`, add `await step('What should happen', async () => { ...; await shot(page, 'name') }, pageToCaptureOnFailure)` where it belongs in the night's order.
- Use `see(page, text)` to wait for visible text.
- Use `button(page, label)` to click.
- Use `adminApi(path, body)` for organizer actions.
- Use `participant()` (pass `phone` for phone size) to make a new participant page.
