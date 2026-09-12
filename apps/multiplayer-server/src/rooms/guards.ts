/**
 * DECISIONS.md D15 — submission/checkpoint binding.
 *
 * ---------------------------------------------------------------------------
 * THE ASSERTION THIS FILE EXISTS FOR
 *
 * `verifySubmission` trusts its caller about which checkpoint is active. It has
 * to: it is a pure decision function, it is given one checkpoint and one
 * submission, and it has no idea how far along the player is. Only the room
 * knows that, because only the room owns `checkpointIndex`.
 *
 * So the room must bind the two together BEFORE calling it. Without this check
 * a client sends `{ checkpointId: 'final_point_fountain', ...a photo taken at
 * checkpoint 1 }` and the server dutifully geofences that photo's coordinates
 * against checkpoint 1's radius — where the player genuinely is standing —
 * while scoring it as the finish line. Every geofence in the system is
 * evaluated against a checkpoint the CLIENT named, which makes the geofence
 * decorative.
 *
 * The guard is deliberately a separate, pure function rather than an inline
 * `if`: it is the single highest-value security check in the multiplayer
 * feature, it is referenced by id in DECISIONS.md, and it is directly
 * unit-testable without standing up a room.
 *
 * It must run BEFORE `verifySubmission`, not inside the verdict handling —
 * reaching the provider at all on a mismatched checkpoint means we paid for a
 * Gemini call on a submission we already knew was illegitimate.
 * ---------------------------------------------------------------------------
 */

export type SubmissionGuardFailureCode = 'HUNT_NOT_ACTIVE' | 'CHECKPOINT_MISMATCH';

export type SubmissionGuardResult =
  | { ok: true; checkpointId: string }
  | { ok: false; code: SubmissionGuardFailureCode; message: string };

/**
 * Player-facing copy. As with `VERDICT_MESSAGES`, it names no checkpoint and
 * quotes nothing back: a client probing for "which checkpoint am I allowed to
 * submit?" learns only that this one is not it.
 */
export const GUARD_MESSAGES = {
  notActive: 'The hunt is not running, so there is nothing to submit.',
  mismatch: 'That submission is for a checkpoint you are not currently on.',
} as const;

/**
 * Assert that a client-named checkpoint is the player's own active checkpoint.
 *
 * @param submittedCheckpointId  Whatever the client claimed. Untrusted.
 * @param activeCheckpointId     From `activeCheckpointId(run)` — derived from
 *                               the server's route assignment and its own
 *                               `checkpointIndex`. Null when no hunt is running.
 */
export function assertSubmissionMatchesActiveCheckpoint(
  submittedCheckpointId: string,
  activeCheckpointId: string | null,
): SubmissionGuardResult {
  if (activeCheckpointId === null || activeCheckpointId === '') {
    return { ok: false, code: 'HUNT_NOT_ACTIVE', message: GUARD_MESSAGES.notActive };
  }
  if (submittedCheckpointId !== activeCheckpointId) {
    return { ok: false, code: 'CHECKPOINT_MISMATCH', message: GUARD_MESSAGES.mismatch };
  }
  return { ok: true, checkpointId: activeCheckpointId };
}
