/**
 * Wire-message validation.
 *
 * Every one of these runs before a message touches game state, on the
 * assumption that the sender is hostile. The browser is not a trusted process:
 * it can send any JSON at all, at any time, in any order.
 *
 * Kept pure and separate from HuntRoom so the hostile cases are unit-testable
 * without standing up a server, and so the rule "validate EVERY message" is
 * visibly enforced in one auditable place rather than scattered through
 * handlers.
 *
 * Note what is NOT validated here, because it is never accepted at all: there
 * is no parser for xp, checkpointIndex, finished, routeId or startedAt. Those
 * are server-owned and no client message carries them (see HuntRoom's message
 * registration and its `*` catch-all).
 */

import type { CheckpointSubmission } from '@ww/shared';

export type Validated<T> = { ok: true; value: T } | { ok: false; error: string };

const fail = (error: string): { ok: false; error: string } => ({ ok: false, error });
const pass = <T>(value: T): { ok: true; value: T } => ({ ok: true, value });

/** Base64 data URLs are large; this bounds one submission's memory cost. */
export const MAX_IMAGE_CHARS = 12 * 1024 * 1024;
export const MAX_ANSWER_CHARS = 240;
export const MAX_ID_CHARS = 128;
export const MAX_NAME_CHARS = 32;
export const MAX_ACCURACY_METERS = 100_000;

/** Control characters and angle brackets, stripped from display names. */
const UNSAFE_NAME_CHARS = /[\u0000-\u001f\u007f<>]/g;

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Ids are matched against loaded content anyway; this just bounds the input. */
function isId(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= MAX_ID_CHARS;
}

export interface LocationPayload {
  latitude: number;
  longitude: number;
  accuracyMeters?: number;
}

export function validateLocation(payload: unknown): Validated<LocationPayload> {
  if (!isObject(payload)) return fail('update_location: expected an object.');
  const { latitude, longitude, accuracyMeters } = payload;

  if (!isFiniteNumber(latitude) || latitude < -90 || latitude > 90) {
    return fail('update_location: latitude must be a finite number between -90 and 90.');
  }
  if (!isFiniteNumber(longitude) || longitude < -180 || longitude > 180) {
    return fail('update_location: longitude must be a finite number between -180 and 180.');
  }
  if (accuracyMeters !== undefined) {
    if (
      !isFiniteNumber(accuracyMeters) ||
      accuracyMeters < 0 ||
      accuracyMeters > MAX_ACCURACY_METERS
    ) {
      return fail('update_location: accuracyMeters must be a non-negative finite number.');
    }
  }

  return pass(
    accuracyMeters === undefined
      ? { latitude, longitude }
      : { latitude, longitude, accuracyMeters },
  );
}

export function validateCheckpointId(payload: unknown, messageType: string): Validated<string> {
  if (!isObject(payload)) return fail(`${messageType}: expected an object.`);
  const checkpointId = payload['checkpointId'];
  if (!isId(checkpointId)) {
    return fail(`${messageType}: checkpointId must be a non-empty string.`);
  }
  return pass(checkpointId);
}

export function validateShareLocation(payload: unknown): Validated<boolean> {
  if (!isObject(payload)) return fail('set_share_location: expected an object.');
  if (typeof payload['enabled'] !== 'boolean') {
    return fail('set_share_location: enabled must be a boolean.');
  }
  return pass(payload['enabled']);
}

/**
 * Validate a submission's SHAPE only.
 *
 * Two fields are parsed and then deliberately overwritten by the room:
 *   - `submittedAt` — a client clock decides the speed bonus, so it is
 *     re-stamped server-side. A phone with a skewed clock (or an attacker with
 *     a patched one) must not be able to buy XP.
 *   - `randomizedInstruction` — the anti-cheat instruction is whatever the
 *     server issued on arrival, not whatever the client claims it was;
 *     otherwise a player picks the easiest instruction in the pool.
 * They are validated anyway so a malformed message is rejected consistently.
 *
 * `checkpointId` is checked for shape here and for AUTHORITY in
 * `assertSubmissionMatchesActiveCheckpoint` (DECISIONS.md D15) — shape alone
 * proves nothing about which checkpoint the player is actually standing on.
 */
export function validateSubmission(payload: unknown): Validated<CheckpointSubmission> {
  if (!isObject(payload)) return fail('submit_checkpoint: expected an object.');
  const submission = payload['submission'];
  if (!isObject(submission)) return fail('submit_checkpoint: submission must be an object.');

  const checkpointId = submission['checkpointId'];
  if (!isId(checkpointId)) {
    return fail('submit_checkpoint: submission.checkpointId must be a non-empty string.');
  }
  const image = submission['image'];
  if (typeof image !== 'string' || image.length === 0) {
    return fail('submit_checkpoint: submission.image must be a non-empty string.');
  }
  if (image.length > MAX_IMAGE_CHARS) {
    return fail('submit_checkpoint: submission.image is too large.');
  }
  const latitude = submission['latitude'];
  const longitude = submission['longitude'];
  if (!isFiniteNumber(latitude) || latitude < -90 || latitude > 90) {
    return fail('submit_checkpoint: submission.latitude must be between -90 and 90.');
  }
  if (!isFiniteNumber(longitude) || longitude < -180 || longitude > 180) {
    return fail('submit_checkpoint: submission.longitude must be between -180 and 180.');
  }
  const answer = submission['observationAnswer'];
  if (typeof answer !== 'string' || answer.length > MAX_ANSWER_CHARS) {
    return fail('submit_checkpoint: submission.observationAnswer must be a short string.');
  }
  const instruction = submission['randomizedInstruction'];
  if (instruction !== undefined && typeof instruction !== 'string') {
    return fail('submit_checkpoint: submission.randomizedInstruction must be a string.');
  }
  const submittedAt = submission['submittedAt'];

  return pass({
    checkpointId,
    image,
    latitude,
    longitude,
    observationAnswer: answer,
    randomizedInstruction: typeof instruction === 'string' ? instruction : '',
    // Replaced by the room with a server clock. Parsed only so the shape is
    // complete; its value here is never trusted.
    submittedAt: isFiniteNumber(submittedAt) ? submittedAt : 0,
  });
}

/** Join options. A name is cosmetic but still bounded and stripped of markup. */
export function sanitizePlayerName(value: unknown, fallback: string): string {
  if (typeof value !== 'string') return fallback;
  const cleaned = value.replace(UNSAFE_NAME_CHARS, '').trim().slice(0, MAX_NAME_CHARS);
  return cleaned.length > 0 ? cleaned : fallback;
}

export function sanitizeTeamName(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const cleaned = value.replace(UNSAFE_NAME_CHARS, '').trim().slice(0, MAX_NAME_CHARS);
  return cleaned.length > 0 ? cleaned : undefined;
}
