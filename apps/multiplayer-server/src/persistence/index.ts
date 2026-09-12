/**
 * Repository selection. One place decides which backend the server uses.
 */

import { haversineMeters, type Checkpoint, type CompletedRun, type Hunt } from '@ww/shared';
import type { HuntBundle, HuntRepository } from './repository.js';
import { FileRepository, defaultSnapshotPath } from './file-repository.js';

export * from './repository.js';
export { FileRepository, defaultSnapshotPath } from './file-repository.js';

/** Pure in-memory. Used by tests, where touching the disk is a liability. */
export class MemoryRepository implements HuntRepository {
  readonly kind = 'memory' as const;

  private bundles = new Map<string, HuntBundle>();
  private runs: CompletedRun[] = [];

  async saveHuntBundle(bundle: HuntBundle): Promise<void> {
    this.bundles.set(bundle.hunt.id, bundle);
  }
  async getHuntBundle(huntId: string): Promise<HuntBundle | null> {
    return this.bundles.get(huntId) ?? null;
  }
  async listHunts(): Promise<Array<Pick<Hunt, 'id' | 'title' | 'city' | 'published'>>> {
    return [...this.bundles.values()].map(({ hunt }) => ({
      id: hunt.id,
      title: hunt.title,
      city: hunt.city,
      published: hunt.published,
    }));
  }
  async saveCompletedRun(run: CompletedRun): Promise<void> {
    this.runs.push(run);
  }
  async listCompletedRuns(huntId: string, limit = 50): Promise<CompletedRun[]> {
    return this.runs
      .filter((r) => r.huntId === huntId)
      .sort((a, b) => b.totalXp - a.totalXp)
      .slice(0, limit);
  }
  async findNearbyCheckpoints(
    latitude: number,
    longitude: number,
    radiusMeters: number,
  ): Promise<Checkpoint[]> {
    const origin = { latitude, longitude };
    return [...this.bundles.values()]
      .flatMap((b) => b.checkpoints)
      .filter((c) => haversineMeters(origin, c) <= radiusMeters);
  }
  async close(): Promise<void> {}
}

export interface RepositoryOptions {
  mongoUri?: string | undefined;
  mongoDb?: string | undefined;
  repoRoot: string;
}

/**
 * Mongo when a URI is configured, file-backed otherwise.
 *
 * A failed Mongo connection FALLS BACK to the file repository rather than
 * refusing to boot. Mid-demo, a server that starts with degraded persistence
 * beats a server that does not start — and /health reports which one is live,
 * so the degradation is never silent.
 */
export async function createRepository(opts: RepositoryOptions): Promise<HuntRepository> {
  if (opts.mongoUri) {
    try {
      const { MongoRepository } = await import('./mongo-repository.js');
      const repo = await MongoRepository.connect(opts.mongoUri, opts.mongoDb);
      console.log('[persistence] connected to MongoDB Atlas');
      return repo;
    } catch (err) {
      console.error(
        `[persistence] MongoDB connection FAILED (${err instanceof Error ? err.message : err}) — falling back to file storage`,
      );
    }
  }

  const path = defaultSnapshotPath(opts.repoRoot);
  console.log(`[persistence] using file storage at ${path}`);
  return new FileRepository(path);
}
