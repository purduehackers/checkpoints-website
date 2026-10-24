import { useEffect, useState } from "react";
import {
  Badge,
  api,
  fmt,
  signInUrl,
  signOutUrl,
  useLive,
  useTick,
  useUser,
} from "../lib/live";
import { ViewFrame } from "../lib/vdo";
import {
  StatsButton,
  StatsOverlay,
  useRemoteStats,
  useStatsToggle,
} from "../lib/stats";
import { QUALITY, type Quality } from "../../shared/types";

const SHARE_LABEL = {
  sharing: "sharing",
  not_shared: "not sharing",
  stopped: "stopped",
};

export default function Admin() {
  const user = useUser();
  const [denied, setDenied] = useState(false);
  if (user === undefined) return <main className="p-6">Loading…</main>;
  if (!user?.organizer || denied) {
    return (
      <main className="mx-auto max-w-sm space-y-3 p-6">
        <h1 className="text-2xl font-semibold">Organizer</h1>
        {user && !denied ? (
          <>
            <p className="text-neutral-300">
              Signed in as <b>{user.name}</b>, which isn't an organizer account.
              Ask an ID admin for the organizer role, then sign in again.
            </p>
            <a
              href={signOutUrl()}
              className="block w-full rounded bg-neutral-700 p-3 text-center"
            >
              Sign out
            </a>
          </>
        ) : (
          <>
            {denied && (
              <p className="text-neutral-300">
                Your session ended. Sign in again.
              </p>
            )}
            <a
              href={signInUrl()}
              className="block w-full rounded bg-amber-500 p-3 text-center font-semibold text-black"
            >
              Sign in with Purdue Hackers
            </a>
          </>
        )}
      </main>
    );
  }
  return <Panel name={user.name} onDenied={() => setDenied(true)} />;
}

function Panel({ name, onDenied }: { name: string; onDenied: () => void }) {
  const { state, online, denied, apply, now } = useLive("admin");
  useEffect(() => {
    if (denied) onDenied();
  }, [denied]);
  const [error, setError] = useState("");
  const [preview, setPreview] = useState<string | null>(null);
  const [pinned, setPinned] = useState(false); // true once the organizer picks a preview by hand
  const [busy, setBusy] = useState(false); // disables every control while a request is in flight (no double-clicks)
  useTick(1000);

  const act = (path: string, body?: object) => {
    setBusy(true);
    return api("/admin" + path, body)
      .then((s) => {
        setError("");
        apply(s);
      })
      .catch((e) =>
        e.message === "Not authorized" ? onDenied() : setError(e.message),
      )
      .finally(() => setBusy(false));
  };

  // US-5.3: preview the next person automatically unless the organizer chose someone else.
  const first = state?.queue[0]?.streamId ?? null;
  useEffect(() => {
    if (!pinned) setPreview(first);
  }, [first, pinned]);
  const stats = useStatsToggle();
  const statsStream = preview ?? state?.current?.streamId ?? null; // nobody previewed: show the presenter
  const history = useRemoteStats(statsStream, stats.on);

  if (!state)
    return (
      <main className="p-6">
        <Badge online={online} />
        Loading…
      </main>
    );
  const open = state.session?.status === "open";
  const c = state.current;

  return (
    <main className="mx-auto grid max-w-5xl gap-6 p-6 md:grid-cols-[1fr_320px]">
      <Badge online={online} />
      {stats.menu}
      {stats.on && (
        <StatsOverlay
          history={history}
          title={
            statsStream && statsStream === c?.streamId
              ? `On stage: ${c.name}`
              : "Previewed stream"
          }
          onClose={stats.toggle}
        />
      )}
      <fieldset disabled={busy} className="min-w-0 space-y-4">
        <p className="text-sm text-neutral-400">
          Hello, <b className="text-neutral-100">{name}</b> ·{" "}
          <a href={signOutUrl()} className="underline">
            Sign out
          </a>
        </p>
        <div className="flex flex-wrap items-center gap-2">
          {open ? (
            <button
              className="rounded bg-red-700 px-3 py-2"
              onClick={() => confirm("End checkpoints?") && act("/session/end")}
            >
              End checkpoints
            </button>
          ) : (
            <button
              className="rounded bg-green-600 px-3 py-2"
              onClick={() => act("/session/start")}
            >
              Start checkpoint
            </button>
          )}
          {open && (
            <label className="ml-auto text-sm">
              Limit (s){" "}
              <input
                type="number"
                key={state.session!.limitSec}
                defaultValue={state.session!.limitSec}
                min={10}
                className="w-20 rounded bg-neutral-800 p-1"
                onBlur={(e) =>
                  Number(e.target.value) !== state.session!.limitSec &&
                  act("/limit", { seconds: Number(e.target.value) })
                }
              />
            </label>
          )}
          {open && (
            <label className="text-sm">
              Quality{" "}
              <select
                value={state.session!.quality}
                onChange={(e) =>
                  act("/quality", { quality: e.target.value as Quality })
                }
                className="rounded bg-neutral-800 p-1"
              >
                {Object.keys(QUALITY).map((q) => (
                  <option key={q} value={q}>
                    {q === "source" ? "Source" : q}
                  </option>
                ))}
              </select>
            </label>
          )}
          {open && (
            <button
              className={`rounded px-3 py-1 text-sm ${state.session!.audio ? "bg-neutral-700" : "bg-red-800"}`}
              onClick={() => act("/audio", { on: !state.session!.audio })}
            >
              Projector sound: {state.session!.audio ? "On" : "Off"}
            </button>
          )}
        </div>
        {!state.session && <p className="text-neutral-400">No session yet.</p>}
        {state.session && !open && (
          <p className="text-neutral-400">Session ended.</p>
        )}
        {error && <p className="text-red-400">{error}</p>}

        {c && (
          <div className="rounded border border-amber-500 p-3">
            <div className="flex items-center gap-3">
              <div className="grow">
                <b>{c.name}</b> · {c.project}
                <div className="text-sm text-neutral-400">
                  {c.status === "live" ? "live" : "getting ready"} ·{" "}
                  {SHARE_LABEL[c.shareState]}
                </div>
              </div>
              {c.deadline && (
                <span className="text-2xl tabular-nums">
                  {fmt(c.deadline - now())}
                </span>
              )}
              {c.status === "called" && (
                <button
                  className="rounded bg-green-600 px-3 py-1"
                  onClick={() => act("/ready", { id: c.entryId })}
                >
                  Ready
                </button>
              )}
              {c.status === "called" && (
                <button
                  className="rounded bg-neutral-700 px-3 py-1"
                  onClick={() => act("/skip", { id: c.entryId })}
                >
                  Skip
                </button>
              )}
              <button
                className="rounded bg-red-700 px-3 py-1"
                onClick={() => act("/stop")}
              >
                Stop
              </button>
              {c.streamId && (
                <button
                  className="text-sm underline"
                  onClick={() => {
                    setPinned(true);
                    setPreview(c.streamId!);
                  }}
                >
                  Preview
                </button>
              )}
            </div>
          </div>
        )}

        <ol className="space-y-2">
          {state.queue.map((e, i) => (
            <li
              key={e.id}
              className="flex items-center gap-3 rounded bg-neutral-900 p-3"
            >
              <span className="w-6 text-neutral-500">{i + 1}</span>
              <div className="grow">
                <b>{e.name}</b> · {e.project}
                <div className="text-sm text-neutral-400">
                  {e.connected ? SHARE_LABEL[e.shareState] : "disconnected"} ·
                  waiting {fmt(now() - e.joinedAt)}
                </div>
              </div>
              <button
                className="text-sm underline"
                onClick={() => {
                  setPinned(true);
                  setPreview(e.streamId!);
                }}
              >
                Preview
              </button>
              <button
                className="text-sm disabled:opacity-30"
                disabled={i === 0}
                aria-label="Move up"
                onClick={() => act("/move", { id: e.id, dir: -1 })}
              >
                ▲
              </button>
              <button
                className="text-sm disabled:opacity-30"
                disabled={i === state.queue.length - 1}
                aria-label="Move down"
                onClick={() => act("/move", { id: e.id, dir: 1 })}
              >
                ▼
              </button>
              <button
                className="text-sm underline"
                onClick={() => act("/skip", { id: e.id })}
              >
                Skip
              </button>
              <button
                className="text-sm text-red-400 underline"
                onClick={() =>
                  confirm(`Remove ${e.name}?`) && act("/remove", { id: e.id })
                }
              >
                Remove
              </button>
            </li>
          ))}
          {!state.queue.length && (
            <li className="text-neutral-500">Queue is empty.</li>
          )}
        </ol>
      </fieldset>
      <aside>
        <h2 className="mb-2 text-sm text-neutral-400">
          Preview
          {pinned && (
            <button className="ml-2 underline" onClick={() => setPinned(false)}>
              follow next
            </button>
          )}
        </h2>
        <StatsButton onClick={stats.toggle} className="mb-2" />
        {preview ? (
          <ViewFrame
            streamId={preview}
            className="aspect-video w-full rounded bg-black"
          />
        ) : (
          <div className="aspect-video rounded bg-neutral-900" />
        )}
      </aside>
    </main>
  );
}
