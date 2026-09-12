/**
 * Load the curated Pittsburgh content into the in-memory store.
 *
 * Idempotent (DECISIONS.md D3 / PLAN.md P8): every entity is keyed by id and
 * overwritten, so running this twice — at boot and again from the CLI, or in
 * every test's `beforeEach` — leaves exactly the same store. Nothing is
 * appended, so nothing can be duplicated.
 *
 * Run standalone with `pnpm --filter @ww/multiplayer-server seed`.
 */

import { huntStore, readHuntBundle, type HuntBundle, type HuntStore } from './hunt-store.js';

export interface SeedOptions {
  /** Overrides `HUNT_DATA_PATH` and the default bundle location. */
  path?: string;
  /** Supply the bundle directly (tests, fixtures) instead of reading a file. */
  bundle?: HuntBundle;
  /** Defaults to the process-wide `huntStore`. */
  store?: HuntStore;
  logger?: Pick<Console, 'log'>;
}

export interface SeedResult {
  huntId: string;
  routes: number;
  checkpoints: number;
}

export function seed(options: SeedOptions = {}): SeedResult {
  const store = options.store ?? huntStore;
  const bundle = options.bundle ?? readHuntBundle(options.path);

  store.load(bundle);

  const counts = store.counts;
  options.logger?.log(
    `[seed] loaded "${bundle.hunt.title}" (${bundle.hunt.id}): ` +
      `${counts.routes} routes, ${counts.checkpoints} checkpoints (in-memory).`,
  );

  return { huntId: bundle.hunt.id, routes: counts.routes, checkpoints: counts.checkpoints };
}

/** Seed only if nothing is loaded yet. Used on the server boot path. */
export function ensureSeeded(options: SeedOptions = {}): SeedResult | null {
  const store = options.store ?? huntStore;
  if (!store.isEmpty) return null;
  return seed(options);
}

// --- CLI ------------------------------------------------------------------
// `process.argv[1]` is the entry script; compare against this module's own
// path so importing `seed.ts` never triggers the CLI side effect.
const invokedDirectly =
  process.argv[1] !== undefined &&
  import.meta.url === new URL(`file://${process.argv[1]}`).href;

if (invokedDirectly) {
  seed({ logger: console });
}
