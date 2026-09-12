/**
 * The room's single verification provider.
 *
 * One long-lived provider per process (see `verifySubmission`'s doc comment:
 * the provider is injected, not constructed per call, so the room holds one and
 * no test can reach the network). `createVerificationProviderDetailed` already
 * logs and badges whether the real Gemini client or the labeled mock was
 * chosen — `/health` reads the same flag.
 *
 * The test override is a module-level setter, deliberately NOT a room option:
 * room options come from the client, and a client that can choose the
 * verification provider can choose one that approves everything.
 */

import {
  createVerificationProviderDetailed,
  type ProviderSelection,
  type VerificationProvider,
} from '@ww/verification';

let selection: ProviderSelection | null = null;

export function getVerificationProvider(): VerificationProvider {
  return getProviderSelection().provider;
}

export function getProviderSelection(): ProviderSelection {
  selection ??= createVerificationProviderDetailed();
  return selection;
}

/** Tests only. Installs a spy/stub provider and reports it as mocked. */
export function setVerificationProviderForTesting(provider: VerificationProvider): void {
  selection = { provider, mocked: true, label: 'test-injected' };
}

/** Tests only. Restores lazy construction from the environment. */
export function resetVerificationProvider(): void {
  selection = null;
}
