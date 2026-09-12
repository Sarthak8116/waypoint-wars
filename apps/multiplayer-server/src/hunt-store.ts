/**
 * In-memory hunt content store.
 *
 * P8 makes persistence pluggable; per DECISIONS.md D3 the in-memory adapter is
 * the default and the one the demo runs on. This module is that adapter, scoped
 * to the content the room needs: hunts, routes and checkpoints.
 *
 * SERVER ONLY. It holds the FULL `Checkpoint` shape — accepted answers, hint
 * text and historical reveals included. Nothing here may be handed to a browser
 * without going through `toPublicBundle()` / `toPublicCheckpoint()`.
 */

import { readFileSync } from 'node:fs';
import {
  toPublicCheckpoint,
  type Checkpoint,
  type Hunt,
  type PublicCheckpoint,
  type Route,
} from '@ww/shared';

/** The shape of `data/pittsburgh-hunts.json`. */
export interface HuntBundle {
  hunt: Hunt;
  routes: Route[];
  checkpoints: Checkpoint[];
}

/** Route metadata safe to hand a browser: ids and shape, never clue content. */
export interface PublicRoute {
  id: string;
  huntId: string;
  label: string;
  checkpointIds: string[];
  approxDistanceMeters: number;
  approxDurationSeconds: number;
}

/**
 * What `GET /api/hunt` returns.
 *
 * Derived exclusively through `toPublicCheckpoint`, so `acceptedAnswers`,
 * `hint`, `hints`, `historicalReveal`, `hiddenDetail` and `sources` cannot leak
 * by someone adding a field to `Checkpoint` later — the public type is a `Pick`,
 * so a new secret field is excluded by default rather than included by default.
 */
export interface PublicHuntBundle {
  hunt: {
    id: string;
    title: string;
    city: string;
    theme: Hunt['theme'];
    duration: Hunt['duration'];
    description: string;
    routeIds: string[];
    published: boolean;
    finalDestinationId: string;
  };
  routes: PublicRoute[];
  checkpoints: PublicCheckpoint[];
}

export class HuntStore {
  private readonly hunts = new Map<string, Hunt>();
  private readonly routes = new Map<string, Route>();
  private readonly checkpoints = new Map<string, Checkpoint>();

  /**
   * Idempotent by construction: everything is keyed by id and overwritten, so
   * loading the same bundle twice (a re-seed, a hot reload, a test calling
   * `seed()` in `beforeEach`) leaves the store in the identical state and never
   * duplicates a route or a checkpoint.
   */
  load(bundle: HuntBundle): void {
    this.hunts.set(bundle.hunt.id, bundle.hunt);
    for (const route of bundle.routes) this.routes.set(route.id, route);
    for (const checkpoint of bundle.checkpoints) this.checkpoints.set(checkpoint.id, checkpoint);
    // The final destination lives on the hunt as well as (usually) in the
    // checkpoint list. Index it either way so a route can always resolve it.
    const finish = bundle.hunt.finalDestination;
    if (finish) this.checkpoints.set(finish.id, finish);
  }

  clear(): void {
    this.hunts.clear();
    this.routes.clear();
    this.checkpoints.clear();
  }

  get counts(): { hunts: number; routes: number; checkpoints: number } {
    return {
      hunts: this.hunts.size,
      routes: this.routes.size,
      checkpoints: this.checkpoints.size,
    };
  }

  get isEmpty(): boolean {
    return this.hunts.size === 0;
  }

  /** With no id, returns the only hunt loaded — the demo has exactly one. */
  getHunt(huntId?: string): Hunt | undefined {
    if (huntId) return this.hunts.get(huntId);
    const [first] = this.hunts.values();
    return first;
  }

  getRoute(routeId: string): Route | undefined {
    return this.routes.get(routeId);
  }

  getCheckpoint(checkpointId: string): Checkpoint | undefined {
    return this.checkpoints.get(checkpointId);
  }

  routesForHunt(huntId: string): Route[] {
    const hunt = this.hunts.get(huntId);
    if (!hunt) return [];
    // Ordered by the hunt's own `routeIds` so assignment is reproducible from
    // the seed alone and does not depend on Map insertion order.
    return hunt.routeIds
      .map((id) => this.routes.get(id))
      .filter((route): route is Route => route !== undefined);
  }

  /** Every checkpoint on a route, in order. Server-side full shape. */
  checkpointsForRoute(routeId: string): Checkpoint[] {
    const route = this.routes.get(routeId);
    if (!route) return [];
    return route.checkpointIds
      .map((id) => this.checkpoints.get(id))
      .filter((cp): cp is Checkpoint => cp !== undefined);
  }

  toPublicBundle(huntId?: string): PublicHuntBundle | undefined {
    const hunt = this.getHunt(huntId);
    if (!hunt) return undefined;
    const routes = this.routesForHunt(hunt.id);
    const ids = new Set<string>();
    for (const route of routes) for (const id of route.checkpointIds) ids.add(id);

    return {
      hunt: {
        id: hunt.id,
        title: hunt.title,
        city: hunt.city,
        theme: hunt.theme,
        duration: hunt.duration,
        description: hunt.description,
        routeIds: [...hunt.routeIds],
        published: hunt.published,
        finalDestinationId: hunt.finalDestination.id,
      },
      routes: routes.map((route) => ({
        id: route.id,
        huntId: route.huntId,
        label: route.label,
        checkpointIds: [...route.checkpointIds],
        approxDistanceMeters: route.approxDistanceMeters,
        approxDurationSeconds: route.approxDurationSeconds,
      })),
      checkpoints: [...ids]
        .map((id) => this.checkpoints.get(id))
        .filter((cp): cp is Checkpoint => cp !== undefined)
        .map(toPublicCheckpoint),
    };
  }
}

/** The process-wide store. One hunt, loaded at boot by `seed()`. */
export const huntStore = new HuntStore();

/** Default location of the curated content, relative to this file. */
export const DEFAULT_HUNT_DATA_URL = new URL(
  '../../../data/pittsburgh-hunts.json',
  import.meta.url,
);

export function readHuntBundle(path?: string): HuntBundle {
  const source = path ?? process.env['HUNT_DATA_PATH'] ?? DEFAULT_HUNT_DATA_URL;
  const raw = readFileSync(source, 'utf8');
  const parsed = JSON.parse(raw) as HuntBundle;
  assertBundleShape(parsed);
  return parsed;
}

/**
 * A shape check, not a content validator — `data/validate.ts` owns the real
 * content rules. This exists so a truncated or wrong-file read fails at boot
 * with a clear message instead of at the first player's first submission.
 */
function assertBundleShape(bundle: HuntBundle): void {
  if (!bundle?.hunt?.id) throw new Error('Hunt bundle is missing `hunt.id`.');
  if (!Array.isArray(bundle.routes) || bundle.routes.length === 0) {
    throw new Error('Hunt bundle has no routes.');
  }
  if (!Array.isArray(bundle.checkpoints) || bundle.checkpoints.length === 0) {
    throw new Error('Hunt bundle has no checkpoints.');
  }
  if (!bundle.hunt.finalDestination?.id) {
    throw new Error('Hunt bundle is missing `hunt.finalDestination`.');
  }
}
