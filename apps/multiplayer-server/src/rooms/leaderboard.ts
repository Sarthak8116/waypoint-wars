/**
 * Leaderboard ordering.
 *
 * Pure, so the ordering the room stores in its schema, the ordering it
 * broadcasts in a `leaderboard` message and the ordering the results screen
 * renders are all produced by the same function from the same numbers.
 *
 * Ranking is by XP, NOT by finishing time, and that is the fairness mechanism
 * rather than an implementation detail: players walk different routes of
 * different lengths, so "first to finish" compares nothing. The speed component
 * is already inside each XP award, normalized per checkpoint against that
 * checkpoint's own expected time (see hunt-engine's `speedBonus`).
 */

import type { LeaderboardEntry } from '@ww/shared';

export interface LeaderboardSource {
  /** Player id in `individual-race`, team id in `team-race`. */
  entryId: string;
  displayName: string;
  isTeam: boolean;
  xp: number;
  checkpointsCompleted: number;
  totalCheckpoints: number;
  hintsUsed: number;
  finished: boolean;
  /** Epoch ms, or null while still running. */
  finishedAt: number | null;
}

/**
 * Tie-breaking, in order: more XP, then further along the route, then finished
 * earlier, then name. The last one is not cosmetic — without a total order the
 * board can reshuffle between two identical states, which reads as a bug during
 * a demo and makes the ordering untestable.
 */
function compare(a: LeaderboardSource, b: LeaderboardSource): number {
  if (a.xp !== b.xp) return b.xp - a.xp;
  if (a.checkpointsCompleted !== b.checkpointsCompleted) {
    return b.checkpointsCompleted - a.checkpointsCompleted;
  }
  if (a.finished !== b.finished) return a.finished ? -1 : 1;
  const aFinish = a.finishedAt ?? Number.POSITIVE_INFINITY;
  const bFinish = b.finishedAt ?? Number.POSITIVE_INFINITY;
  if (aFinish !== bFinish) return aFinish - bFinish;
  if (a.displayName !== b.displayName) return a.displayName < b.displayName ? -1 : 1;
  return a.entryId < b.entryId ? -1 : a.entryId > b.entryId ? 1 : 0;
}

export function buildLeaderboard(sources: readonly LeaderboardSource[]): LeaderboardEntry[] {
  return [...sources].sort(compare).map((source, index) => ({
    rank: index + 1,
    playerId: source.entryId,
    displayName: source.displayName,
    isTeam: source.isTeam,
    xp: source.xp,
    checkpointsCompleted: source.checkpointsCompleted,
    totalCheckpoints: source.totalCheckpoints,
    hintsUsed: source.hintsUsed,
    finished: source.finished,
  }));
}
