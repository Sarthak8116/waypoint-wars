/**
 * @ww/verification — photo verification for Waypoint Wars.
 *
 * SERVER ONLY. This package reads `GEMINI_API_KEY`. Nothing here may be
 * imported from `apps/web` client code, from `packages/game`, or from any
 * other module that reaches a browser bundle. The browser sends a submission
 * to the authoritative server and receives a `SubmissionVerdict` back; it never
 * verifies anything itself, because a client that can verify is a client that
 * can approve itself.
 */

export {
  splitImagePayload,
  inconclusiveResult,
  VerificationProviderError,
  type VerificationInput,
  type VerificationProvider,
  type VerificationErrorCode,
} from './provider.js';

export {
  GeminiVerificationProvider,
  GEMINI_MODEL_ID,
  GEMINI_TIMEOUT_MS,
  parseGeminiVerdict,
  type GeminiProviderOptions,
  type GeminiModelsClient,
} from './gemini-provider.js';

export { MockVerificationProvider, MOCK_REASON_PREFIX } from './mock-provider.js';

export {
  verifySubmission,
  toVerificationInput,
  DEFAULT_CONFIDENCE_THRESHOLD,
  VERDICT_MESSAGES,
  type VerifySubmissionOptions,
} from './verify-submission.js';

import { GeminiVerificationProvider } from './gemini-provider.js';
import { MockVerificationProvider } from './mock-provider.js';
import type { VerificationProvider } from './provider.js';

export interface CreateProviderOptions {
  /** Defaults to `process.env.GEMINI_API_KEY`. Never logged, never returned. */
  apiKey?: string;
  /** Force the mock even when a key is present (demo rehearsals, CI). */
  forceMock?: boolean;
  /** Injectable for tests. Defaults to `console`. */
  logger?: Pick<Console, 'info' | 'warn'>;
}

/** What the factory chose, so `/health` can badge the UI truthfully. */
export interface ProviderSelection {
  provider: VerificationProvider;
  mocked: boolean;
  label: string;
}

/**
 * Choose a provider and say so out loud.
 *
 * ARCHITECTURE.md: "A mock is never silently substituted for the real thing."
 * The selection is logged and returned as a flag so `/health` and the home page
 * can badge it — a demo that quietly ran on the mock is a demo that proved
 * nothing.
 */
export function createVerificationProviderDetailed(
  options: CreateProviderOptions = {},
): ProviderSelection {
  const logger = options.logger ?? console;
  const apiKey = options.apiKey ?? process.env['GEMINI_API_KEY'];

  if (options.forceMock) {
    logger.info('[verification] forceMock set — using the labeled MOCK provider.');
    return { provider: new MockVerificationProvider(), mocked: true, label: 'mock (forced)' };
  }

  if (!apiKey || apiKey.trim() === '') {
    logger.warn(
      '[verification] GEMINI_API_KEY is not set — using the labeled MOCK provider. ' +
        'Photos are NOT being looked at; observation answers are still checked for real.',
    );
    return { provider: new MockVerificationProvider(), mocked: true, label: 'mock (no api key)' };
  }

  try {
    const provider = new GeminiVerificationProvider({ apiKey });
    logger.info('[verification] GEMINI_API_KEY detected — using the REAL Gemini provider.');
    return { provider, mocked: false, label: 'gemini' };
  } catch (error) {
    logger.warn(
      '[verification] Gemini provider failed to initialise — falling back to the labeled MOCK provider.',
      error instanceof Error ? error.message : String(error),
    );
    return { provider: new MockVerificationProvider(), mocked: true, label: 'mock (init failed)' };
  }
}

/** Convenience wrapper when the caller only needs the provider itself. */
export function createVerificationProvider(
  options: CreateProviderOptions = {},
): VerificationProvider {
  return createVerificationProviderDetailed(options).provider;
}
