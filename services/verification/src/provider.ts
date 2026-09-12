/**
 * The verification provider contract.
 *
 * A provider LOOKS at a submission and reports what it saw. That is the whole
 * job. It does not know the geofence result, it does not know the player's XP,
 * and it cannot award anything — `VerificationResult` has no `xp` field by
 * design (see ARCHITECTURE.md, "The server owns XP, and Gemini does not").
 *
 * Two implementations exist: `GeminiVerificationProvider` (real) and
 * `MockVerificationProvider` (deterministic, labeled). Both are interchangeable
 * from the caller's point of view, which is what lets the whole game be
 * demoed, tested and developed without an API key.
 */

import type { VerificationResult } from '@ww/shared';

/**
 * Everything a provider is allowed to see about one submission.
 *
 * Note what is NOT here: the player's id, their XP, their route, the other
 * players. A provider judges one photo against one checkpoint's criteria and
 * nothing else, so there is no state for a prompt injection in the answer text
 * to reach for.
 */
export interface VerificationInput {
  /** Used by the mock to derive a stable verdict; ignored by Gemini. */
  checkpointId: string;
  /** The landmark's real name. Grounding context for the model. */
  checkpointName: string;
  /** What the landmark should look like — the model's visual grounding. */
  landmarkDescription: string;
  /** Optional reference image, when the content pack ships one. */
  referenceImageUrl?: string;
  /** The anti-cheat action, issued on arrival. Must be visible in the photo. */
  randomizedInstruction: string;
  /** The observation question the player was asked. */
  observationQuestion: string;
  /**
   * The answers the content author considers correct. Supplied to the model as
   * criteria only — the authoritative comparison is done server-side with
   * `matchesAcceptedAnswer`, never by the model. See verify-submission.ts.
   */
  acceptedAnswers: readonly string[];
  /** What the player actually typed. Untrusted text. */
  submittedAnswer: string;
  /** Raw base64 or a `data:<mime>;base64,...` URL. */
  imageBase64: string;
  /** e.g. `image/jpeg`. Overridden by the mime embedded in a data URL. */
  mimeType: string;
}

export interface VerificationProvider {
  /**
   * Judge one submission.
   *
   * Implementations MUST NOT throw. A network failure, a timeout, a rate limit
   * or a malformed model response is a verdict of "could not verify"
   * (`confidence: 0` with an explanatory `reason`), not an exception thrown
   * into a request handler while a player stands on a street corner.
   */
  verify(input: VerificationInput): Promise<VerificationResult>;
}

/** Distinguishes the failure modes we handle explicitly. */
export type VerificationErrorCode =
  | 'timeout'
  | 'rate-limited'
  | 'safety-blocked'
  | 'malformed-response'
  | 'transport';

/**
 * Thrown INSIDE a provider and caught at its own `verify()` boundary, where it
 * becomes a zero-confidence `VerificationResult`. It is exported so that unit
 * tests and future providers can assert on the failure mode, not so callers
 * have to catch it.
 */
export class VerificationProviderError extends Error {
  readonly code: VerificationErrorCode;

  constructor(code: VerificationErrorCode, message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'VerificationProviderError';
    this.code = code;
  }
}

/**
 * Split a `data:image/jpeg;base64,AAAA` URL into its parts. A raw base64
 * string is returned untouched alongside the caller-supplied mime type.
 *
 * Done here rather than at the call site because every provider needs it and
 * the browser sends whichever form the camera component happened to produce.
 */
export function splitImagePayload(
  imageBase64: string,
  fallbackMimeType: string,
): { data: string; mimeType: string } {
  const fallback = fallbackMimeType?.trim() || 'image/jpeg';
  if (typeof imageBase64 !== 'string') return { data: '', mimeType: fallback };

  const match = /^data:([^;,]+);base64,(.*)$/s.exec(imageBase64.trim());
  if (match) {
    const mime = match[1];
    const data = match[2];
    return { data: data ?? '', mimeType: mime && mime.length > 0 ? mime : fallback };
  }
  return { data: imageBase64.trim(), mimeType: fallback };
}

/** A verdict that saw nothing and claims nothing. The safe failure value. */
export function inconclusiveResult(reason: string, mocked: boolean): VerificationResult {
  return {
    landmarkMatch: false,
    requiredActionCompleted: false,
    answerCorrect: false,
    confidence: 0,
    reason,
    mocked,
  };
}
