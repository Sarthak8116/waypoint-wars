/**
 * MongoDB Atlas repository.
 *
 * Used only when MONGODB_URI is set. This is real code rather than a stub —
 * the collections, the 2dsphere index and the geospatial query are what the
 * Atlas integration actually needs — but note it is UNEXERCISED: with no URI
 * available during the build, nothing here has run against a live cluster.
 * Treat the first connection as untested, the same way the Gemini path was.
 *
 * Collections: hunts, routes, checkpoints, completed_runs, submissions,
 * historical_sources (the last two are written by the room, not here).
 */

import type { Collection, Db, MongoClient as MongoClientType } from 'mongodb';
import type { Checkpoint, CompletedRun, Hunt, Route } from '@ww/shared';
import type { HuntBundle, HuntRepository } from './repository.js';

/** A checkpoint as stored, with GeoJSON alongside the flat lat/lng. */
interface StoredCheckpoint extends Checkpoint {
  /** GeoJSON Point, [longitude, latitude] — the order 2dsphere requires. */
  location: { type: 'Point'; coordinates: [number, number] };
  huntId: string;
}

export class MongoRepository implements HuntRepository {
  readonly kind = 'mongo' as const;

  private constructor(
    private readonly client: MongoClientType,
    private readonly db: Db,
  ) {}

  static async connect(uri: string, dbName = 'waypoint_wars'): Promise<MongoRepository> {
    // Imported lazily so the package is optional: a deployment without Mongo
    // never pays to load the driver, and a missing module cannot crash boot.
    const { MongoClient } = await import('mongodb');
    const client = new MongoClient(uri, { serverSelectionTimeoutMS: 8000 });
    await client.connect();

    const repo = new MongoRepository(client, client.db(dbName));
    await repo.ensureIndexes();
    return repo;
  }

  private get hunts(): Collection<Hunt & { _id?: unknown }> {
    return this.db.collection('hunts');
  }
  private get routes(): Collection<Route & { _id?: unknown }> {
    return this.db.collection('routes');
  }
  private get checkpoints(): Collection<StoredCheckpoint & { _id?: unknown }> {
    return this.db.collection('checkpoints');
  }
  private get runs(): Collection<CompletedRun & { _id?: unknown }> {
    return this.db.collection('completed_runs');
  }

  /** Idempotent — createIndex is a no-op when the index already exists. */
  private async ensureIndexes(): Promise<void> {
    await this.checkpoints.createIndex({ location: '2dsphere' });
    await this.checkpoints.createIndex({ id: 1 }, { unique: true });
    await this.hunts.createIndex({ id: 1 }, { unique: true });
    await this.routes.createIndex({ id: 1 }, { unique: true });
    await this.runs.createIndex({ huntId: 1, totalXp: -1 });
  }

  async saveHuntBundle(bundle: HuntBundle): Promise<void> {
    await this.hunts.replaceOne({ id: bundle.hunt.id }, bundle.hunt, { upsert: true });

    await Promise.all(
      bundle.routes.map((r) => this.routes.replaceOne({ id: r.id }, r, { upsert: true })),
    );

    await Promise.all(
      bundle.checkpoints.map((c) =>
        this.checkpoints.replaceOne(
          { id: c.id },
          {
            ...c,
            huntId: bundle.hunt.id,
            location: { type: 'Point', coordinates: [c.longitude, c.latitude] },
          },
          { upsert: true },
        ),
      ),
    );
  }

  async getHuntBundle(huntId: string): Promise<HuntBundle | null> {
    const hunt = await this.hunts.findOne({ id: huntId }, { projection: { _id: 0 } });
    if (!hunt) return null;

    const routes = await this.routes
      .find({ huntId }, { projection: { _id: 0 } })
      .toArray();
    const checkpoints = await this.checkpoints
      .find({ huntId }, { projection: { _id: 0, location: 0, huntId: 0 } })
      .toArray();

    return { hunt, routes, checkpoints: checkpoints as unknown as Checkpoint[] };
  }

  async listHunts() {
    return this.hunts
      .find({}, { projection: { _id: 0, id: 1, title: 1, city: 1, published: 1 } })
      .toArray() as Promise<Array<Pick<Hunt, 'id' | 'title' | 'city' | 'published'>>>;
  }

  async saveCompletedRun(run: CompletedRun): Promise<void> {
    await this.runs.replaceOne({ id: run.id }, run, { upsert: true });
  }

  async listCompletedRuns(huntId: string, limit = 50): Promise<CompletedRun[]> {
    return this.runs
      .find({ huntId }, { projection: { _id: 0 } })
      .sort({ totalXp: -1 })
      .limit(limit)
      .toArray();
  }

  /** The reason the 2dsphere index exists. */
  async findNearbyCheckpoints(
    latitude: number,
    longitude: number,
    radiusMeters: number,
  ): Promise<Checkpoint[]> {
    const docs = await this.checkpoints
      .find(
        {
          location: {
            $near: {
              $geometry: { type: 'Point', coordinates: [longitude, latitude] },
              $maxDistance: radiusMeters,
            },
          },
        },
        { projection: { _id: 0, location: 0, huntId: 0 } },
      )
      .toArray();
    return docs as unknown as Checkpoint[];
  }

  async close(): Promise<void> {
    await this.client.close();
  }
}
