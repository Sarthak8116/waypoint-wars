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
    if (withinRadius && state.phase === 'NAVIGATING') {
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
    setImage(null);
    setAnswer('');
  }, [image, answer, hunt]);

  const handleAdvance = useCallback(() => {
    hunt.advance();
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
    <div
      style={{
        position: 'absolute',
        top: 10,
        left: '50%',
        transform: 'translateX(-50%)',
        zIndex: 20,
        background: tone === 'warn' ? 'rgba(251,191,36,0.16)' : 'rgba(94,234,212,0.14)',
        color: tone === 'warn' ? 'var(--warn)' : 'var(--accent)',
        border: `1px solid ${tone === 'warn' ? 'var(--warn)' : 'var(--accent)'}`,
        borderRadius: 999,
        padding: '5px 12px',
        fontSize: 11,
        fontWeight: 700,
        // The Phaser HUD draws XP at top-left and the timer at top-right, so
        // this has to fit BETWEEN them. nowrap + a long label overflowed into
        // both on a 430px phone — only visible in a screenshot.
        maxWidth: 'calc(100vw - 200px)',
        overflow: 'hidden',
        textOverflow: 'ellipsis',
        whiteSpace: 'nowrap',
      }}
    >
      {children}
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

  const sheet: React.CSSProperties = {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    zIndex: 30,
    background: 'var(--surface)',
    borderTop: '1px solid var(--line)',
    borderRadius: '18px 18px 0 0',
    padding: 16,
    paddingBottom: 'max(16px, env(safe-area-inset-bottom))',
    maxHeight: '72dvh',
    overflowY: 'auto',
  };

  // --- Pre-start -----------------------------------------------------------
  if (state.phase === 'NOT_STARTED') {
    return (
      <div style={sheet}>
        <p className="muted" style={{ margin: '0 0 4px', fontSize: 12, letterSpacing: '0.08em' }}>
          YOUR ROUTE
        </p>
        <h2 style={{ margin: '0 0 12px', fontSize: 24 }}>{props.route}</h2>
        <p className="muted" style={{ marginTop: 0, fontSize: 15 }}>
          {hunt.totalCheckpoints} stops, finishing where every route ends. You&apos;ll only see one
          clue at a time.
        </p>
        <button className="btn primary" style={{ width: '100%' }} onClick={props.onStart}>
          Start hunt
        </button>
        <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
          <button className="btn" style={{ flex: 1 }} onClick={() => location.startGps()}>
            Use real GPS
          </button>
          <button className="btn" style={{ flex: 1 }} onClick={() => location.enableDemoMode()}>
            Demo Mode
          </button>
        </div>
        {location.error && (
          <p style={{ color: 'var(--bad)', fontSize: 13 }}>{location.error}</p>
        )}
      </div>
    );
  }

  // --- Finished ------------------------------------------------------------
  if (state.phase === 'FINISHED') {
    return (
      <div style={sheet}>
        <h2 style={{ margin: '0 0 6px', fontSize: 26 }}>Hunt complete</h2>
        <p style={{ fontSize: 40, fontWeight: 800, margin: '0 0 12px', color: 'var(--accent)' }}>
          {state.totalXp} XP
        </p>
        <p className="muted" style={{ fontSize: 15 }}>
          {state.reveals.length} historical discoveries on the {props.route}. Other routes uncovered
          entirely different ones.
        </p>
        <a className="btn primary" href="/" style={{ width: '100%' }}>
          Back to start
        </a>
      </div>
    );
  }

  // --- Reveal after approval ----------------------------------------------
  if (lastOutcome?.outcome === 'approved' && lastOutcome.reveal) {
    return (
      <div style={sheet}>
        <span className={`badge ${lastOutcome.degraded ? 'mock' : 'live'}`}>
          +{lastOutcome.xpAwarded} XP · {lastOutcome.degraded ? 'photo NOT verified' : 'verified'}
        </span>
        {lastOutcome.degraded && (
          <p style={{ color: 'var(--warn)', fontSize: 12, margin: '8px 0 0' }}>
            ⚠ Photo verification was unavailable ({lastOutcome.degraded}); this was accepted on the
            written answer alone.
          </p>
        )}
        <h2 style={{ margin: '10px 0 8px', fontSize: 22 }}>{lastOutcome.reveal.name}</h2>
        <p style={{ fontSize: 16, lineHeight: 1.6, marginTop: 0 }}>
          {lastOutcome.reveal.historicalReveal}
        </p>
        {lastOutcome.reveal.sources.length > 0 && (
          <p className="muted" style={{ fontSize: 12 }}>
            Sources:{' '}
            {lastOutcome.reveal.sources.map((s, i) => (
              <span key={s.title}>
                {i > 0 && ' · '}
                {s.url ? <a href={s.url} target="_blank" rel="noreferrer">{s.title}</a> : s.title}
              </span>
            ))}
          </p>
        )}
        <button className="btn primary" style={{ width: '100%' }} onClick={props.onAdvance}>
          Next clue →
        </button>
      </div>
    );
  }

  if (!activeCheckpoint) return null;

  // --- Arrived: the challenge ---------------------------------------------
  if (props.withinRadius) {
    return (
      <div style={sheet}>
        <span className="badge live">You&apos;re here</span>
        <h3 style={{ margin: '10px 0 6px', fontSize: 18 }}>{activeCheckpoint.observationQuestion}</h3>
        <p className="muted" style={{ marginTop: 0, fontSize: 14 }}>
          {activeCheckpoint.photoRequirement}
        </p>

        {instruction && (
          <div
            style={{
              background: 'var(--surface-2)',
              border: '1px solid var(--accent-2)',
              borderRadius: 10,
              padding: '10px 12px',
              margin: '12px 0',
            }}
          >
            <p className="muted" style={{ margin: 0, fontSize: 11, letterSpacing: '0.08em' }}>
              REQUIRED IN THIS PHOTO
            </p>
            <p style={{ margin: '4px 0 0', fontWeight: 600 }}>{instruction}</p>
          </div>
        )}

        <PhotoCapture onCapture={props.setImage} disabled={verifying} />

        <input
          value={props.answer}
          onChange={(e) => props.setAnswer(e.target.value)}
          placeholder="Your answer"
          style={{
            width: '100%',
            minHeight: 48,
            marginTop: 10,
            padding: '0 14px',
            borderRadius: 12,
            border: '1px solid var(--line)',
            background: 'var(--surface-2)',
            color: 'var(--text)',
            fontSize: 16, // 16px stops iOS Safari zooming the viewport on focus
          }}
        />

        {lastOutcome?.outcome === 'rejected' && (
          <p style={{ color: 'var(--bad)', fontSize: 14 }}>{lastOutcome.message}</p>
        )}

        {hintText && (
          <p style={{ color: 'var(--warn)', fontSize: 14 }}>💡 {hintText}</p>
        )}

        <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
          <button
            className="btn"
            onClick={hintText ? hunt.requestDeeperHint : hunt.requestHint}
            disabled={verifying || (hintText !== null && !activeCheckpoint.hints?.[1])}
          >
            Hint
          </button>
          <button
            className="btn primary"
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

  // --- Navigating ----------------------------------------------------------
  return (
    <div style={sheet}>
      <p className="muted" style={{ margin: '0 0 6px', fontSize: 12, letterSpacing: '0.08em' }}>
        CLUE {state.activeIndex + 1} OF {hunt.totalCheckpoints}
      </p>
      <p style={{ fontSize: 17, lineHeight: 1.55, margin: '0 0 12px' }}>{activeCheckpoint.clue}</p>
      <p className="muted" style={{ fontSize: 14, marginTop: 0 }}>
        {Number.isFinite(props.distance) ? `${Math.round(props.distance)} m away` : 'Locating…'}
      </p>
      {hintText && <p style={{ color: 'var(--warn)', fontSize: 14 }}>💡 {hintText}</p>}
      <div style={{ display: 'flex', gap: 8 }}>
        <button className="btn" onClick={hintText ? hunt.requestDeeperHint : hunt.requestHint}>
          Hint (−20 XP)
        </button>
        {location.source === 'demo' && (
          <button
            className="btn"
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
