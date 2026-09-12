'use client';

/**
 * Multiplayer race screen.
 *
 * Structurally the same as solo, with one critical difference: **the server
 * decides everything.** This screen holds no XP arithmetic, no progression
 * logic, and no answer checking. It sends intents and renders replies.
 *
 * Opponents appear as coarse regions and progress bars only. The client is
 * never sent their exact position, their route, their clues, or their answers
 * — not hidden in the UI, not present in the payload at all.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import dynamic from 'next/dynamic';
import { haversineMeters, type LatLng, type LocationSample } from '@ww/shared';
import { GameBridge, type GameHandle } from '@ww/game';
import { useRoom } from '@/lib/RoomProvider';
import { useLocation } from '@/lib/useLocation';
import PhotoCapture from '@/components/PhotoCapture';

const HuntMap = dynamic(() => import('@/components/HuntMap'), { ssr: false });

const LOCATION_PUSH_MS = 5_000;
const TRAIL_SAMPLE_MS = 12_000;

export default function RacePage() {
  const room = useRoom();
  const { view } = room;

  /**
   * `useRoom()` returns a fresh object literal on every render, so depending on
   * `room` in an effect re-runs that effect constantly. The arrival effect's
   * cleanup then cancelled its own pending instruction request every time, and
   * `request_instruction` never once reached the server. The individual
   * callbacks are useCallback'd and stable — depend on those.
   */
  const { requestInstruction, updateLocation, requestHint, submitCheckpoint } = room;

  const target: LatLng | null = view.checkpoint
    ? { latitude: view.checkpoint.latitude, longitude: view.checkpoint.longitude }
    : null;

  const location = useLocation({
    demoStart: target
      ? { latitude: target.latitude - 0.0022, longitude: target.longitude - 0.0012 }
      : { latitude: 40.4406, longitude: -80.0045 },
  });

  const [trail, setTrail] = useState<LocationSample[]>([]);
  const [answer, setAnswer] = useState('');
  const [image, setImage] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const arrivedRef = useRef(false);

  // --- HUD ----------------------------------------------------------------
  const hudRef = useRef<HTMLDivElement | null>(null);
  const bridgeRef = useRef<GameBridge | null>(null);
  if (!bridgeRef.current) bridgeRef.current = new GameBridge();

  useEffect(() => {
    let handle: GameHandle | undefined;
    let cancelled = false;
    void import('@ww/game/mount').then(({ mountGame }) => {
      if (cancelled || !hudRef.current || !bridgeRef.current) return;
      handle = mountGame(hudRef.current, {
        bridge: bridgeRef.current,
        totalCheckpoints: view.totalCheckpoints || 5,
        selfPlayerId: view.selfId ?? undefined,
        onHintRequested: () => view.checkpoint && requestHint(view.checkpoint.id),
      });
    });
    return () => {
      cancelled = true;
      handle?.destroy();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Mirror server-owned values into the HUD. Phaser stores none of them.
  useEffect(() => {
    bridgeRef.current?.emit({ type: 'XP_AWARDED', amount: 0, total: view.xp });
    bridgeRef.current?.emit({
      type: 'PROGRESS_UPDATE',
      completed: view.checkpointIndex,
      total: view.totalCheckpoints,
    });
  }, [view.xp, view.checkpointIndex, view.totalCheckpoints]);

  useEffect(() => {
    for (const o of view.opponents) {
      bridgeRef.current?.emit({
        type: 'OPPONENT_PROGRESS',
        playerId: o.playerId,
        name: o.name,
        checkpointIndex: o.checkpointIndex,
      });
    }
  }, [view.opponents]);

  // --- Location reporting --------------------------------------------------
  useEffect(() => {
    if (view.phase !== 'running') return;
    const id = setInterval(() => {
      const p = location.position;
      if (p) updateLocation(p.latitude, p.longitude, location.accuracyMeters);
    }, LOCATION_PUSH_MS);
    return () => clearInterval(id);
  }, [view.phase, location.position, location.accuracyMeters, updateLocation]);

  useEffect(() => {
    if (view.phase !== 'running') return;
    const id = setInterval(() => {
      const p = location.position;
      if (p) setTrail((t) => [...t, { ...p, timestamp: Date.now() }]);
    }, TRAIL_SAMPLE_MS);
    return () => clearInterval(id);
  }, [view.phase, location.position]);

  // --- Arrival -------------------------------------------------------------
  const distance =
    location.position && target ? haversineMeters(location.position, target) : Infinity;
  const withinRadius = view.checkpoint ? distance <= view.checkpoint.radiusMeters : false;

  /**
   * Latest values, read by the arrival effect WITHOUT being dependencies.
   *
   * This matters: `location.position` changes every animation frame while
   * walking. Depending on it re-ran the arrival effect constantly, and each
   * re-run's cleanup cancelled the pending instruction request before it could
   * fire — so the instruction never arrived and `arrivedRef` had already been
   * set, so nothing retried.
   */
  const latest = useRef({ position: location.position, accuracy: location.accuracyMeters, instruction: view.instruction });
  latest.current = {
    position: location.position,
    accuracy: location.accuracyMeters,
    instruction: view.instruction,
  };

  useEffect(() => {
    if (!withinRadius) {
      arrivedRef.current = false;
      return;
    }
    if (!view.checkpoint || arrivedRef.current) return;

    arrivedRef.current = true;
    const checkpointId = view.checkpoint.id;

    bridgeRef.current?.emit({
      type: 'PLAYER_ARRIVED',
      checkpointId,
      index: view.checkpointIndex,
    });

    /**
     * The server issues the instruction only once a LOCATION UPDATE has landed
     * inside the radius — that geofence check is the anti-cheat premise. But
     * locations are pushed on a 5s tick, so asking the instant the client
     * notices arrival races the server. Push a fix immediately, then ask, and
     * ask again if no answer came back.
     */
    const pos = latest.current.position;
    if (pos) updateLocation(pos.latitude, pos.longitude, latest.current.accuracy);

    const timers = [
      setTimeout(() => requestInstruction(checkpointId), 500),
      setTimeout(() => {
        if (!latest.current.instruction) requestInstruction(checkpointId);
      }, 2200),
      setTimeout(() => {
        if (!latest.current.instruction) {
          const p = latest.current.position;
          if (p) updateLocation(p.latitude, p.longitude, latest.current.accuracy);
          requestInstruction(checkpointId);
        }
      }, 4500),
    ];

    return () => timers.forEach(clearTimeout);
    // Only arrival identity belongs here. See `latest` above.
  }, [withinRadius, view.checkpoint, view.checkpointIndex, requestInstruction, updateLocation]);

  // Reset per-checkpoint UI when the server unlocks the next one.
  useEffect(() => {
    setAnswer('');
    setImage(null);
    setSubmitting(false);
    arrivedRef.current = false;
  }, [view.checkpointIndex]);

  const handleSubmit = useCallback(() => {
    if (!image || !view.checkpoint || !location.position) return;
    setSubmitting(true);
    submitCheckpoint({
      checkpointId: view.checkpoint.id,
      image,
      latitude: location.position.latitude,
      longitude: location.position.longitude,
      observationAnswer: answer,
      randomizedInstruction: view.instruction ?? '',
      submittedAt: Date.now(),
    });
  }, [image, answer, view.checkpoint, view.instruction, location.position, submitCheckpoint]);

  useEffect(() => {
    if (view.lastMessage) setSubmitting(false);
  }, [view.lastMessage]);

  const opponentRegions = useMemo(
    () =>
      view.opponents
        .filter((o) => o.region)
        .map((o) => ({ position: o.region!.center, name: o.name })),
    [view.opponents],
  );

  // --- Screens -------------------------------------------------------------
  if (view.phase === 'idle' || view.phase === 'error') {
    return (
      <main className="wrap">
        <h1 style={{ fontSize: 24 }}>Not in a room</h1>
        <p className="muted">{view.error ?? 'Join or create a room to race.'}</p>
        <a className="btn primary" href="/lobby">
          Go to lobby
        </a>
      </main>
    );
  }

  if (view.phase === 'finished') {
    return (
      <main className="wrap">
        <h1 style={{ fontSize: 28, marginBottom: 4 }}>Everyone made it to The Point</h1>
        <p className="muted" style={{ marginTop: 0 }}>
          Different routes, different discoveries, same finish.
        </p>
        <div className="card" style={{ margin: '16px 0' }}>
          {view.leaderboard.map((e) => (
            <div
              key={e.playerId}
              style={{
                display: 'flex',
                gap: 12,
                alignItems: 'center',
                padding: '9px 0',
                borderBottom: '1px solid var(--line)',
              }}
            >
              <span style={{ fontWeight: 800, width: 24, color: 'var(--muted)' }}>{e.rank}</span>
              <span style={{ flex: 1, fontWeight: 700 }}>{e.displayName}</span>
              <span className="muted" style={{ fontSize: 13 }}>
                {e.checkpointsCompleted}/{e.totalCheckpoints}
              </span>
              <span style={{ fontWeight: 800, color: 'var(--accent)' }}>{e.xp} XP</span>
            </div>
          ))}
        </div>
        <a className="btn primary" style={{ width: '100%' }} href="/demo">
          Watch route replay
        </a>
      </main>
    );
  }

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
    maxHeight: '70dvh',
    overflowY: 'auto',
  };

  return (
    <div style={{ position: 'fixed', inset: 0 }}>
      <div style={{ position: 'absolute', inset: 0 }}>
        <HuntMap
          player={location.position}
          accuracyMeters={location.accuracyMeters}
          activeTarget={
            view.checkpoint && target
              ? { position: target, radiusMeters: view.checkpoint.radiusMeters }
              : null
          }
          completed={opponentRegions}
          finalDestination={null}
          trail={trail}
          arrived={withinRadius}
        />
      </div>

      <div ref={hudRef} style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }} />

      {location.source === 'demo' && (
        <div
          style={{
            position: 'absolute',
            top: 10,
            left: '50%',
            transform: 'translateX(-50%)',
            zIndex: 20,
            background: 'rgba(94,234,212,0.14)',
            color: 'var(--accent)',
            border: '1px solid var(--accent)',
            borderRadius: 999,
            padding: '6px 14px',
            fontSize: 12,
            fontWeight: 700,
          }}
        >
          ▶ Demo Mode
        </div>
      )}

      <div style={sheet}>
        {/* Opponent strip: progress only, never a precise location. */}
        {view.opponents.length > 0 && (
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 12 }}>
            {view.opponents.map((o) => (
              <span key={o.playerId} className="badge">
                {o.name} · {o.checkpointIndex}/{o.totalCheckpoints || '?'} · {o.xp} XP
                {o.hintsUsed > 0 ? ' 💡' : ''}
              </span>
            ))}
          </div>
        )}

        {!view.checkpoint ? (
          <p className="muted">Waiting for your first clue…</p>
        ) : withinRadius ? (
          <>
            <span className="badge live">You&apos;re here</span>
            <h3 style={{ margin: '10px 0 6px', fontSize: 18 }}>
              {view.checkpoint.observationQuestion}
            </h3>
            <p className="muted" style={{ marginTop: 0, fontSize: 14 }}>
              {view.checkpoint.photoRequirement}
            </p>

            {view.instruction && (
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
                <p style={{ margin: '4px 0 0', fontWeight: 600 }}>{view.instruction}</p>
              </div>
            )}

            <PhotoCapture onCapture={setImage} disabled={submitting} />

            <input
              value={answer}
              onChange={(e) => setAnswer(e.target.value)}
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
                fontSize: 16,
              }}
            />

            {view.lastMessage && (
              <p style={{ fontSize: 14, color: 'var(--warn)' }}>{view.lastMessage}</p>
            )}
            {view.hint && <p style={{ color: 'var(--warn)', fontSize: 14 }}>💡 {view.hint}</p>}

            <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
              <button
                className="btn"
                onClick={() => view.checkpoint && requestHint(view.checkpoint.id)}
                disabled={submitting}
              >
                Hint
              </button>
              <button
                className="btn primary"
                style={{ flex: 1 }}
                onClick={handleSubmit}
                disabled={!image || !answer.trim() || submitting}
              >
                {submitting ? 'Verifying…' : 'Submit'}
              </button>
            </div>
          </>
        ) : (
          <>
            <p className="muted" style={{ margin: '0 0 6px', fontSize: 12, letterSpacing: '0.08em' }}>
              CLUE {view.checkpointIndex + 1} OF {view.totalCheckpoints || '?'}
            </p>
            <p style={{ fontSize: 17, lineHeight: 1.55, margin: '0 0 10px' }}>
              {view.checkpoint.clue}
            </p>
            <p className="muted" style={{ fontSize: 14, marginTop: 0 }}>
              {Number.isFinite(distance) ? `${Math.round(distance)} m away` : 'Locating…'}
            </p>
            {view.hint && <p style={{ color: 'var(--warn)', fontSize: 14 }}>💡 {view.hint}</p>}
            <div style={{ display: 'flex', gap: 8 }}>
              <button
                className="btn"
                onClick={() => view.checkpoint && requestHint(view.checkpoint.id)}
              >
                Hint (−20 XP)
              </button>
              {location.source === 'demo' && target && (
                <button className="btn" style={{ flex: 1 }} onClick={() => location.walkTo(target)}>
                  ▶ Walk there
                </button>
              )}
              {location.source !== 'demo' && (
                <button className="btn" style={{ flex: 1 }} onClick={() => location.enableDemoMode()}>
                  Demo Mode
                </button>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
