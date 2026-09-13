/**
 * Dealing and balancing route geography.
 *
 * Pure, and generic over anything carrying coordinates, because BOTH sides
 * need it. The generator balances routes as it builds them; the creator screen
 * needs to balance a hunt it was handed by a server that did not — which today
 * is every server, since the generator fix has not been deployed. A hunt
 * arrives warning "routes differ by 41%" and, until now, with nothing the
 * author could do about it.
 *
 * Lives in the engine rather than the content service so a browser can import
 * it without pulling in a geocoder and a model SDK.
 */

import { haversineMeters } from '@ww/shared';

interface Positioned {
  latitude: number;
  longitude: number;
}

export function routeMeters(stops: Positioned[]): number {
  let total = 0;
  for (let i = 1; i < stops.length; i++) total += haversineMeters(stops[i - 1]!, stops[i]!);
  return Math.round(total);
}

/**
 * Nearest-neighbour ordering, starting from the first stop.
 *
 * Extracted because the balancer and the final assembly MUST agree on it.
 * They used to disagree: the balancer measured the dealt order while the
 * route was re-ordered into a path afterwards, so it spent forty passes
 * optimising a distance nobody walks. Savannah came out 2227m / 1426m /
 * 1098m — a 51% spread — from a balancer that believed it was done.
 */
export function orderPath<T extends Positioned>(stops: T[]): T[] {
  const remaining = [...stops];
  const ordered: T[] = [];
  let current = remaining.shift();
  if (!current) return ordered;
  ordered.push(current);
  while (remaining.length) {
    remaining.sort((a, b) => haversineMeters(current!, a) - haversineMeters(current!, b));
    current = remaining.shift()!;
    ordered.push(current);
  }
  return ordered;
}

export function balanceRoutes<T extends Positioned>(routes: T[][], finish: T): T[][] {
  // Measure what the player actually walks: ordered stops, then the finish.
  const lengthOf = (stops: T[]) => routeMeters([...orderPath(stops), finish]);
  const spread = (rs: T[][]) => {
    const ls = rs.map(lengthOf);
    return Math.max(...ls) - Math.min(...ls);
  };

  const working = routes.map((r) => [...r]);
  if (working.length < 2) return working;

  for (let pass = 0; pass < 40; pass++) {
    const lengths = working.map(lengthOf);
    const longest = lengths.indexOf(Math.max(...lengths));
    const shortest = lengths.indexOf(Math.min(...lengths));
    if (longest === shortest) break;

    const before = spread(working);
    let improved = false;

    // Try swapping each stop of the longest against each of the shortest.
    for (let i = 0; i < working[longest]!.length && !improved; i++) {
      for (let j = 0; j < working[shortest]!.length && !improved; j++) {
        const a = working[longest]![i]!;
        const b = working[shortest]![j]!;
        working[longest]![i] = b;
        working[shortest]![j] = a;

        if (spread(working) < before) improved = true;
        else {
          // revert
          working[longest]![i] = a;
          working[shortest]![j] = b;
        }
      }
    }

    if (!improved) break;
  }

  // Same ordering the balancer measured, so the two cannot drift apart.
  return working.map(orderPath);
}
