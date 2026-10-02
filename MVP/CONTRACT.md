# Design contract

A design is four HTML files in `public/designs/<name>/`: `join.html`, `view.html`, `admin.html`,
`recordings.html`. They are served at `/d/<name>/join|view|admin|recordings`.

Every page must:

- load `<link rel="stylesheet" href="/contract.css">` (functional rules only), then its own CSS;
- set `<body data-page="join|view|admin|recordings">`;
- end with `<script src="/core.js" type="module"></script>`.

`core.js` does all the logic. It only needs these ids and classes to exist. Style them any way you like,
and put them anywhere in your layout. Everything else on the page is yours.

## Shared by join, view and admin

| id | What core.js puts there |
|---|---|
| `#nowName` | presenter's name, or "Nobody on stage" |
| `#nowNote` | their one-line project note |
| `#nowStatus` | `idle` / `getting ready` / `live` |
| `#stopwatch` | `mm:ss` since they started sharing. Sets `data-state` to idle, waiting, ok, warn or over, so colour it per state |
| `#count` | queue length |
| `#upNext` (join, view) | an `<ol>`/`<ul>`; core.js fills `<li><span class="pos">1</span><span class="who"><b>Name</b><small>note</small></span></li>` (or `<li class="empty">`) |

## join.html (Present)

core.js sets `body[data-stage]` to `form`, `queued`, `turn` or `sharing`. Only the matching panel shows:

- `.st.st-form`: must be `<form id="joinForm">` with `<input name="name" required>`, `<input name="note">` and a submit button.
- `.st.st-queued`: `#position` (e.g. "#3"), `#ahead` ("2 people ahead of you"), `#leaveBtn`.
- `.st.st-turn`: `#shareBtn` (starts the screen share).
- `.st.st-sharing`: `<video id="selfPreview" autoplay muted playsinline>`, `#stopwatch`, `#stopShareBtn`.
- anywhere: `#shareError` (status text).
- mic test: `<select id="micSelect">`, `#testBtn`, a track element containing `<div id="meterFill">` (give `#meterFill` a height and a background), and `#meterLabel`.

Note: join has TWO elements that could be `#stopwatch`. Only put `#stopwatch` inside `.st-sharing` on this page.

## view.html (Watch, the projector) and admin.html (Host)

- `.stage` holds `<video id="stageVideo" autoplay playsinline muted>` and an idle background element with class `idle-only`, shown when nobody is sharing. Make the idle background beautiful: this is what the room sees most of the night. Anything with class `live-only` shows only while someone is live.
- `#soundBtn`: toggles the presenter's audio.
- view: `#upNext`.
- admin: `#nextBtn` (move to next person), `#stopBtn` (stop sharing), `<input id="limitInput" type="number">` (minute limit), and `<ol id="queueList">`. core.js fills each queue item with `<span class="ctl">` holding up/remove buttons.

## recordings.html

- `#recList`. core.js fills it with `<article class="rec"><video controls></video><div><h3>name</h3><p>note</p><small>date · duration</small></div></article>`, or `<p class="empty">`.

## Navigation

Each page links to the other three with the same design name (`/d/<name>/join` and so on), plus `/` (all designs).
