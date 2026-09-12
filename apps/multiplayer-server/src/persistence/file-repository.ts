/**
 * File-backed repository — the default when no MONGODB_URI is set.
 *
 * Everything is held in memory and mirrored to a JSON file, so a hunt
 * published from the creator dashboard survives a server restart without
 * anyone provisioning a database first.
 *
 * Writes are atomic (write to a temp file, then rename) because the alternative
 * is a truncated JSON file if the process dies mid-write — which would lose
 * every published hunt rather than the one being saved.
 */

import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { haversineMeters, type Checkpoint, type CompletedRun } from '@ww/shared';
import type { HuntBundle, HuntRepository } from './repository.js';

interface Snapshot {
  version: 1;
  hunts: HuntBundle[];
  runs: CompletedRun[];
}

const EMPTY: Snapshot = { version: 1, hunts: [], runs: [] };

/** Completed runs we keep per hunt. Enough for a leaderboard, bounded on disk. */
const MAX_RUNS_PER_HUNT = 200;

export class FileRepository implements HuntRepository {
  readonly kind = 'file' as const;

  private snapshot: Snapshot = structuredClone(EMPTY);
  private loaded = false;
  /** Serializes writes so two concurrent saves cannot interleave. */
  private writeChain: Promise<void> = Promise.resolve();

  constructor(private readonly filePath: string) {}

  private async ensureLoaded(): Promise<void> {
    if (this.loaded) return;
    this.loaded = true;
    try {
      const raw = await readFile(this.filePath, 'utf8');
      const parsed = JSON.parse(raw) as Snapshot;
      if (parsed?.version === 1) this.snapshot = parsed;
    } catch {
      // No file yet, or it is unreadable. Starting empty is correct and
      // expected on a first run; a corrupt file is not worth crashing over.
    }
  }

  private persist(): Promise<void> {
    this.writeChain = this.writeChain.then(async () => {
      const tmp = `${this.filePath}.tmp`;
      await mkdir(dirname(this.filePath), { recursive: true });
      await writeFile(tmp, `${JSON.stringify(this.snapshot, null, 2)}\n`, 'utf8');
      await rename(tmp, this.filePath); // atomic on the same filesystem
    });
    return this.writeChain;
  }

  async saveHuntBundle(bundle: HuntBundle): Promise<void> {
    await this.ensureLoaded();
    const i = this.snapshot.hunts.findIndex((h) => h.hunt.id === bundle.hunt.id);
    if (i >= 0) this.snapshot.hunts[i] = bundle;
    else this.snapshot.hunts.push(bundle);
    await this.persist();
  }

  async getHuntBundle(huntId: string): Promise<HuntBundle | null> {
    await this.ensureLoaded();
    return this.snapshot.hunts.find((h) => h.hunt.id === huntId) ?? null;
  }

  async listHunts() {
    await this.ensureLoaded();
    return this.snapshot.hunts.map(({ hunt }) => ({
      id: hunt.id,
      title: hunt.title,
      city: hunt.city,
      published: hunt.published,
    }));
  }

  async saveCompletedRun(run: CompletedRun): Promise<void> {
    await this.ensureLoaded();
    this.snapshot.runs.push(run);

    // Bound the file. Oldest-first removal, per hunt, so one busy hunt cannot
    // evict another's history.
    const forHunt = this.snapshot.runs.filter((r) => r.huntId === run.huntId);
    if (forHunt.length > MAX_RUNS_PER_HUNT) {
      const excess = forHunt
        .sort((a, b) => a.finishedAt - b.finishedAt)
        .slice(0, forHunt.length - MAX_RUNS_PER_HUNT);
      const drop = new Set(excess.map((r) => r.id));
      this.snapshot.runs = this.snapshot.runs.filter((r) => !drop.has(r.id));
    }

    await this.persist();
  }

  async listCompletedRuns(huntId: string, limit = 50): Promise<CompletedRun[]> {
    await this.ensureLoaded();
    return this.snapshot.runs
      .filter((r) => r.huntId === huntId)
      .sort((a, b) => b.totalXp - a.totalXp)
      .slice(0, limit);
  }

  async findNearbyCheckpoints(
    latitude: number,
    longitude: number,
    radiusMeters: number,
  ): Promise<Checkpoint[]> {
    await this.ensureLoaded();
    const origin = { latitude, longitude };
    return this.snapshot.hunts
      .flatMap((h) => h.checkpoints)
      .filter((c) => haversineMeters(origin, c) <= radiusMeters);
  }

  async close(): Promise<void> {
    await this.writeChain;
  }
}

export function defaultSnapshotPath(repoRoot: string): string {
  return resolve(repoRoot, '.data', 'hunts.json');
}
