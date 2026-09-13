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

import { useMemo, useCallback, useRef, useState } from 'react';
import { balanceRoutes, routeMeters } from '@ww/hunt-engine';
import { isUnsuitable } from '@ww/shared';
import { CREATOR_PREVIEW_KEY } from '@/lib/huntData';
import type { Checkpoint, Hunt, HuntDuration, Route } from '@ww/shared';
import BackButton from '@/components/BackButton';

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:2567';

/** Matches the generator's own warning threshold. Keep the two in step. */
const ROUTE_SPREAD_WARNING = 0.25;

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

  /**
   * Walk the generated hunt immediately, without publishing anywhere.
   *
   * Reuses the creator preview channel /play already honours, which is exactly
   * what this is: content you just authored, walked before anyone else sees
   * it. Writing it here means the hunt does not have to be published — or even
   * reachable by id — to be playable.
   */
  /**
   * Landmarks in THIS result that should not have been chosen.
   *
   * The generator filters these out — but only a server running that filter
   * does, and a hunt is rendered here by whatever server answered. A Savannah
   * hunt generated today finishes at a U.S. Customs and Border Protection
   * facility, which every route converges on. Checking what we were handed
   * costs nothing and fails safe.
   */
  const unsafeStops = useMemo(() => {
    if (!result) return [];
    const flagged = result.checkpoints.filter((c) => isUnsuitable(c.name));
    const finish = result.hunt.finalDestination;
    if (isUnsuitable(finish.name) && !flagged.some((c) => c.id === finish.id)) {
      flagged.unshift(finish);
    }
    return flagged;
  }, [result]);

  /**
   * How lopsided the routes are, as a fraction of the longest.
   *
   * The server already warns about this. Until now the warning named a
   * problem with no remedy — the author could read "routes differ by 41%"
   * and do nothing about it. The balancer is pure geometry, so it can run
   * right here on the result the server returned.
   */
  const spread = useMemo(() => {
    const lengths = result?.report.routeSummary.map((r) => r.meters) ?? [];
    if (lengths.length < 2) return 0;
    /**
     * The SERVER's metric, deliberately: worst deviation from the mean, not
     * (max - min) / max. Two different measures of the same thing let the
     * warning and the remedy disagree — the page could say "routes differ by
     * 41%" while offering no way to fix it, or offer a fix for routes it had
     * just called fine. Same number, same threshold, one story.
     */
    const mean = lengths.reduce((a, b) => a + b, 0) / lengths.length;
    if (mean === 0) return 0;
    return Math.max(...lengths.map((l) => Math.abs(l - mean) / mean));
  }, [result]);

  /**
   * Re-deal the stops between routes so everyone walks a similar distance.
   *
   * An explicit action, not a silent rewrite: this is an authoring tool and
   * the human is reviewing before publishing. It never changes WHICH stops
   * are in the hunt, only which route each belongs to, and the finish is
   * fixed for everyone by definition.
   */
  const rebalance = useCallback(() => {
    if (!result) return;
    const byId = new Map(result.checkpoints.map((c) => [c.id, c]));
    const finish = result.hunt.finalDestination;

    const dealt = result.routes.map((r) =>
      r.checkpointIds
        .filter((id) => id !== finish.id)
        .map((id) => byId.get(id))
        .filter((c): c is Checkpoint => Boolean(c)),
    );

    const balanced = balanceRoutes(dealt, finish);
    const routes = result.routes.map((r, i) => {
      const stops = balanced[i] ?? [];
      return {
        ...r,
        checkpointIds: [...stops.map((c) => c.id), finish.id],
        approxDistanceMeters: routeMeters([...stops, finish]),
      };
    });

    setResult({
      ...result,
      routes,
      report: {
        ...result.report,
        routeSummary: routes.map((r) => ({
          id: r.id,
          label: r.label,
          stops: r.checkpointIds.length,
          meters: r.approxDistanceMeters,
        })),
        warnings: result.report.warnings.filter((w) => !/differ by \d+%/i.test(w)),
      },
    });
  }, [result]);

  const playSolo = useCallback(() => {
    if (!result) return;
    try {
      window.localStorage.setItem(
        CREATOR_PREVIEW_KEY,
        JSON.stringify({
          hunt: result.hunt,
          routes: result.routes,
          checkpoints: result.checkpoints,
        }),
      );
    } catch {
      // Private window. Fall through — /play will load published content.
    }
    window.location.href = '/play';
  }, [result]);

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

          {spread > ROUTE_SPREAD_WARNING && (
            <div className="card" style={{ borderColor: 'var(--yellow)' }}>
              <p className="label" style={{ color: 'var(--yellow)', marginBottom: 8 }}>
                Routes are {Math.round(spread * 100)}% apart
              </p>
              <p style={{ margin: '0 0 12px', fontSize: 15 }}>
                The shortest route wins on time alone. Re-dealing the stops keeps the
                same checkpoints and the same finish — it only changes which route
                each one belongs to.
              </p>
              <button className="btn btn-yellow btn-block" onClick={rebalance}>
                Even out the routes
              </button>
            </div>
          )}

          {unsafeStops.length > 0 && (
            <div className="card" style={{ borderColor: 'var(--pink)', borderWidth: 3 }}>
              <p className="label" style={{ color: 'var(--pink)', marginBottom: 8 }}>
                ⚠ Do not send people here
              </p>
              <p style={{ margin: '0 0 10px', fontSize: 15 }}>
                {unsafeStops.length === 1 ? 'One stop is' : `${unsafeStops.length} stops are`} a
                place where standing outside taking photographs is likely to get someone stopped
                by security — police, customs, military, a hospital or a school. Remove{' '}
                {unsafeStops.length === 1 ? 'it' : 'them'} before you publish or play this hunt.
              </p>
              <p className="label" style={{ color: 'var(--pink)', margin: 0, opacity: 0.85 }}>
                {unsafeStops.map((c) => c.name).join(' · ')}
              </p>
            </div>
          )}

          {published ? (
            <div className="card" style={{ borderColor: 'var(--lime)' }}>
              <p className="label" style={{ color: 'var(--lime)', marginBottom: 8 }}>
                Published
              </p>
              <p style={{ marginBottom: 14 }}>
                It&apos;s live. Play it on your own, or gather people into a room.
              </p>
              {/* Both links carry THIS hunt. "Open the lobby" on its own was a
                  dead end: the lobby hosts a hard-coded Pittsburgh hunt, so
                  building a hunt for another city and publishing it ended with
                  no way to reach the thing you just made. */}
              <button className="btn btn-pink btn-block" onClick={playSolo}>
                Play it now, solo
              </button>
              <a
                className="btn btn-cyan btn-block"
                style={{ marginTop: 10 }}
                href={`/lobby?hunt=${encodeURIComponent(result.hunt.id)}`}
              >
                Host a room with this hunt
              </a>
            </div>
          ) : (
            <>
              {/* Walking it is how you review it, so this comes BEFORE publish.
                  Publishing is deliberately a human-review gate — requiring it
                  first meant publishing unreviewed content in order to review
                  it. This path writes to the preview channel and touches no
                  published content at all. */}
              <button className="btn btn-pink btn-block" onClick={playSolo}>
                Play it now, solo
              </button>
              <p className="dim" style={{ fontSize: 13, textAlign: 'center', margin: '8px 0 14px' }}>
                Walk it yourself before anyone else sees it. Nothing is published.
              </p>
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
