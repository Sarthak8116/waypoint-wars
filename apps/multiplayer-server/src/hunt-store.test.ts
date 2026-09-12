/**
 * The store, and the public projection that `GET /api/hunt` serves.
 *
 * The projection test is a privacy test, not a serialisation test: if
 * `acceptedAnswers` or `historicalReveal` ever reach this endpoint, the answers
 * are in the network tab and the game is over (DECISIONS.md D8).
 */

import { describe, expect, it, beforeEach } from 'vitest';
import { HuntStore, readHuntBundle } from './hunt-store.js';
import { seed } from './seed.js';

const bundle = readHuntBundle();

describe('HuntStore', () => {
  let store: HuntStore;

  beforeEach(() => {
    store = new HuntStore();
    store.load(bundle);
  });

  it('loads the curated Pittsburgh content', () => {
    expect(store.getHunt()?.id).toBe('hunt_three_rivers_run');
    expect(store.counts.routes).toBe(3);
    expect(store.counts.checkpoints).toBe(13);
  });

  it('is idempotent: seeding repeatedly changes nothing', () => {
    const before = store.counts;
    seed({ bundle, store });
    seed({ bundle, store });
    seed({ bundle, store });
    expect(store.counts).toEqual(before);
    expect(store.getRoute('route_confluence')?.checkpointIds).toHaveLength(5);
  });

  it('resolves every route to full checkpoints ending at the shared finish', () => {
    const hunt = store.getHunt();
    if (!hunt) throw new Error('no hunt');
    for (const routeId of hunt.routeIds) {
      const checkpoints = store.checkpointsForRoute(routeId);
      expect(checkpoints).toHaveLength(5);
      expect(checkpoints.at(-1)?.id).toBe('final_point_fountain');
      for (const checkpoint of checkpoints) {
        expect(checkpoint.acceptedAnswers.length).toBeGreaterThan(0);
      }
    }
  });
});

describe('toPublicBundle', () => {
  const store = new HuntStore();
  store.load(bundle);
  const publicBundle = store.toPublicBundle();

  it('exposes the content a map needs', () => {
    if (!publicBundle) throw new Error('no bundle');
    expect(publicBundle.routes).toHaveLength(3);
    expect(publicBundle.checkpoints).toHaveLength(13);
    expect(publicBundle.hunt.finalDestinationId).toBe('final_point_fountain');
    for (const checkpoint of publicBundle.checkpoints) {
      expect(typeof checkpoint.clue).toBe('string');
      expect(typeof checkpoint.radiusMeters).toBe('number');
    }
  });

  it('strips every field a hunting player must not see', () => {
    if (!publicBundle) throw new Error('no bundle');
    for (const checkpoint of publicBundle.checkpoints) {
      expect(checkpoint).not.toHaveProperty('acceptedAnswers');
      expect(checkpoint).not.toHaveProperty('hint');
      expect(checkpoint).not.toHaveProperty('hints');
      expect(checkpoint).not.toHaveProperty('historicalReveal');
      expect(checkpoint).not.toHaveProperty('hiddenDetail');
      expect(checkpoint).not.toHaveProperty('sources');
      expect(checkpoint).not.toHaveProperty('name');
    }
  });

  it('contains none of the real answers anywhere in its serialised form', () => {
    if (!publicBundle) throw new Error('no bundle');
    const serialised = JSON.stringify(publicBundle).toLowerCase();
    for (const checkpoint of bundle.checkpoints) {
      // The reveal is the earned payload: it must not ship with the map.
      expect(serialised).not.toContain(checkpoint.historicalReveal.slice(0, 40).toLowerCase());
      expect(serialised).not.toContain(checkpoint.hint.slice(0, 30).toLowerCase());
    }
  });
});
