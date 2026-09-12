import { afterEach, describe, expect, it, vi } from 'vitest';
import { createVerificationProviderDetailed } from './index.js';
import { GeminiVerificationProvider } from './gemini-provider.js';
import { MockVerificationProvider } from './mock-provider.js';

function logger() {
  return { info: vi.fn(), warn: vi.fn() };
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('createVerificationProvider', () => {
  it('selects the labeled mock when no API key is present, and says so loudly', () => {
    vi.stubEnv('GEMINI_API_KEY', '');
    const log = logger();
    const selection = createVerificationProviderDetailed({ logger: log });

    expect(selection.provider).toBeInstanceOf(MockVerificationProvider);
    expect(selection.mocked).toBe(true);
    expect(log.warn).toHaveBeenCalledOnce();
    expect(String(log.warn.mock.calls[0]?.[0])).toMatch(/MOCK/);
  });

  it('selects the real Gemini provider when a key is present', () => {
    vi.stubEnv('GEMINI_API_KEY', 'AIza-test-not-a-real-key');
    const log = logger();
    const selection = createVerificationProviderDetailed({ logger: log });

    expect(selection.provider).toBeInstanceOf(GeminiVerificationProvider);
    expect(selection.mocked).toBe(false);
    expect(selection.label).toBe('gemini');
  });

  it('never logs the API key', () => {
    const secret = 'AIza-super-secret-value';
    vi.stubEnv('GEMINI_API_KEY', secret);
    const log = logger();
    createVerificationProviderDetailed({ logger: log });

    const logged = JSON.stringify([log.info.mock.calls, log.warn.mock.calls]);
    expect(logged).not.toContain(secret);
  });

  it('honours forceMock even when a key is present', () => {
    vi.stubEnv('GEMINI_API_KEY', 'AIza-test-not-a-real-key');
    const selection = createVerificationProviderDetailed({ forceMock: true, logger: logger() });

    expect(selection.mocked).toBe(true);
    expect(selection.label).toContain('forced');
  });
});
