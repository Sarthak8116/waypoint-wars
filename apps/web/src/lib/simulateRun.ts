/**
 * Generate a plausible completed run for Demo Mode.
 *
 * This exists so the full experience — different routes, real XP maths,
 * converging finish, replay — can be shown indoors in three minutes without
 * anyone walking across Downtown Pittsburgh.
 *
 * IMPORTANT: the XP is NOT invented. Every number comes from the real
 * `scoreCheckpoint` in @ww/hunt-engine using the real checkpoint content, so
 * what a judge sees on the leaderboard is what the live game would have
 * produced for the same timings. Only the walking is fake.
 */

import { scoreCheckpoint } from '@ww/hunt-engine';
import { lerpLatLng, type Checkpoint, type LatLng } from '@ww/shared';

export interface SimulatedCheckpoint {
  position: LatLng;
  name: string;
  atMs: number;
  xpAwarded: number;
  hintUsed: boolean;
  reveal: string;
}

export interface SimulatedRun {
  path: Array<LatLng & { atMs: number }>;
  checkpoints: SimulatedCheckpoint[];
  totalXp: number;
  durationMs: number;
  hintsUsed: number;
}

export interface SimulateOptions {
  /** Deterministic per player, so a rehearsed demo replays identically. */
  seed: number;
  /**
   * Where everyone gathers before splitting up. All players walk out from
   * this single point, which is the shape of the real game and makes the
   * "same start, different routes, same finish" story legible on the map.
   */
  start?: LatLng;
  /**
   * How this player performs against the content's expected times.
   * 1.0 = exactly on pace, 0.8 = 20% faster, 1.25 = 25% slower.
   */
  pace: number;
  /** Indices into the route at which this player takes a hint. */
  hintAt?: number[];
  /** Indices at which this player submits a wrong answer first. */
  missAt?: number[];
}

/** Small deterministic PRNG so runs are reproducible across machines. */
function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 0x1_0000_0000;
  };
}

/**
 * Sample cadence for the REPLAY path.
 *
 * The live game records a breadcrumb every 12s, which is the right rate for
 * storage and completely wrong for animation: at that spacing the replay
 * interpolates between distant points and the dot visibly snaps corner to
 * corner. 2s gives a path smooth enough to read as walking.
 */
const SAMPLE_MS = 2_000;

/**
 * How far a leg bows off the straight line, as a fraction of its length.
 *
 * Real walking follows streets, so a perfectly straight line between two
 * landmarks looks synthetic. A single consistent arc per leg reads as a route;
 * the previous random per-sample jitter just looked like GPS noise.
 */
const ARC_FRACTION = 0.13;

export function simulateRun(checkpoints: Checkpoint[], opts: SimulateOptions): SimulatedRun {
  const rand = rng(opts.seed);
  const hintAt = new Set(opts.hintAt ?? []);
  const missAt = new Set(opts.missAt ?? []);

  const path: Array<LatLng & { atMs: number }> = [];
  const events: SimulatedCheckpoint[] = [];

  let clock = 0;
  let totalXp = 0;
  let hintsUsed = 0;

  const first = checkpoints[0];
  if (!first) return { path, checkpoints: events, totalXp: 0, durationMs: 0, hintsUsed: 0 };

  // EVERYONE STARTS IN THE SAME PLACE. Without a supplied start the players
  // would each begin beside their own first checkpoint, which hides the whole
  // "gather, split, converge" shape the product is built around.
  let from: LatLng = opts.start ?? {
    latitude: first.latitude - 0.002,
    longitude: first.longitude - 0.0014,
  };
  path.push({ ...from, atMs: 0 });

  checkpoints.forEach((cp, index) => {
    const to: LatLng = { latitude: cp.latitude, longitude: cp.longitude };

    // Vary each leg slightly so the three routes aren't mechanically identical.
    const legMs = cp.expectedCompletionSeconds * 1000 * opts.pace * (0.9 + rand() * 0.2);
    const steps = Math.max(6, Math.round(legMs / SAMPLE_MS));

    /**
     * Bow the leg into a single smooth arc, side chosen once per leg.
     *
     * The offset peaks at the midpoint and falls to zero at both ends, so the
     * dot arrives exactly on the checkpoint. Perpendicular to the direction of
     * travel, so it reads as going around a block rather than wandering.
     */
    const side = rand() < 0.5 ? -1 : 1;
    const dLat = to.latitude - from.latitude;
    const dLng = to.longitude - from.longitude;
    const perpLat = -dLng;
    const perpLng = dLat;
    const bow = side * ARC_FRACTION * (0.6 + rand() * 0.8);

    for (let s = 1; s <= steps; s++) {
      const t = s / steps;
      const pos = lerpLatLng(from, to, t);
      // sin gives a clean 0 -> peak -> 0 curve across the leg.
      const swell = Math.sin(t * Math.PI) * bow;
      path.push({
        latitude: pos.latitude + perpLat * swell,
        longitude: pos.longitude + perpLng * swell,
        atMs: Math.round(clock + legMs * t),
      });
    }

    clock += legMs;

    const hintUsed = hintAt.has(index);
    if (hintUsed) hintsUsed += 1;
    const incorrectAttempts = missAt.has(index) ? 1 : 0;

    // A wrong answer costs real time, not just XP.
    if (incorrectAttempts > 0) clock += 45_000;

    const actualSeconds = (legMs + incorrectAttempts * 45_000) / 1000;

    const breakdown = scoreCheckpoint({
      baseXp: cp.baseXp,
      expectedCompletionSeconds: cp.expectedCompletionSeconds,
      actualSeconds,
      completed: true,
      answerCorrect: true,
      hintUsed,
      incorrectAttempts,
      isFinalCheckpoint: index === checkpoints.length - 1,
    });

    totalXp += breakdown.total;

    events.push({
      position: to,
      name: cp.name,
      atMs: Math.round(clock),
      xpAwarded: breakdown.total,
      hintUsed,
      reveal: cp.historicalReveal,
    });

    from = to;
  });

  return {
    path,
    checkpoints: events,
    totalXp,
    durationMs: Math.round(clock),
    hintsUsed,
  };
}
