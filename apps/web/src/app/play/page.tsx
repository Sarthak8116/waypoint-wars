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
import PhotoCapture from '@/components/PhotoCapture';

// MapLibre touches `window` at module scope.
const HuntMap = dynamic(() => import('@/components/HuntMap'), { ssr: false });

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:2567';

/** Breadcrumb cadence. PLAN.md P9 calls for a sample every 10-15s. */
const TRAIL_SAMPLE_MS = 12_000;

export default function PlayPage() {
  const [bundle, setBundle] = useState<HuntBundle | null>(null);
  const [routeId, setRouteId] = useState<string | null>(null);

  useEffect(() => {
    void loadHuntBundle().then((b) => {
      setBundle(b);
      // Solo players get a route at random, same as multiplayer assignment.
      const pick = b.routes[Math.floor(Math.random() * b.routes.length)];
      setRouteId(pick?.id ?? null);
    });
  }, []);

  if (!bundle || !routeId) {
    return (
      <main className="wrap">
        <p className="muted">Loading hunt…</p>
      </main>
    );
  }

  return <SoloHunt bundle={bundle} routeId={routeId} />;
}

function SoloHunt({ bundle, routeId }: { bundle: HuntBundle; routeId: string }) {
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
    if (!image) return;
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

      {/* Phaser overlay */}
      <div ref={hudRef} style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }} />

      {bundle.isFallback && (
        <Banner tone="warn">⚠ Placeholder content</Banner>
      )}
      {location.source === 'demo' && <Banner tone="info">▶ Demo Mode</Banner>}

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
      />
    </div>
  );
}

function Banner({ tone, children }: { tone: 'warn' | 'info'; children: React.ReactNode }) {
  return (
    <div className="hud" style={{ position: 'absolute', top: 0, left: 0, right: 0, zIndex: 20 }}>
      {/* Three columns: the Phaser HUD owns left and right, this owns centre.
          Grid + nowrap pills is what makes collision structurally impossible. */}
      <span />
      <span className="hud-center">
        <span className={`pill ${tone === 'warn' ? 'pill-yellow' : 'pill-cyan'}`}>{children}</span>
      </span>
      <span />
    </div>
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

        <button className="btn btn-pink btn-block" onClick={props.onStart}>
          Start hunt
        </button>

        <div style={{ display: 'flex', gap: 10, marginTop: 12 }}>
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

        {location.error && (
          <p style={{ color: 'var(--pink)', fontSize: 14, marginTop: 12, marginBottom: 0 }}>
            {location.error}
          </p>
        )}
      </div>
    );
  }

  // ----------------------------------------------------------------- finished
  // REWARD REGISTER: light surface, full-bleed accent hero.
  if (state.phase === 'FINISHED') {
    return (
      <div className="sheet sheet-light">
        <div className="hero hero-lime">
          <p className="label" style={{ marginBottom: 6 }}>
            Hunt complete
          </p>
          <p className="display" style={{ fontSize: 52 }}>
            {state.totalXp} XP
          </p>
        </div>
        <p style={{ fontSize: 17, color: 'var(--ink-body)' }}>
          {state.reveals.length} historical discoveries on the {props.route}. The other
          routes uncovered entirely different ones.
        </p>
        <a className="btn btn-cyan btn-block" href="/demo">
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
    return (
      <div className="sheet">
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

        {lastOutcome?.outcome === 'rejected' && (
          <p style={{ color: 'var(--pink)', fontSize: 15, marginTop: 12, marginBottom: 0 }}>
            {lastOutcome.message}
          </p>
        )}

        {hintText && (
          <p style={{ color: 'var(--yellow)', fontSize: 15, marginTop: 12, marginBottom: 0 }}>
            💡 {hintText}
          </p>
        )}

        <div style={{ display: 'flex', gap: 10, marginTop: 14 }}>
          <button
            className="btn btn-ghost"
            onClick={hintText ? hunt.requestDeeperHint : hunt.requestHint}
            disabled={verifying || (hintText !== null && !activeCheckpoint.hints?.[1])}
          >
            Hint
          </button>
          <button
            className="btn btn-lime"
            style={{ flex: 1 }}
            onClick={props.onSubmit}
            disabled={!props.image || !props.answer.trim() || verifying}
          >
            {verifying ? 'Verifying…' : 'Submit'}
          </button>
        </div>
      </div>
    );
  }

  // -------------------------------------------------------------- navigating
  return (
    <div className="sheet">
      <p className="label dim" style={{ marginBottom: 10 }}>
        Clue {state.activeIndex + 1} of {hunt.totalCheckpoints}
      </p>

      {/* The clue is the best writing in the product. Give it room. */}
      <p style={{ fontSize: 19, lineHeight: 1.5, fontWeight: 600, marginBottom: 14 }}>
        {activeCheckpoint.clue}
      </p>

      <p className="muted mono" style={{ fontSize: 15 }}>
        {Number.isFinite(props.distance) ? `${Math.round(props.distance)} m away` : 'Locating…'}
      </p>

      {hintText && (
        <p style={{ color: 'var(--yellow)', fontSize: 15 }}>💡 {hintText}</p>
      )}

      <div style={{ display: 'flex', gap: 10, marginTop: 6 }}>
        <button className="btn btn-ghost" onClick={hintText ? hunt.requestDeeperHint : hunt.requestHint}>
          Hint −20
        </button>
        {location.source === 'demo' && (
          <button
            className="btn btn-cyan"
            style={{ flex: 1 }}
            onClick={() => location.walkTo(activeCheckpoint)}
          >
            ▶ Walk there
          </button>
        )}
      </div>
    </div>
  );
}
