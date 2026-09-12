/**
 * Route assignment at hunt start.
 *
 * The whole premise of Waypoint Wars is that players walk DIFFERENT routes and
 * still arrive at the SAME place, so the end screen can compare what each of
 * them discovered. Both halves of that promise are enforced here:
 *
 *   1. Distinct routes are handed out until the pool is exhausted, and only
 *      then do routes repeat (evenly, never all-on-one).
 *   2. Every candidate route must end at the same checkpoint. If the content
 *      violates that, we throw at assignment time rather than discovering it
 *      when two players finish on opposite sides of Downtown.
 *
 * Assignment is deterministic for a given seed so the demo, the tests and a
 * server restart mid-lobby all produce the same allocation.
 */

import type { Route } from '@ww/shared';
import { createRng, shuffle } from './random.js';

export interface RouteAssignment {
  participantId: string;
  routeId: string;
}

/** Thrown when candidate routes do not converge on one final destination. */
export class RouteDestinationMismatchError extends Error {
  readonly destinations: ReadonlyMap<string, string>;

  constructor(destinations: ReadonlyMap<string, string>) {
    const detail = [...destinations.entries()]
      .map(([routeId, destination]) => `${routeId} -> ${destination}`)
      .join(', ');
    super(
      `All routes in a hunt must end at the same final destination, but they do not: ${detail}`,
    );
    this.name = 'RouteDestinationMismatchError';
    this.destinations = destinations;
  }
}

/** The shared finish line is, by construction, the last checkpoint of a route. */
export function finalDestinationId(route: Route): string {
  const ids = route.checkpointIds;
  const last = ids.length > 0 ? ids[ids.length - 1] : undefined;
  if (last === undefined || last === '') {
    throw new Error(`Route "${route.id}" has no checkpoints, so it has no final destination.`);
  }
  return last;
}

/**
 * Throws unless every route ends at the same checkpoint id.
 * Returns that shared destination id.
 */
export function assertSharedDestination(routes: readonly Route[]): string {
  if (routes.length === 0) throw new Error('Cannot validate destinations: no routes supplied.');

  const destinations = new Map<string, string>();
  for (const route of routes) destinations.set(route.id, finalDestinationId(route));

  const unique = new Set(destinations.values());
  if (unique.size > 1) throw new RouteDestinationMismatchError(destinations);

  const [shared] = unique;
  return shared as string;
}

/**
 * Assign one route per participant.
 *
 * Participants are served in the order given; the ROUTE pool is shuffled
 * (seeded) and dealt out. If there are more participants than routes the pool
 * is reshuffled and dealt again, so load stays even: with 3 routes and 7
 * players the counts are 3/2/2, never 5/1/1.
 */
export function assignRoutes(
  participantIds: readonly string[],
  routes: readonly Route[],
  seed: number | string,
): RouteAssignment[] {
  if (participantIds.length === 0) return [];
  if (routes.length === 0) throw new Error('Cannot assign routes: no routes supplied.');

  assertSharedDestination(routes);

  const rng = createRng(seed);
  const assignments: RouteAssignment[] = [];
  let pool: Route[] = [];

  for (const participantId of participantIds) {
    if (pool.length === 0) pool = shuffle(routes, rng);
    const route = pool.shift() as Route;
    assignments.push({ participantId, routeId: route.id });
  }

  return assignments;
}

/** Convenience lookup for callers that want a map instead of a list. */
export function toAssignmentMap(assignments: readonly RouteAssignment[]): Map<string, string> {
  return new Map(assignments.map((a) => [a.participantId, a.routeId]));
}
