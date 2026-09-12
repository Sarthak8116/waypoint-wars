import { describe, it, expect } from 'vitest';
import type { Route } from '@ww/shared';
import {
  RouteDestinationMismatchError,
  assertSharedDestination,
  assignRoutes,
  finalDestinationId,
  toAssignmentMap,
} from './route-assignment.js';

const FINISH = 'cp-point-state-park-fountain';

const makeRoute = (id: string, middle: string[], finish = FINISH): Route => ({
  id,
  huntId: 'hunt-downtown-pgh',
  label: `Route ${id}`,
  checkpointIds: [...middle, finish],
  approxDistanceMeters: 2000,
  approxDurationSeconds: 2400,
});

const ROUTES: Route[] = [
  makeRoute('route-a', ['cp-a1', 'cp-a2', 'cp-a3']),
  makeRoute('route-b', ['cp-b1', 'cp-b2', 'cp-b3']),
  makeRoute('route-c', ['cp-c1', 'cp-c2', 'cp-c3']),
];

describe('shared destination validation', () => {
  it('reads the final destination off the end of the route', () => {
    expect(finalDestinationId(ROUTES[0] as Route)).toBe(FINISH);
    expect(assertSharedDestination(ROUTES)).toBe(FINISH);
  });

  it('throws a clear error when routes end in different places', () => {
    const mismatched = [...ROUTES, makeRoute('route-d', ['cp-d1'], 'cp-market-square')];

    expect(() => assignRoutes(['p1'], mismatched, 'seed')).toThrow(RouteDestinationMismatchError);
    expect(() => assignRoutes(['p1'], mismatched, 'seed')).toThrow(/same final destination/i);
    expect(() => assignRoutes(['p1'], mismatched, 'seed')).toThrow(/route-d -> cp-market-square/);
  });

  it('throws when a route has no checkpoints at all', () => {
    const hollow: Route = { ...makeRoute('route-x', []), checkpointIds: [] };
    expect(() => assignRoutes(['p1'], [hollow], 'seed')).toThrow(/no checkpoints/i);
  });

  it('throws when there are no routes to assign', () => {
    expect(() => assignRoutes(['p1'], [], 'seed')).toThrow(/no routes/i);
  });
});

describe('route assignment — distinctness', () => {
  it('gives every participant a distinct route when N <= route count', () => {
    for (const n of [1, 2, 3]) {
      const participants = Array.from({ length: n }, (_, i) => `player-${i}`);
      const assigned = assignRoutes(participants, ROUTES, 'demo-seed');
      const routeIds = assigned.map((a) => a.routeId);
      expect(assigned).toHaveLength(n);
      expect(new Set(routeIds).size).toBe(n);
      expect(assigned.map((a) => a.participantId)).toEqual(participants);
    }
  });

  it('only repeats a route once every route is taken, and repeats evenly', () => {
    const participants = Array.from({ length: 7 }, (_, i) => `player-${i}`);
    const assigned = assignRoutes(participants, ROUTES, 'demo-seed');

    // The first three exhaust the pool before any repeat happens.
    expect(new Set(assigned.slice(0, 3).map((a) => a.routeId)).size).toBe(3);

    const counts = new Map<string, number>();
    for (const a of assigned) counts.set(a.routeId, (counts.get(a.routeId) ?? 0) + 1);
    expect([...counts.values()].sort()).toEqual([2, 2, 3]);
  });

  it('returns an empty assignment for an empty lobby', () => {
    expect(assignRoutes([], ROUTES, 'seed')).toEqual([]);
  });
});

describe('route assignment — determinism', () => {
  it('produces identical assignments for a fixed seed', () => {
    const participants = ['ada', 'grace', 'alan', 'edsger', 'barbara'];
    const first = assignRoutes(participants, ROUTES, 'seed-42');
    const second = assignRoutes(participants, ROUTES, 'seed-42');
    const third = assignRoutes(participants, ROUTES, 42);
    const fourth = assignRoutes(participants, ROUTES, 42);

    expect(second).toEqual(first);
    expect(fourth).toEqual(third);
  });

  it('varies across seeds, so a lobby is not always dealt the same way', () => {
    const participants = ['ada', 'grace', 'alan'];
    const shapes = new Set(
      Array.from({ length: 20 }, (_, i) =>
        assignRoutes(participants, ROUTES, `seed-${i}`)
          .map((a) => a.routeId)
          .join(','),
      ),
    );
    expect(shapes.size).toBeGreaterThan(1);
  });

  it('exposes a lookup map', () => {
    const map = toAssignmentMap(assignRoutes(['ada', 'grace'], ROUTES, 'seed-42'));
    expect(map.size).toBe(2);
    expect(map.get('ada')).toBeDefined();
    expect(map.get('ada')).not.toBe(map.get('grace'));
  });
});
