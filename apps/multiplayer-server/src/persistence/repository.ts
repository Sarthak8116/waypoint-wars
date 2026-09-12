/**
 * Persistence boundary.
 *
 * Three implementations behind one interface:
 *   - MemoryRepository  — always present, used by tests
 *   - FileRepository    — the DEFAULT. Survives a restart with no database.
 *   - MongoRepository   — real Atlas code with a 2dsphere index, used when
 *                         MONGODB_URI is set.
 *
 * The file-backed default matters for the demo: a hunt published from the
 * creator dashboard should still be there after a server restart, and asking
 * someone to provision Atlas before they can save a checkpoint is a bad
 * trade for a hackathon MVP.
 *
 * Live player locations are deliberately NOT persisted here — they live in the
 * Colyseus room and only the completed path is written, once, at finish.
 */

import type { Checkpoint, CompletedRun, Hunt, Route } from '@ww/shared';

export interface HuntBundle {
  hunt: Hunt;
  routes: Route[];
  checkpoints: Checkpoint[];
}

export interface HuntRepository {
  /** Human-readable backend name, surfaced on /health. */
  readonly kind: 'memory' | 'file' | 'mongo';

  saveHuntBundle(bundle: HuntBundle): Promise<void>;
  getHuntBundle(huntId: string): Promise<HuntBundle | null>;
  listHunts(): Promise<Array<Pick<Hunt, 'id' | 'title' | 'city' | 'published'>>>;

  saveCompletedRun(run: CompletedRun): Promise<void>;
  listCompletedRuns(huntId: string, limit?: number): Promise<CompletedRun[]>;

  /**
   * Checkpoints within `radiusMeters` of a point. Backed by a 2dsphere index
   * on Mongo; a linear scan elsewhere, which is fine at MVP scale (13 rows).
   */
  findNearbyCheckpoints(
    latitude: number,
    longitude: number,
    radiusMeters: number,
  ): Promise<Checkpoint[]>;

  close(): Promise<void>;
}

/** Shape validation for anything arriving from the creator dashboard. */
export function validateHuntBundle(input: unknown): { ok: true; bundle: HuntBundle } | { ok: false; errors: string[] } {
  const errors: string[] = [];
  const b = input as Partial<HuntBundle>;

  if (!b || typeof b !== 'object') return { ok: false, errors: ['body is not an object'] };
  if (!b.hunt || typeof b.hunt.id !== 'string' || !b.hunt.id) errors.push('hunt.id is required');
  if (!Array.isArray(b.routes) || b.routes.length === 0) errors.push('routes must be a non-empty array');
  if (!Array.isArray(b.checkpoints) || b.checkpoints.length === 0) {
    errors.push('checkpoints must be a non-empty array');
  }

  if (errors.length) return { ok: false, errors };

  const bundle = b as HuntBundle;
  const ids = new Set(bundle.checkpoints.map((c) => c.id));

  for (const route of bundle.routes) {
    if (!route.id) errors.push('every route needs an id');
    if (!Array.isArray(route.checkpointIds) || route.checkpointIds.length === 0) {
      errors.push(`route ${route.id} has no checkpoints`);
      continue;
    }
    for (const id of route.checkpointIds) {
      if (!ids.has(id)) errors.push(`route ${route.id} references unknown checkpoint "${id}"`);
    }
  }

  // The engine infers the shared finish as the LAST id and throws at route
  // assignment if routes disagree — catch it at the door instead of at runtime
  // in front of an audience.
  const finishes = new Set(bundle.routes.map((r) => r.checkpointIds.at(-1)));
  if (finishes.size > 1) {
    errors.push(`routes must all end at the same checkpoint (found: ${[...finishes].join(', ')})`);
  }

  const lengths = new Set(bundle.routes.map((r) => r.checkpointIds.length));
  if (lengths.size > 1) {
    errors.push(`routes must have equal checkpoint counts (found: ${[...lengths].join(', ')})`);
  }

  for (const c of bundle.checkpoints) {
    if (typeof c.latitude !== 'number' || typeof c.longitude !== 'number') {
      errors.push(`checkpoint ${c.id} has invalid coordinates`);
    }
    if (!c.acceptedAnswers?.length) errors.push(`checkpoint ${c.id} has no acceptedAnswers`);
  }

  return errors.length ? { ok: false, errors } : { ok: true, bundle };
}
