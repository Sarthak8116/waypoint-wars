import { describe, expect, it } from 'vitest';
import { balanceRoutes, orderPath, routeMeters } from './generate.js';
import type { Place } from './places.js';

/**
 * The balancer and the final assembly must agree on route ORDER.
 *
 * They did not: the balancer measured the dealt order while each route was
 * re-ordered into a nearest-neighbour path afterwards, so forty passes of
 * optimisation were spent on a distance nobody walks. Live, Savannah came out
 * 2227m / 1426m / 1098m — a 51% spread — from a balancer that thought it was
 * finished. Measuring the ordered path took that to 4%.
 */
function at(id: string, lat: number, lon: number): Place {
  return {
    id,
    name: id,
    latitude: lat,
    longitude: lon,
    kind: 'monument',
    tags: {},
    distanceMeters: 0,
    score: 1,
  };
}

const FINISH = at('finish', 0, 0);
const lengthOf = (stops: Place[]) => routeMeters([...stops, FINISH]);

describe('balanceRoutes', () => {
  it('returns routes already in walked order', () => {
    // If the caller had to re-order afterwards, the balancer's measurements
    // would again describe a route nobody walks.
    const routes = balanceRoutes(
      [
        [at('a', 0.03, 0), at('b', 0.01, 0), at('c', 0.02, 0)],
        [at('d', 0, 0.03), at('e', 0, 0.01), at('f', 0, 0.02)],
      ],
      FINISH,
    );
    for (const route of routes) {
      expect(route).toEqual(orderPath(route));
    }
  });

  it('narrows a lopsided deal', () => {
    // One route handed everything far away, the other everything near.
    const lopsided = [
      [at('a', 0.05, 0), at('b', 0.06, 0), at('c', 0.07, 0)],
      [at('d', 0.001, 0), at('e', 0.002, 0), at('f', 0.003, 0)],
    ];
    const before = lopsided.map(lengthOf);
    const after = balanceRoutes(lopsided.map((r) => [...r]), FINISH).map(lengthOf);

    const spreadOf = (ls: number[]) => (Math.max(...ls) - Math.min(...ls)) / Math.max(...ls);
    expect(spreadOf(after)).toBeLessThan(spreadOf(before));
    expect(spreadOf(after)).toBeLessThan(0.35);
  });

  it('keeps every stop exactly once', () => {
    // Swapping must redistribute, never duplicate or drop.
    const routes = [
      [at('a', 0.05, 0), at('b', 0.06, 0)],
      [at('c', 0.001, 0), at('d', 0.002, 0)],
      [at('e', 0.03, 0), at('f', 0.04, 0)],
    ];
    const ids = balanceRoutes(routes, FINISH)
      .flat()
      .map((p) => p.id)
      .sort();
    expect(ids).toEqual(['a', 'b', 'c', 'd', 'e', 'f']);
  });

  it('leaves a single route alone', () => {
    const only = [[at('a', 0.01, 0), at('b', 0.02, 0)]];
    expect(balanceRoutes(only, FINISH)).toHaveLength(1);
  });
});
