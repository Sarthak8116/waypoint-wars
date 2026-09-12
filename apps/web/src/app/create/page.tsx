'use client';

/**
 * Create a hunt anywhere.
 *
 * The product in one screen: type a place, get a playable hunt built from the
 * real landmarks around it.
 *
 * Two things this screen exists to do honestly:
 *
 *  1. GENERATION TAKES 15-40 SECONDS. That is a long time to look at a
 *     spinner, so the wait shows what is actually happening — geocoding, then
 *     finding landmarks, then writing each clue by name. A visible process
 *     reads as work; a spinner reads as broken.
 *
 *  2. THE MODEL IS NOT ALWAYS SURE. Drafts it flagged low-confidence are
 *     listed by name, and the hunt is NOT published until a human says so.
 *     Generated history is never told to a player as fact unseen.
 */

import { useCallback, useRef, useState } from 'react';
import type { Checkpoint, Hunt, HuntDuration, Route } from '@ww/shared';
import BackButton from '@/components/BackButton';

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:2567';

interface GenerateReport {
  resolvedPlace: string;
  landmarksFound: number;
  checkpointsDrafted: number;
  needsReview: string[];
  mocked: boolean;
  routeSummary: Array<{ id: string; label: string; stops: number; meters: number }>;
  warnings: string[];
}

interface GenerateResult {
  hunt: Hunt;
  routes: Route[];
  checkpoints: Checkpoint[];
  report: GenerateReport;
}

const DURATIONS: Array<{ value: HuntDuration; label: string; stops: number }> = [
  { value: 'quick-detour', label: '30 min', stops: 3 },
  { value: 'city-quest', label: '60 min', stops: 4 },
  { value: 'deep-dive', label: '2–3 hrs', stops: 6 },
];

const SUGGESTIONS = ['Miami', 'Austin, Texas', 'Edinburgh Old Town', 'Lisbon', 'Kyoto'];

/** Roughly how far through we are, for the progress bar. */
const STAGE_ORDER = ['geocoding', 'finding landmarks', 'writing clues', 'done'];

export default function CreatePage() {
  const [query, setQuery] = useState('');
  const [duration, setDuration] = useState<HuntDuration>('quick-detour');
  const [routeCount, setRouteCount] = useState(3);

  const [busy, setBusy] = useState(false);
  const [stage, setStage] = useState<string>('');
  const [detail, setDetail] = useState<string>('');
  const [result, setResult] = useState<GenerateResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [publishing, setPublishing] = useState(false);
  const [published, setPublished] = useState(false);

  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);

  const clearTimers = () => {
    timers.current.forEach(clearTimeout);
    timers.current = [];
  };

  const generate = useCallback(async () => {
    if (!query.trim()) return;
    setBusy(true);
    setError(null);
    setResult(null);
    setPublished(false);
    setStage('geocoding');
    setDetail(query.trim());

    /**
     * The server streams no progress, so the stages are advanced on a timer
     * calibrated to observed runs (geocode ~1s, landmarks ~3s, then one draft
     * per place). This is a HONEST approximation of a real sequence, not a
     * fake progress bar — if the request finishes early the stages stop, and
     * if it runs long the last stage simply stays put rather than lying that
     * it is nearly done.
     */
    timers.current.push(
      setTimeout(() => {
        setStage('finding landmarks');
        setDetail('');
      }, 1400),
      setTimeout(() => {
        setStage('writing clues');
        setDetail('one per landmark, this is the slow part');
      }, 4500),
    );

    const stops = DURATIONS.find((d) => d.value === duration)?.stops ?? 3;

    try {
      const res = await fetch(`${API_URL}/api/hunts/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: query.trim(), duration, routeCount, stopsPerRoute: stops }),
      });

      const data = (await res.json()) as GenerateResult & { error?: string };
      if (!res.ok) throw new Error(data.error ?? `Generation failed (${res.status})`);

      setResult(data);
      setStage('done');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Generation failed');
      setStage('');
    } finally {
      clearTimers();
      setBusy(false);
    }
  }, [query, duration, routeCount]);

  const publish = useCallback(async () => {
    if (!result) return;
    setPublishing(true);
    try {
      const res = await fetch(`${API_URL}/api/hunts`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          hunt: { ...result.hunt, published: true },
          routes: result.routes,
          checkpoints: result.checkpoints,
        }),
      });
      if (!res.ok) {
        const d = (await res.json()) as { error?: string; details?: string[] };
        throw new Error(d.details?.join(' · ') ?? d.error ?? 'Publish failed');
      }
      setPublished(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Publish failed');
    } finally {
      setPublishing(false);
    }
  }, [result]);

  const stageIndex = STAGE_ORDER.indexOf(stage);

  return (
    <main className="wrap stack">
      <div><BackButton label="Home" /></div>
      <div>
        <p className="label" style={{ color: 'var(--lime)', marginBottom: 10 }}>
          Anywhere on earth
        </p>
        <h1 className="display" style={{ fontSize: 46 }}>
          Create a hunt
        </h1>
        <p className="muted" style={{ fontSize: 18, marginTop: 12 }}>
          Name a city and we&apos;ll build a walking hunt from the landmarks that are
          actually there.
        </p>
      </div>

      {/* ---------------------------------------------------------- input */}
      {!result && (
        <>
          <div className="card stack" style={{ gap: 14 }}>
            <input
              className="field"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && !busy && void generate()}
              placeholder="Miami, Austin, Edinburgh Old Town…"
              disabled={busy}
            />

            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              {SUGGESTIONS.map((s) => (
                <button
                  key={s}
                  className="pill"
                  style={{ cursor: 'pointer' }}
                  onClick={() => setQuery(s)}
                  disabled={busy}
                >
                  {s}
                </button>
              ))}
            </div>

            <div>
              <p className="label dim" style={{ marginBottom: 8 }}>
                How long
              </p>
              <div style={{ display: 'flex', gap: 8 }}>
                {DURATIONS.map((d) => (
                  <button
                    key={d.value}
                    className={`btn ${duration === d.value ? 'btn-yellow' : 'btn-ghost'}`}
                    style={{ flex: 1, fontSize: 15, padding: '0 8px' }}
                    onClick={() => setDuration(d.value)}
                    disabled={busy}
                  >
                    {d.label}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <p className="label dim" style={{ marginBottom: 8 }}>
                How many teams or players
              </p>
              {/* One route per team is the whole mechanic — but "routes" is our
                  word, not the organiser's. They are thinking about people. */}
              <p className="dim" style={{ fontSize: 13, margin: '-4px 0 8px' }}>
                Each gets its own set of checkpoints.
              </p>
              <div style={{ display: 'flex', gap: 8 }}>
                {[2, 3, 4].map((n) => (
                  <button
                    key={n}
                    className={`btn ${routeCount === n ? 'btn-cyan' : 'btn-ghost'}`}
                    style={{ flex: 1 }}
                    onClick={() => setRouteCount(n)}
                    disabled={busy}
                  >
                    {n}
                  </button>
                ))}
              </div>
            </div>
          </div>

          <button
            className="btn btn-pink btn-block"
            onClick={() => void generate()}
            disabled={busy || query.trim().length < 2}
          >
            {busy ? 'Building your hunt…' : 'Build the hunt'}
          </button>
        </>
      )}

      {/* -------------------------------------------------------- progress */}
      {busy && (
        <div className="card">
          <div className="segs" style={{ marginBottom: 14 }}>
            {STAGE_ORDER.slice(0, 3).map((s, i) => (
              <span key={s} className={`seg ${i < stageIndex ? 'seg-done' : i === stageIndex ? 'seg-now' : ''}`} />
            ))}
          </div>
          <p className="caret" style={{ fontWeight: 800, margin: 0 }}>
            {stage}
          </p>
          {detail && (
            <p className="dim" style={{ fontSize: 14, margin: '6px 0 0' }}>
              {detail}
            </p>
          )}
          <p className="dim" style={{ fontSize: 13, margin: '12px 0 0' }}>
            This takes 15–40 seconds. We look up real landmarks first, then write a
            clue for each one.
          </p>
        </div>
      )}

      {error && (
        <div className="card" style={{ borderColor: 'var(--pink)' }}>
          <p className="label" style={{ color: 'var(--pink)', marginBottom: 8 }}>
            Didn&apos;t work
          </p>
          <p style={{ margin: 0 }}>{error}</p>
        </div>
      )}

      {/* ---------------------------------------------------------- review */}
      {result && (
        <>
          <div className="card" style={{ borderColor: 'var(--lime)' }}>
            <p className="label" style={{ color: 'var(--lime)', marginBottom: 8 }}>
              Built · review before publishing
            </p>
            <h2 style={{ marginBottom: 6 }}>{result.hunt.title}</h2>
            <p className="muted" style={{ fontSize: 15 }}>
              {result.report.resolvedPlace}
            </p>

            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 12 }}>
              <span className="pill">{result.report.landmarksFound} landmarks found</span>
              <span className="pill">{result.report.checkpointsDrafted} checkpoints</span>
              {result.report.mocked && <span className="pill pill-yellow">placeholder text</span>}
            </div>
          </div>

          <div className="card">
            <p className="label dim" style={{ marginBottom: 10 }}>
              Everyone starts · everyone finishes
            </p>
            <p style={{ margin: '0 0 6px' }}>
              <span className="pill pill-yellow">START</span>{' '}
              <strong>{result.hunt.startLocation?.name}</strong>
            </p>
            <p style={{ margin: 0 }}>
              <span className="pill pill-lime">FINISH</span>{' '}
              <strong>{result.hunt.finalDestination.name}</strong>
            </p>

            <div style={{ marginTop: 16 }}>
              {result.report.routeSummary.map((r) => (
                <div
                  key={r.id}
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    padding: '9px 0',
                    borderBottom: '2px solid var(--border)',
                  }}
                >
                  <strong>{r.label}</strong>
                  <span className="mono muted" style={{ fontSize: 15 }}>
                    {r.stops} stops · {r.meters}m
                  </span>
                </div>
              ))}
            </div>
          </div>

          {/* The honest bit. Never hidden behind a disclosure. */}
          {(result.report.needsReview.length > 0 || result.report.warnings.length > 0) && (
            <div className="card" style={{ borderColor: 'var(--yellow)' }}>
              <p className="label" style={{ color: 'var(--yellow)', marginBottom: 10 }}>
                ⚠ Check these before you publish
              </p>

              {result.report.warnings.map((w) => (
                <p key={w} style={{ fontSize: 15, marginBottom: 8 }}>
                  {w}
                </p>
              ))}

              {result.report.needsReview.length > 0 && (
                <>
                  <p style={{ fontSize: 15, marginBottom: 6 }}>
                    The model wasn&apos;t confident about{' '}
                    <strong>
                      {result.report.needsReview.length} of {result.report.checkpointsDrafted}
                    </strong>{' '}
                    checkpoints. Walk past them, or read the clue and ask whether the
                    thing it describes is really there:
                  </p>
                  <p className="muted" style={{ fontSize: 14, margin: 0 }}>
                    {result.report.needsReview.join(' · ')}
                  </p>
                </>
              )}
            </div>
          )}

          <details className="card">
            <summary style={{ cursor: 'pointer', fontWeight: 800 }}>
              Read every clue ({result.checkpoints.length})
            </summary>
            <div style={{ marginTop: 14 }}>
              {result.checkpoints.map((c) => (
                <div key={c.id} style={{ paddingBottom: 14, marginBottom: 14, borderBottom: '2px solid var(--border)' }}>
                  <p className="label" style={{ color: 'var(--cyan)', marginBottom: 6 }}>
                    {c.name}
                  </p>
                  <p style={{ fontSize: 16, marginBottom: 6 }}>{c.clue}</p>
                  <p className="muted" style={{ fontSize: 14, marginBottom: 4 }}>
                    Q: {c.observationQuestion}
                  </p>
                  <p className="dim mono" style={{ fontSize: 13, margin: 0 }}>
                    {c.acceptedAnswers.join(' / ')}
                  </p>
                </div>
              ))}
            </div>
          </details>

          {published ? (
            <div className="card" style={{ borderColor: 'var(--lime)' }}>
              <p className="label" style={{ color: 'var(--lime)', marginBottom: 8 }}>
                Published
              </p>
              <p style={{ marginBottom: 14 }}>It&apos;s live. Start a room and play it.</p>
              <a className="btn btn-cyan btn-block" href="/lobby">
                Open the lobby
              </a>
            </div>
          ) : (
            <>
              <button
                className="btn btn-lime btn-block"
                onClick={() => void publish()}
                disabled={publishing}
              >
                {publishing ? 'Publishing…' : 'Publish this hunt'}
              </button>
              <button
                className="btn btn-ghost btn-block"
                onClick={() => {
                  setResult(null);
                  setError(null);
                }}
              >
                Start over
              </button>
            </>
          )}
        </>
      )}
    </main>
  );
}
