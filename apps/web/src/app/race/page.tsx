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
import { XP_RULES, HINT_TRUE_COST_XP, haversineMeters, NO_PHOTO_SENTINEL, type LatLng, type LocationSample } from '@ww/shared';
import { GameBridge, type GameHandle } from '@ww/game';
import { useRoom } from '@/lib/RoomProvider';
import { useLocation } from '@/lib/useLocation';
import PhotoCapture from '@/components/PhotoCapture';
import BackButton from '@/components/BackButton';
import ProgressBar from '@/components/ProgressBar';

const HuntMap = dynamic(() => import('@/components/HuntMap'), { ssr: false });

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:2567';

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

  /**
   * Does THIS server accept a photoless Demo Mode submission?
   *
   * Asked rather than assumed. Offering the button where the server would
   * refuse it turns a clearly disabled control into a submission that always
   * fails, which is strictly worse. Defaults to false until /health answers.
   */
  const [photolessAllowed, setPhotolessAllowed] = useState(false);
  useEffect(() => {
    let cancelled = false;
    void fetch(`${API_URL}/health`, { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : null))
      .then((h: { integrations?: Record<string, string> } | null) => {
        if (!cancelled) setPhotolessAllowed(h?.integrations?.photoless === 'enabled');
      })
      .catch(() => {
        // Unreachable server: leave the photo required. Nothing is lost, since
        // a submission could not reach it either.
      });
    return () => {
      cancelled = true;
    };
  }, []);

  /** Demo Mode AND a server that accepts it. Both, or the photo is required. */
  const photoOptional = location.source === 'demo' && photolessAllowed;

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
        // The HUD filters rows by the SERVER's player id, which is what
        // OPPONENT_PROGRESS now carries. selfId is the scoring entity (a team
        // in team-race) and would not match a per-player row.
        selfPlayerId: view.selfPlayerId ?? undefined,
        onHintRequested: () => view.checkpoint && requestHint(view.checkpoint.id),
      });
    });
    return () => {
      cancelled = true;
      handle?.destroy();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** Last total mirrored into the HUD, so awards arrive as a delta. */
  const lastXp = useRef(0);

  // Mirror server-owned values into the HUD. Phaser stores none of them.
  useEffect(() => {
    const delta = view.xp - lastXp.current;
    lastXp.current = view.xp;
    bridgeRef.current?.emit({ type: 'XP_AWARDED', amount: delta, total: view.xp });
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
    if (!view.checkpoint || !location.position) return;
    // Demo Mode has no camera and nothing to photograph. The sentinel tells the
    // server there is deliberately no photo; the server decides whether to
    // accept that, and labels the result unverified either way.
    if (!image && !photoOptional) return;
    setSubmitting(true);
    submitCheckpoint({
      checkpointId: view.checkpoint.id,
      image: image ?? NO_PHOTO_SENTINEL,
      latitude: location.position.latitude,
      longitude: location.position.longitude,
      observationAnswer: answer,
      randomizedInstruction: view.instruction ?? '',
      submittedAt: Date.now(),
    });
  }, [image, answer, view.checkpoint, view.instruction, location.position, photoOptional, submitCheckpoint]);

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
      <main className="wrap stack">
        <div>
          <BackButton label="Home" />
        </div>
        <div>
          <h1 className="display" style={{ fontSize: 40 }}>
            Not in a room
          </h1>
          <p className="muted" style={{ fontSize: 17 }}>
            {view.error ?? 'Join or create a room to race.'}
          </p>
        </div>
        <a className="btn btn-cyan btn-block" href="/lobby">
          Go to the lobby
        </a>
        {/* Never a dead end: the seeded hunt needs no server and no room. */}
        <a className="btn btn-lime btn-block" href="/play?demo=1">
          ▶ Start Pittsburgh demo instead
        </a>
      </main>
    );
  }

  if (view.phase === 'finished') {
    const me = view.leaderboard.find((e) => e.playerId === view.selfId);
    const ordinal = (n: number) =>
      n === 1 ? '1st' : n === 2 ? '2nd' : n === 3 ? '3rd' : `${n}th`;

    // REWARD REGISTER: light surface, full-bleed accent hero. See DESIGN-BRIEF.
    return (
      <main className="wrap stack">
        {me && (
          <div className={`hero ${me.rank === 1 ? 'hero-lime' : 'hero-cyan'}`}>
            <p className="label" style={{ marginBottom: 6 }}>
              {me.rank === 1 ? 'You won' : 'You finished'}
            </p>
            <p className="display" style={{ fontSize: 76, lineHeight: 0.9 }}>
              {ordinal(me.rank)}
            </p>
            <p className="label" style={{ marginTop: 6, marginBottom: 0 }}>
              {me.xp} XP · {me.checkpointsCompleted}/{me.totalCheckpoints} checkpoints
            </p>
          </div>
        )}

        <div>
          <h1 className="display" style={{ fontSize: 34 }}>
            Everyone made it to The Point
          </h1>
          <p className="muted" style={{ fontSize: 17, marginTop: 8 }}>
            Different routes, different discoveries, same finish.
          </p>
        </div>

        <section className="card">
          <p className="label dim" style={{ marginBottom: 12 }}>
            Final standings
          </p>
          {view.leaderboard.map((e, i) => (
            <div
              key={e.playerId}
              style={{
                display: 'flex',
                gap: 12,
                alignItems: 'center',
                padding: '12px 0',
                borderTop: i === 0 ? 'none' : '2px solid var(--border)',
              }}
            >
              <span
                className="mono"
                style={{
                  fontWeight: 900,
                  width: 30,
                  fontSize: 20,
                  color: e.rank === 1 ? 'var(--yellow)' : 'var(--dim)',
                }}
              >
                {e.rank}
              </span>
              <span style={{ flex: 1, fontWeight: 800 }}>
                {e.displayName}
                {e.playerId === view.selfId && (
                  <span className="dim" style={{ fontWeight: 600 }}> · you</span>
                )}
              </span>
              <span className="dim" style={{ fontSize: 13 }}>
                {e.checkpointsCompleted}/{e.totalCheckpoints}
              </span>
              <span style={{ fontWeight: 900, color: 'var(--lime)' }}>{e.xp} XP</span>
            </div>
          ))}
        </section>

        {/* Replay belongs at the end of a run, not on the landing page. */}
        <a className="btn btn-cyan btn-block" href="/demo" style={{ minHeight: 64, fontSize: 19 }}>
          Watch the route replay
        </a>
        <a className="btn btn-ghost btn-block" href="/">
          Back to start
        </a>
      </main>
    );
  }

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

      {/* Other people are racing; leaving is deliberate. */}
      <BackButton
        floating
        label="Leave"
        confirm="Leave the race?"
        onLeave={room.leaveRoom}
      />

      <div ref={hudRef} style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }} />

      <div className="sheet">
        {/* Progress + opponents, always on screen. Opponent data is progress
            only — never a precise location, not even hidden in the payload. */}
        <ProgressBar
          index={view.checkpointIndex}
          total={view.totalCheckpoints}
          xp={view.xp}
          opponents={view.opponents.map((o) => ({
            playerId: o.playerId,
            name: o.name,
            checkpointIndex: o.checkpointIndex,
            totalCheckpoints: o.totalCheckpoints,
          }))}
          notice={location.source === 'demo' ? '▶ Demo Mode' : undefined}
        />

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

            {/* A rejection must always name the way out. */}
            {view.lastMessage && (
              <div className="card" style={{ borderColor: 'var(--pink)', marginTop: 14 }}>
                <p className="label" style={{ color: 'var(--pink)', marginBottom: 8 }}>
                  Not accepted{' '}
                  <span style={{ opacity: 0.75 }}>· {XP_RULES.INCORRECT_PENALTY} XP</span>
                </p>
                <p style={{ margin: '0 0 10px', fontSize: 15 }}>{view.lastMessage}</p>
                <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                  <span className="pill pill-cyan">Retake the photo above</span>
                  {!view.hint && (
                    <button
                      className="btn btn-ghost"
                      style={{ minHeight: 40, fontSize: 14, padding: '0 14px' }}
                      onClick={() => view.checkpoint && requestHint(view.checkpoint.id)}
                    >
                      Need a hint?
                    </button>
                  )}
                </div>
              </div>
            )}
            {view.hint && (
              <p style={{ color: 'var(--yellow)', fontSize: 15 }}>💡 {view.hint}</p>
            )}

            {/* ONE primary action, full width. */}
            <button
              className="btn btn-lime btn-block"
              style={{ marginTop: 16, minHeight: 68, fontSize: 20 }}
              onClick={handleSubmit}
              disabled={!answer.trim() || (!image && !photoOptional) || submitting}
            >
              {submitting
                ? 'Verifying…'
                : !answer.trim()
                  ? photoOptional
                    ? 'Type your answer'
                    : 'Add a photo and an answer'
                  : image
                    ? 'Submit proof'
                    : 'Submit answer only'}
            </button>

            {photoOptional && !image && answer.trim() && (
              <p className="dim" style={{ fontSize: 13, textAlign: 'center', margin: '8px 0 0' }}>
                No photo — scored on the answer alone and marked
                <strong> not verified</strong>.
              </p>
            )}

            {/* One hint per checkpoint: the server rejects a second request
                with HINT_ALREADY_USED, so offering the button again promises
                a charge that never happens and a hint that never arrives. */}
            {!view.lastMessage && !view.hint && (
              <button
                className="btn btn-ghost btn-block"
                style={{ marginTop: 10 }}
                onClick={() => view.checkpoint && requestHint(view.checkpoint.id)}
                disabled={submitting}
              >
                Need a hint? (−{HINT_TRUE_COST_XP} XP)
              </button>
            )}
          </>
        ) : (
          <>
            <p
              data-testid="clue"
              style={{ fontSize: 19, lineHeight: 1.5, fontWeight: 600, margin: '0 0 10px' }}
            >
              {view.checkpoint.clue}
            </p>
            <p className="muted" style={{ fontSize: 14, marginTop: 0 }}>
              {Number.isFinite(distance) ? `${Math.round(distance)} m away` : 'Locating…'}
            </p>
            {view.hint && (
              <p style={{ color: 'var(--yellow)', fontSize: 15 }}>💡 {view.hint}</p>
            )}

            {location.source === 'demo' && target ? (
              <button
                className="btn btn-cyan btn-block"
                style={{ minHeight: 62, fontSize: 19 }}
                onClick={() => location.walkTo(target)}
              >
                ▶ Walk there
              </button>
            ) : (
              /* GPS is the real thing, but a stuck player is never stranded. */
              <button
                className="btn btn-ghost btn-block"
                onClick={() => location.enableDemoMode()}
              >
                Use demo location instead
              </button>
            )}

            {!view.hint && (
              <button
                className="btn btn-ghost btn-block"
                style={{ marginTop: 10 }}
                onClick={() => view.checkpoint && requestHint(view.checkpoint.id)}
              >
                Need a hint? (−{HINT_TRUE_COST_XP} XP)
              </button>
            )}
          </>
        )}
      </div>
    </div>
  );
}
