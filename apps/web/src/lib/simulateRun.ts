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

/** Breadcrumb cadence, matching the live game's 12s sampling. */
const SAMPLE_MS = 12_000;

export function simulateRun(checkpoints: Checkpoint[], opts: SimulateOptions): SimulatedRun {
  const rand = rng(opts.seed);
  const hintAt = new Set(opts.hintAt ?? []);
  const missAt = new Set(opts.missAt ?? []);

  const path: Array<LatLng & { atMs: number }> = [];
  const events: SimulatedCheckpoint[] = [];

  let clock = 0;
  let totalXp = 0;
  let hintsUsed = 0;

  // Start a little short of the first checkpoint so there is a visible walk in.
  const first = checkpoints[0];
  if (!first) return { path, checkpoints: events, totalXp: 0, durationMs: 0, hintsUsed: 0 };

  let from: LatLng = {
    latitude: first.latitude - 0.0020 - rand() * 0.0008,
    longitude: first.longitude - 0.0014 - rand() * 0.0008,
  };
  path.push({ ...from, atMs: 0 });

  checkpoints.forEach((cp, index) => {
    const to: LatLng = { latitude: cp.latitude, longitude: cp.longitude };

    // Jitter each leg so the three routes don't look mechanically identical.
    const legMs = cp.expectedCompletionSeconds * 1000 * opts.pace * (0.9 + rand() * 0.2);
    const steps = Math.max(2, Math.round(legMs / SAMPLE_MS));

    for (let s = 1; s <= steps; s++) {
      const t = s / steps;
      const pos = lerpLatLng(from, to, t);
      // Nudge intermediate samples off the straight line so the trail reads
      // like someone following streets rather than a ruler.
      const wobble = s === steps ? 0 : (rand() - 0.5) * 0.00035;
      path.push({
        latitude: pos.latitude + wobble,
        longitude: pos.longitude + wobble * 0.7,
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
