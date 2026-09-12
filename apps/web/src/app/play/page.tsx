'use client';

/**
 * Solo hunt — the vertical slice.
 *
 * Layer ownership, per ARCHITECTURE.md:
 *   MapLibre  — geography (player, radii, trail)
 *   Phaser    — presentation (XP tween, timer, toasts)
 *   React     — navigation, camera, forms, and the authoritative solo state
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import dynamic from 'next/dynamic';
import { haversineMeters, type Checkpoint, type LatLng, type LocationSample } from '@ww/shared';
import { GameBridge, type GameHandle } from '@ww/game';
import { loadHuntBundle, routeCheckpoints, type HuntBundle } from '@/lib/huntData';
import { useLocation } from '@/lib/useLocation';
import { useSoloHunt } from '@/lib/useSoloHunt';
import { isDemoMode } from '@/lib/demoMode';
import PhotoCapture from '@/components/PhotoCapture';
import BackButton from '@/components/BackButton';
import LocationGate from '@/components/LocationGate';
import LoadingPanel from '@/components/LoadingPanel';
import ProgressBar from '@/components/ProgressBar';

// MapLibre touches `window` at module scope.
const HuntMap = dynamic(() => import('@/components/HuntMap'), { ssr: false });

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:2567';

/** Breadcrumb cadence. PLAN.md P9 calls for a sample every 10-15s. */
const TRAIL_SAMPLE_MS = 12_000;

export default function PlayPage() {
  const [bundle, setBundle] = useState<HuntBundle | null>(null);
  const [routeId, setRouteId] = useState<string | null>(null);
  const [demo, setDemo] = useState(false);
  /** True until we know whether this is the demo path or the GPS path. */
  const [booting, setBooting] = useState(true);

  const begin = useCallback((b: HuntBundle) => {
    setBundle(b);
    // Solo players draw a route at random, same as multiplayer assignment.
    const pick = b.routes[Math.floor(Math.random() * b.routes.length)];
    setRouteId(pick?.id ?? null);
  }, []);

  /**
   * The judge path. `?demo=1` skips the location gate entirely: seeded hunt,
   * simulated walking, no permission prompt and no dependency on the room
   * server. Nobody should have to grant GPS to see the product work.
   *
   * Read in an effect rather than at render because `window` does not exist
   * during the server render.
   */
  useEffect(() => {
    if (!isDemoMode()) {
      setBooting(false);
      return;
    }
    setDemo(true);
    let cancelled = false;
    void loadHuntBundle().then((b) => {
      if (cancelled) return;
      begin(b);
      setBooting(false);
    });
    return () => {
      cancelled = true;
    };
  }, [begin]);

  if (booting) {
    return (
      <main className="wrap stack">
        <div>
          <BackButton label="Home" />
        </div>
        <LoadingPanel what="Loading the Pittsburgh hunt" timeoutMs={10_000} />
      </main>
    );
  }

  if (!bundle || !routeId) return <LocationGate onReady={begin} />;
  return <SoloHunt bundle={bundle} routeId={routeId} demo={demo} />;
}

function SoloHunt({
  bundle,
  routeId,
  demo,
}: {
  bundle: HuntBundle;
  routeId: string;
  /** Arrived via ?demo=1 — start in simulated movement, skip the GPS ask. */
  demo: boolean;
}) {
  const checkpoints = useMemo(() => routeCheckpoints(bundle, routeId), [bundle, routeId]);
  const route = bundle.routes.find((r) => r.id === routeId);

  const hunt = useSoloHunt(routeId, checkpoints);
  const { activeCheckpoint, state } = hunt;

  const firstCheckpoint = checkpoints[0];
  const location = useLocation({
    demoStart: firstCheckpoint
      ? // Start ~250m short of the first stop so there is a visible walk.
        { latitude: firstCheckpoint.latitude - 0.0022, longitude: firstCheckpoint.longitude - 0.0012 }
      : { latitude: 40.4406, longitude: -80.0045 },
    initialSource: demo ? 'demo' : 'gps',
  });

  const [trail, setTrail] = useState<LocationSample[]>([]);
  const [answer, setAnswer] = useState('');
  const [image, setImage] = useState<string | null>(null);

  // --- Phaser HUD ---------------------------------------------------------
  const hudRef = useRef<HTMLDivElement | null>(null);
  // The bridge is owned by React so events survive a StrictMode remount.
  const bridgeRef = useRef<GameBridge | null>(null);
  if (!bridgeRef.current) bridgeRef.current = new GameBridge();

  useEffect(() => {
    let handle: GameHandle | undefined;
    let cancelled = false;

    void import('@ww/game/mount').then(({ mountGame }) => {
      if (cancelled || !hudRef.current || !bridgeRef.current) return;
      handle = mountGame(hudRef.current, {
        bridge: bridgeRef.current,
        totalCheckpoints: checkpoints.length,
        selfPlayerId: 'solo',
        onHintRequested: () => hunt.requestHint(),
      });
    });

    return () => {
      cancelled = true;
      handle?.destroy();
    };
    // Mount once; the bridge carries every later update.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [checkpoints.length]);

  // Push XP and progress into the HUD. Phaser stores none of this.
  useEffect(() => {
    bridgeRef.current?.emit({
      type: 'XP_AWARDED',
      amount: 0,
      total: state.totalXp,
    });
    bridgeRef.current?.emit({
      type: 'PROGRESS_UPDATE',
      completed: state.activeIndex,
      total: checkpoints.length,
    });
  }, [state.totalXp, state.activeIndex, checkpoints.length]);

  // --- Arrival detection ---------------------------------------------------
  const distanceToTarget =
    location.position && activeCheckpoint
      ? haversineMeters(location.position, activeCheckpoint)
      : Infinity;

  const withinRadius = activeCheckpoint ? distanceToTarget <= activeCheckpoint.radiusMeters : false;

  useEffect(() => {
    // NEXT_CHECKPOINT counts as navigable: a player can already be standing on
    // the next waypoint when it unlocks (the stops are minutes apart, and in
    // Demo Mode the walk is instant). Watching only for NAVIGATING meant
    // arrival never fired for checkpoints 2+.
    const navigable = state.phase === 'NAVIGATING' || state.phase === 'NEXT_CHECKPOINT';
    if (withinRadius && navigable) {
      hunt.arrive();
      bridgeRef.current?.emit({
        type: 'PLAYER_ARRIVED',
        checkpointId: activeCheckpoint?.id ?? '',
        index: state.activeIndex,
      });
    }
  }, [withinRadius, state.phase, state.activeIndex, activeCheckpoint?.id, hunt]);

  // --- Breadcrumb trail ----------------------------------------------------
  useEffect(() => {
    if (state.phase === 'NOT_STARTED' || state.phase === 'FINISHED') return;
    const id = setInterval(() => {
      const pos = location.position;
      if (pos) {
        setTrail((t) => [...t, { ...pos, timestamp: Date.now(), accuracyMeters: location.accuracyMeters }]);
      }
    }, TRAIL_SAMPLE_MS);
    return () => clearInterval(id);
  }, [state.phase, location.position, location.accuracyMeters]);

  // --- Actions -------------------------------------------------------------
  const handleStart = useCallback(() => {
    hunt.start();
    if (location.source === 'demo' && firstCheckpoint) location.walkTo(firstCheckpoint);
  }, [hunt, location, firstCheckpoint]);

  const handleSubmit = useCallback(async () => {
    // A null photo is allowed in Demo Mode and is handled honestly downstream:
    // the model is not called and the result is labelled "photo NOT verified".
    await hunt.submit(image, answer, API_URL);

    // Clear ONLY the photo, and only so "Retake photo" is the obvious next
    // step. The written answer is deliberately kept: a rejection is usually
    // about the photo, and live Gemini often says so explicitly ("the text
    // answer matches the accepted list") while the player is made to retype a
    // correct answer on a street corner. Both are cleared for real on the
    // next checkpoint, in handleAdvance.
    setImage(null);
  }, [image, answer, hunt]);

  const handleAdvance = useCallback(() => {
    hunt.advance();
    // NOW clear both — a new checkpoint means a new answer. (handleSubmit
    // deliberately keeps the answer so a rejected photo can be retaken
    // without retyping a correct answer.)
    setAnswer('');
    setImage(null);
    const next = checkpoints[state.activeIndex + 1];
    if (location.source === 'demo' && next) location.walkTo(next);
  }, [hunt, checkpoints, state.activeIndex, location]);

  const completedPoints = checkpoints
    .slice(0, state.activeIndex)
    .map((c) => ({ position: { latitude: c.latitude, longitude: c.longitude }, name: c.name }));

  const finalCp = checkpoints.at(-1);

  return (
    <div style={{ position: 'fixed', inset: 0, display: 'flex', flexDirection: 'column' }}>
      {/* Map fills the space behind everything */}
      <div style={{ position: 'absolute', inset: 0 }}>
        <HuntMap
          player={location.position}
          accuracyMeters={location.accuracyMeters}
          activeTarget={
            activeCheckpoint && state.phase !== 'NOT_STARTED' && state.phase !== 'FINISHED'
              ? {
                  position: { latitude: activeCheckpoint.latitude, longitude: activeCheckpoint.longitude },
                  radiusMeters: activeCheckpoint.radiusMeters,
                }
              : null
          }
          completed={completedPoints}
          finalDestination={
            finalCp ? { latitude: finalCp.latitude, longitude: finalCp.longitude } : null
          }
          trail={trail}
          arrived={withinRadius}
        />
      </div>

      {/* Leaving mid-hunt loses the run, so confirm. */}
      <BackButton floating label="Quit" confirm="Quit? Progress is lost" />

      {/* Phaser overlay */}
      <div ref={hudRef} style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }} />

      <SoloPanel
        hunt={hunt}
        route={route?.label ?? routeId}
        distance={distanceToTarget}
        withinRadius={withinRadius}
        location={location}
        answer={answer}
        setAnswer={setAnswer}
        image={image}
        setImage={setImage}
        onStart={handleStart}
        onSubmit={handleSubmit}
        onAdvance={handleAdvance}
        notice={
          bundle.isFallback
            ? { text: '⚠ Placeholder content', tone: 'warn' as const }
            : location.source === 'demo'
              ? { text: '▶ Demo Mode', tone: 'info' as const }
              : null
        }
      />
    </div>
  );
}

/** The progress strip every in-play sheet opens with. */
function panelProgress(props: {
  hunt: HuntApi;
  notice: { text: string; tone: 'warn' | 'info' } | null;
}) {
  return (
    <ProgressBar
      index={props.hunt.state.activeIndex}
      total={props.hunt.totalCheckpoints}
      xp={props.hunt.state.totalXp}
      notice={props.notice?.text}
      noticeTone={props.notice?.tone}
    />
  );
}

type HuntApi = ReturnType<typeof useSoloHunt>;
type LocApi = ReturnType<typeof useLocation>;

function SoloPanel(props: {
  hunt: HuntApi;
  route: string;
  distance: number;
  withinRadius: boolean;
  location: LocApi;
  answer: string;
  setAnswer: (v: string) => void;
  image: string | null;
  setImage: (v: string | null) => void;
  onStart: () => void;
  onSubmit: () => void;
  onAdvance: () => void;
  notice: { text: string; tone: 'warn' | 'info' } | null;
}) {
  const { hunt, location } = props;
  const { state, activeCheckpoint, lastOutcome, instruction, hintText, verifying } = hunt;

  // ---------------------------------------------------------------- pre-start
  if (state.phase === 'NOT_STARTED') {
    return (
      <div className="sheet">
        <p className="label" style={{ color: 'var(--pink)', marginBottom: 8 }}>
          Your route
        </p>
        <h2 style={{ marginBottom: 10 }}>{props.route}</h2>
        <p className="muted" style={{ fontSize: 16 }}>
          {hunt.totalCheckpoints} stops, finishing where every route ends. You only
          ever see one clue at a time.
        </p>

        <button
          className="btn btn-pink btn-block"
          style={{ minHeight: 68, fontSize: 20 }}
          onClick={props.onStart}
        >
          Start hunt
        </button>

        <p className="dim" style={{ fontSize: 14, textAlign: 'center', margin: '10px 0 0' }}>
          {location.source === 'demo'
            ? 'Demo Mode — movement is simulated.'
            : 'Using real GPS.'}
        </p>

        <div style={{ display: 'flex', gap: 10, marginTop: 10 }}>
          <button className="btn btn-ghost" style={{ flex: 1 }} onClick={() => location.startGps()}>
            Real GPS
          </button>
          <button
            className="btn btn-ghost"
            style={{ flex: 1 }}
            onClick={() => location.enableDemoMode()}
          >
            Demo Mode
          </button>
        </div>

        {/* Permission denied is the single most common blocker. Name the exit. */}
        {location.error && (
          <div className="card" style={{ borderColor: 'var(--pink)', marginTop: 14 }}>
            <p style={{ margin: '0 0 12px', fontSize: 15, color: 'var(--pink)' }}>
              {location.error}
            </p>
            <button
              className="btn btn-lime btn-block"
              onClick={() => location.enableDemoMode()}
            >
              Use demo location
            </button>
          </div>
        )}
      </div>
    );
  }

  // ----------------------------------------------------------------- finished
  // REWARD REGISTER: light surface, full-bleed accent hero.
  if (state.phase === 'FINISHED') {
    return (
      <div className="sheet sheet-light" style={{ maxHeight: '88dvh' }}>
        <div className="hero hero-lime">
          <p className="label" style={{ marginBottom: 6 }}>
            Hunt complete
          </p>
          <p className="display" style={{ fontSize: 68, lineHeight: 0.9 }}>
            {state.totalXp}
          </p>
          <p className="label" style={{ marginTop: 4, marginBottom: 0 }}>
            total XP
          </p>
        </div>

        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(3, minmax(0, 1fr))',
            gap: 10,
            margin: '4px 0 16px',
            textAlign: 'center',
          }}
        >
          {(
            [
              [String(hunt.totalCheckpoints), 'checkpoints'],
              [String(state.reveals.length), 'discoveries'],
              [props.route, 'your route'],
            ] as const
          ).map(([value, label]) => (
            <div key={label}>
              <p
                style={{
                  margin: 0,
                  fontWeight: 900,
                  fontSize: 22,
                  color: 'var(--ink)',
                  overflowWrap: 'anywhere',
                }}
              >
                {value}
              </p>
              <p className="label" style={{ margin: 0, color: 'var(--ink-body)', opacity: 0.7 }}>
                {label}
              </p>
            </div>
          ))}
        </div>

        {/* What they actually found, in order. This is the souvenir. */}
        {state.reveals.length > 0 && (
          <div style={{ marginBottom: 18 }}>
            {state.reveals.map((r, i) => (
              <div
                key={`${r.name}-${i}`}
                style={{
                  display: 'flex',
                  gap: 12,
                  padding: '10px 0',
                  borderTop: i === 0 ? 'none' : '2px solid rgba(23,16,67,0.12)',
                }}
              >
                <span
                  className="mono"
                  style={{ fontWeight: 900, color: 'var(--ink-body)', opacity: 0.5 }}
                >
                  {i + 1}
                </span>
                <p style={{ margin: 0, color: 'var(--ink)', fontWeight: 700 }}>{r.name}</p>
              </div>
            ))}
          </div>
        )}

        <p style={{ fontSize: 16, color: 'var(--ink-body)' }}>
          Everyone finished in the same place. Nobody walked the same way there.
        </p>

        {/* Replay belongs HERE — at the end of a run, not on the landing page. */}
        <a
          className="btn btn-cyan btn-block"
          href="/demo"
          style={{ minHeight: 64, fontSize: 19 }}
        >
          Watch the replay
        </a>
        <a
          className="btn btn-block"
          href="/"
          style={{
            marginTop: 10,
            background: 'transparent',
            border: '3px solid var(--ink)',
            color: 'var(--ink)',
          }}
        >
          Back to start
        </a>
      </div>
    );
  }

  // ------------------------------------------------------------------- reveal
  // REWARD REGISTER. This is the moment the product is about, so it must not
  // be mistakable for a notification — the whole surface changes.
  if (lastOutcome?.outcome === 'approved' && lastOutcome.reveal) {
    return (
      <div className="sheet sheet-light">
        <div className={lastOutcome.degraded ? 'hero hero-cyan' : 'hero hero-lime'}>
          <p className="label" style={{ marginBottom: 6 }}>
            {lastOutcome.degraded ? 'Answer accepted · photo not verified' : 'Verified'}
          </p>
          <p className="display" style={{ fontSize: 44 }}>
            +{lastOutcome.xpAwarded} XP
          </p>
        </div>

        <h3 style={{ color: 'var(--ink)', marginBottom: 10 }}>{lastOutcome.reveal.name}</h3>
        <p style={{ fontSize: 17, lineHeight: 1.6, color: 'var(--ink-body)' }}>
          {lastOutcome.reveal.historicalReveal}
        </p>

        {lastOutcome.reveal.sources.length > 0 && (
          <p className="label" style={{ color: 'var(--ink-body)', opacity: 0.7, letterSpacing: '0.06em' }}>
            {lastOutcome.reveal.sources.map((s, i) => (
              <span key={s.title}>
                {i > 0 && ' · '}
                {s.url ? (
                  <a href={s.url} target="_blank" rel="noreferrer" style={{ color: 'var(--ink)' }}>
                    {s.title}
                  </a>
                ) : (
                  s.title
                )}
              </span>
            ))}
          </p>
        )}

        <button className="btn btn-pink btn-block" style={{ marginTop: 8 }} onClick={props.onAdvance}>
          Next clue →
        </button>
      </div>
    );
  }

  if (!activeCheckpoint) return null;

  // ---------------------------------------------------------------- arrived
  if (props.withinRadius) {
    const rejected = lastOutcome?.outcome === 'rejected';
    const hasAnswer = props.answer.trim().length > 0;
    /**
     * Demo Mode runs on a laptop with no camera and nothing to photograph, so
     * requiring a file there makes the whole flow undemonstrable. The photo
     * stays optional ONLY in Demo Mode, and the result is labelled unverified.
     */
    const photoOptional = location.source === 'demo';
    const ready = hasAnswer && (photoOptional || Boolean(props.image));

    return (
      <div className="sheet">
        {panelProgress(props)}

        <span className="pill pill-lime">You&apos;re here</span>

        <h3 style={{ margin: '12px 0 6px' }}>{activeCheckpoint.observationQuestion}</h3>
        <p className="muted" style={{ fontSize: 15 }}>
          {activeCheckpoint.photoRequirement}
        </p>

        {instruction && (
          <div
            style={{
              background: 'var(--yellow)',
              color: 'var(--yellow-ink)',
              borderRadius: 'var(--r-btn)',
              padding: '13px 15px',
              margin: '14px 0',
            }}
          >
            <p className="label" style={{ marginBottom: 5, opacity: 0.75 }}>
              Required in this photo
            </p>
            <p style={{ margin: 0, fontWeight: 800, fontSize: 17 }}>{instruction}</p>
          </div>
        )}

        <PhotoCapture onCapture={props.setImage} disabled={verifying} />

        <input
          className="field"
          style={{ marginTop: 12 }}
          value={props.answer}
          onChange={(e) => props.setAnswer(e.target.value)}
          placeholder="Your answer"
        />

        {/* A rejection is a dead end unless it names the way out. */}
        {rejected && (
          <div
            className="card"
            style={{ borderColor: 'var(--pink)', marginTop: 14, marginBottom: 0 }}
          >
            <p className="label" style={{ color: 'var(--pink)', marginBottom: 8 }}>
              Not accepted
            </p>
            <p style={{ margin: '0 0 12px', fontSize: 15 }}>{lastOutcome?.message}</p>
            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
              <span className="pill pill-cyan">Retake the photo above</span>
              {!hintText && (
                <button
                  className="btn btn-ghost"
                  style={{ minHeight: 40, fontSize: 14, padding: '0 14px' }}
                  onClick={hunt.requestHint}
                >
                  Need a hint?
                </button>
              )}
            </div>
          </div>
        )}

        {hintText && (
          <p style={{ color: 'var(--yellow)', fontSize: 15, marginTop: 12, marginBottom: 0 }}>
            💡 {hintText}
          </p>
        )}

        {/* ONE primary action, full width, bottom of the sheet. */}
        <button
          className="btn btn-lime btn-block"
          style={{ marginTop: 16, minHeight: 68, fontSize: 20 }}
          onClick={props.onSubmit}
          disabled={!ready || verifying}
        >
          {verifying
            ? 'Verifying…'
            : ready
              ? props.image || !photoOptional
                ? 'Submit proof'
                : 'Submit answer only'
              : photoOptional
                ? 'Type your answer'
                : 'Add a photo and an answer'}
        </button>

        {photoOptional && !props.image && hasAnswer && (
          <p className="dim" style={{ fontSize: 13, textAlign: 'center', margin: '8px 0 0' }}>
            No photo — this will be scored on the answer alone and marked
            <strong> not verified</strong>.
          </p>
        )}

        {!rejected && (
          <button
            className="btn btn-ghost btn-block"
            style={{ marginTop: 10 }}
            onClick={hintText ? hunt.requestDeeperHint : hunt.requestHint}
            disabled={verifying || (hintText !== null && !activeCheckpoint.hints?.[1])}
          >
            Need a hint? (−20 XP)
          </button>
        )}
      </div>
    );
  }

  // -------------------------------------------------------------- navigating
  return (
    <div className="sheet">
      {panelProgress(props)}

      {/* The clue is the best writing in the product. Give it room. */}
      <p
        data-testid="clue"
        style={{ fontSize: 19, lineHeight: 1.5, fontWeight: 600, marginBottom: 14 }}
      >
        {activeCheckpoint.clue}
      </p>

      <p className="muted mono" style={{ fontSize: 15 }}>
        {Number.isFinite(props.distance) ? `${Math.round(props.distance)} m away` : 'Locating…'}
      </p>

      {hintText && (
        <p style={{ color: 'var(--yellow)', fontSize: 15 }}>💡 {hintText}</p>
      )}

      {location.source === 'demo' ? (
        <button
          className="btn btn-cyan btn-block"
          style={{ marginTop: 6, minHeight: 62, fontSize: 19 }}
          onClick={() => location.walkTo(activeCheckpoint)}
        >
          ▶ Walk there
        </button>
      ) : (
        /* GPS is the real thing, but a stuck player must never be stranded. */
        <button
          className="btn btn-ghost btn-block"
          style={{ marginTop: 6 }}
          onClick={() => location.enableDemoMode()}
        >
          Use demo location instead
        </button>
      )}

      <button
        className="btn btn-ghost btn-block"
        style={{ marginTop: 10 }}
        onClick={hintText ? hunt.requestDeeperHint : hunt.requestHint}
      >
        Need a hint? (−20 XP)
      </button>
    </div>
  );
}
