/**
 * The labeled mock provider, used whenever `GEMINI_API_KEY` is absent.
 *
 * Two rules govern everything here.
 *
 * 1. DETERMINISTIC. No `Math.random()`, no clock. The same submission always
 *    produces the same verdict, so the three-minute demo runs identically on
 *    the tenth rehearsal as on the first, and so a failing test is a real
 *    failure rather than an unlucky one.
 *
 * 2. HONEST. The mock cannot see pixels, so it does not pretend to. It never
 *    fabricates a landmark mismatch it could not have observed — inventing
 *    failures would send a developer chasing a bug in perfectly good content.
 *    What it CAN evaluate for real is the observation answer, and it does:
 *    `matchesAcceptedAnswer` runs here exactly as it does on the real path, so
 *    a wrong answer is rejected with no API key present. The opposite failure
 *    mode — a mock that approves everything — is the one that makes a broken
 *    game look like a working one, and it is the one to avoid.
 *
 * Every result is `mocked: true` with a `[MOCK]` reason prefix. ARCHITECTURE.md
 * is explicit: a mock is never silently substituted for the real thing.
 */

import { hashString, matchesAcceptedAnswer } from '@ww/hunt-engine';
import type { VerificationResult } from '@ww/shared';
import {
  splitImagePayload,
  type VerificationInput,
  type VerificationProvider,
} from './provider.js';

/** Prefix on every mocked reason, so it is visible in logs and in the UI. */
export const MOCK_REASON_PREFIX = '[MOCK]';

/**
 * Confidence band for a mocked judgement. Comfortably above the approval
 * threshold (the mock is not trying to create needs-review cases) but varied
 * within the band so the HUD's confidence readout is not a flat 0.9 in every
 * screenshot.
 */
const MOCK_CONFIDENCE_MIN = 0.72;
const MOCK_CONFIDENCE_MAX = 0.95;

/** Stable across runs, processes and machines — FNV-1a from the hunt engine. */
function derivedConfidence(input: VerificationInput): number {
  const seed = hashString(
    `${input.checkpointId}|${input.submittedAnswer}|${input.randomizedInstruction}`,
  );
  const fraction = (seed % 1000) / 999;
  const raw = MOCK_CONFIDENCE_MIN + fraction * (MOCK_CONFIDENCE_MAX - MOCK_CONFIDENCE_MIN);
  // Two decimals: exactly reproducible through JSON round-trips.
  return Math.round(raw * 100) / 100;
}

export class MockVerificationProvider implements VerificationProvider {
  verify(input: VerificationInput): Promise<VerificationResult> {
    return Promise.resolve(this.verifySync(input));
  }

  /** Synchronous core — the async `verify` is only there to fit the interface. */
  verifySync(input: VerificationInput): VerificationResult {
    const { data } = splitImagePayload(input.imageBase64, input.mimeType);
    const hasPhoto = data.length > 0;
    const answerCorrect = matchesAcceptedAnswer(input.submittedAnswer, input.acceptedAnswers);

    // No photo is a genuine observation, not a fabrication: there is nothing
    // to look at, so nothing visual can be confirmed.
    if (!hasPhoto) {
      return {
        landmarkMatch: false,
        requiredActionCompleted: false,
        answerCorrect,
        confidence: 0,
        reason: `${MOCK_REASON_PREFIX} No photo was attached, so nothing could be checked.`,
        mocked: true,
      };
    }

    const confidence = derivedConfidence(input);

    return {
      landmarkMatch: true,
      requiredActionCompleted: true,
      answerCorrect,
      confidence,
      reason:
        `${MOCK_REASON_PREFIX} No GEMINI_API_KEY, so the photo was not looked at. ` +
        `The landmark and the required action are assumed present; the observation answer was ` +
        `checked for real and was ${answerCorrect ? 'correct' : 'incorrect'}.`,
      mocked: true,
    };
  }
}
