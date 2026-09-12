import { describe, expect, it } from 'vitest';
import { pickGatheringPoint } from './generate.js';
import type { Place } from './places.js';

const CENTRE = { displayName: 'Charleston, South Carolina', latitude: 32.78, longitude: -79.93 };

function place(id: string, name: string, tags: Record<string, string>, distanceMeters = 200): Place {
  return {
    id,
    name,
    latitude: 32.78,
    longitude: -79.93,
    kind: Object.values(tags)[0] ?? 'thing',
    tags,
    distanceMeters,
    score: 5,
  };
}

describe('pickGatheringPoint', () => {
  it('prefers a public square over a park', () => {
    const got = pickGatheringPoint(
      [place('a', 'Riverside Park', { leisure: 'park' }), place('b', 'Chippewa Square', { place: 'square' })],
      new Set(),
      CENTRE,
    );
    expect(got.name).toBe('Chippewa Square');
    expect(got.instructions).toContain('Chippewa Square');
  });

  it('never announces a place that is also a checkpoint', () => {
    // The gathering point is named up front, so reusing a stop would hand
    // every player a free clue.
    const square = place('b', 'Chippewa Square', { place: 'square' });
    const got = pickGatheringPoint(
      [square, place('c', 'Deering Oaks Park', { leisure: 'park' })],
      new Set(['b']),
      CENTRE,
    );
    expect(got.name).toBe('Deering Oaks Park');
  });

  it('rejects landmarks that are not places to gather', () => {
    // Charleston really did pick this before the criteria were tightened.
    const got = pickGatheringPoint(
      [
        place('a', 'Model of the Civil War Submarine, H.L. Hunley', { historic: 'memorial' }),
        place('b', 'Powder Magazine', { tourism: 'attraction' }),
      ],
      new Set(),
      CENTRE,
    );
    expect(got.name).toBe('Charleston');
    expect(got.instructions).toMatch(/agree on an exact spot/i);
  });

  it('says so honestly when nothing qualifies', () => {
    const got = pickGatheringPoint([], new Set(), CENTRE);
    expect(got.name).toBe('Charleston');
    expect(got.latitude).toBe(CENTRE.latitude);
    expect(got.instructions).not.toMatch(/Meet at/);
  });

  it('prefers a central square to a distant one', () => {
    // Everyone walks out from here; an edge start skews one route long.
    const got = pickGatheringPoint(
      [
        place('far', 'Far Square', { place: 'square' }, 4000),
        place('near', 'Near Square', { place: 'square' }, 150),
      ],
      new Set(),
      CENTRE,
    );
    expect(got.name).toBe('Near Square');
  });
});
