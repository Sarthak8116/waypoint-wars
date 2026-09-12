/**
 * Wire protocol + in-app event contracts.
 *
 * Three distinct channels live here:
 *   1. ClientMessage  — browser  -> colyseus  (untrusted, validated server-side)
 *   2. ServerMessage  — colyseus -> browser   (authoritative)
 *   3. GameEvent      — React    -> Phaser    (presentation only, no state)
 */

import type {
  ApproximateRegion,
  LeaderboardEntry,
  SubmissionVerdict,
  CheckpointSubmission,
  Checkpoint,
  GameMode,
  RoomSettings,
} from './domain.js';

// ---------------------------------------------------------------------------
// 1. Client -> Server
// ---------------------------------------------------------------------------

export type ClientMessage =
  | { type: 'update_location'; latitude: number; longitude: number; accuracyMeters?: number }
  | { type: 'request_hint'; checkpointId: string }
  | { type: 'submit_checkpoint'; submission: CheckpointSubmission }
  | { type: 'request_instruction'; checkpointId: string }
  | { type: 'finish_hunt' }
  | { type: 'start_hunt' }
  | { type: 'set_share_location'; enabled: boolean };

export const CLIENT_MESSAGE_TYPES = [
  'update_location',
  'request_hint',
  'submit_checkpoint',
  'request_instruction',
  'finish_hunt',
  'start_hunt',
  'set_share_location',
] as const;

// ---------------------------------------------------------------------------
// 2. Server -> Client
// ---------------------------------------------------------------------------

export type ServerMessage =
  | { type: 'hunt_started'; startedAt: number; firstCheckpoint: PublicCheckpoint }
  | { type: 'checkpoint_unlocked'; index: number; checkpoint: PublicCheckpoint }
  | { type: 'submission_result'; verdict: SubmissionVerdict }
  | { type: 'hint_issued'; checkpointId: string; hint: string; xpDelta: number }
  | { type: 'instruction_issued'; checkpointId: string; instruction: string }
  | { type: 'score_update'; playerId: string; xp: number }
  | { type: 'player_progress'; playerId: string; checkpointIndex: number; totalCheckpoints: number }
  | { type: 'player_region'; playerId: string; region: ApproximateRegion | null }
  | { type: 'leaderboard'; entries: LeaderboardEntry[] }
  | { type: 'hunt_finished'; entries: LeaderboardEntry[]; finishedAt: number }
  | { type: 'error'; message: string };

/**
 * A checkpoint as sent to the player who is currently hunting it.
 * Deliberately omits `acceptedAnswers`, `historicalReveal`, `hiddenDetail`
 * and `hint` — those would let a client shortcut the challenge.
 */
export type PublicCheckpoint = Pick<
  Checkpoint,
  | 'id'
  | 'clue'
  | 'latitude'
  | 'longitude'
  | 'radiusMeters'
  | 'observationQuestion'
  | 'photoRequirement'
  | 'challengeKind'
  | 'expectedCompletionSeconds'
>;

/** Strips every field a hunting player must not see. */
export function toPublicCheckpoint(c: Checkpoint): PublicCheckpoint {
  return {
    id: c.id,
    clue: c.clue,
    latitude: c.latitude,
    longitude: c.longitude,
    radiusMeters: c.radiusMeters,
    observationQuestion: c.observationQuestion,
    photoRequirement: c.photoRequirement,
    challengeKind: c.challengeKind,
    expectedCompletionSeconds: c.expectedCompletionSeconds,
  };
}

// ---------------------------------------------------------------------------
// 3. React -> Phaser presentation bridge
// ---------------------------------------------------------------------------

export type GameEvent =
  | { type: 'PLAYER_ARRIVED'; checkpointId: string; index: number }
  | { type: 'SUBMISSION_APPROVED'; checkpointId: string; xpAwarded: number }
  | { type: 'SUBMISSION_REJECTED'; checkpointId: string; reason: string }
  | { type: 'XP_AWARDED'; amount: number; total: number; label?: string }
  | { type: 'HINT_USED'; checkpointId: string; xpDelta: number }
  | { type: 'OPPONENT_PROGRESS'; playerId: string; name: string; checkpointIndex: number }
  | { type: 'TIMER_TICK'; secondsRemaining: number }
  | { type: 'PROGRESS_UPDATE'; completed: number; total: number }
  | { type: 'HUNT_FINISHED'; entries: LeaderboardEntry[] };

export type GameEventType = GameEvent['type'];

// ---------------------------------------------------------------------------
// Lobby / room creation DTOs
// ---------------------------------------------------------------------------

export interface CreateRoomRequest {
  playerName: string;
  settings: Omit<RoomSettings, 'mode'> & { mode: GameMode };
}

export interface JoinRoomRequest {
  code: string;
  playerName: string;
  teamName?: string;
}

/** Six-character, unambiguous alphabet (no O/0/I/1). */
export const ROOM_CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export const ROOM_CODE_LENGTH = 6;
