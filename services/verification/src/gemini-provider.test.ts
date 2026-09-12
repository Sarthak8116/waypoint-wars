/**
 * These tests never touch the network. The SDK client is injected, so a
 * missing (or present) GEMINI_API_KEY changes nothing here.
 */

import { describe, expect, it, vi } from 'vitest';
import {
  GEMINI_MODEL_ID,
  GeminiVerificationProvider,
  parseGeminiVerdict,
  type GeminiModelsClient,
} from './gemini-provider.js';
import type { VerificationInput } from './provider.js';
import { VerificationProviderError } from './provider.js';

const INPUT: VerificationInput = {
  checkpointId: 'cp-blockhouse',
  checkpointName: 'Fort Pitt Blockhouse',
  landmarkDescription: 'A small brick redoubt with a pitched roof and loopholes.',
  randomizedInstruction: 'Hold up two fingers in the shot.',
  observationQuestion: 'What year is carved into the datestone?',
  acceptedAnswers: ['1764'],
  submittedAnswer: '1764',
  imageBase64: 'data:image/png;base64,QUJDREVG',
  mimeType: 'image/jpeg',
};

/** Minimal stand-in for GenerateContentResponse — only `text` is read. */
function textResponse(text: string): never {
  return { text } as never;
}

function clientReturning(text: string): GeminiModelsClient & { generateContent: ReturnType<typeof vi.fn> } {
  return { generateContent: vi.fn(async () => textResponse(text)) } as never;
}

const VALID_JSON = JSON.stringify({
  landmarkMatch: true,
  requiredActionCompleted: true,
  answerCorrect: true,
  confidence: 0.82,
  reason: 'The blockhouse and two raised fingers are both visible.',
});

describe('parseGeminiVerdict', () => {
  it('parses a well-formed structured response', () => {
    expect(parseGeminiVerdict(VALID_JSON)).toEqual({
      landmarkMatch: true,
      requiredActionCompleted: true,
      answerCorrect: true,
      confidence: 0.82,
      reason: 'The blockhouse and two raised fingers are both visible.',
    });
  });

  it('survives a model that fences its JSON anyway', () => {
    expect(parseGeminiVerdict('```json\n' + VALID_JSON + '\n```').confidence).toBe(0.82);
  });

  it('clamps an out-of-range confidence', () => {
    const raw = JSON.stringify({ ...JSON.parse(VALID_JSON), confidence: 7 });
    expect(parseGeminiVerdict(raw).confidence).toBe(1);
  });

  it('throws a typed error on an empty response', () => {
    expect(() => parseGeminiVerdict('')).toThrow(VerificationProviderError);
  });

  it('throws a typed error on non-JSON prose', () => {
    try {
      parseGeminiVerdict('Sure! It looks like the right building to me.');
      expect.unreachable('should have thrown');
    } catch (error) {
      expect(error).toBeInstanceOf(VerificationProviderError);
      expect((error as VerificationProviderError).code).toBe('malformed-response');
    }
  });

  it('throws a typed error when a required field is missing or mistyped', () => {
    const missing = JSON.stringify({ landmarkMatch: true, confidence: 0.9, reason: 'ok' });
    expect(() => parseGeminiVerdict(missing)).toThrow(VerificationProviderError);

    const mistyped = JSON.stringify({ ...JSON.parse(VALID_JSON), landmarkMatch: 'yes' });
    expect(() => parseGeminiVerdict(mistyped)).toThrow(VerificationProviderError);
  });
});

describe('GeminiVerificationProvider', () => {
  it('forces structured output and sends the photo inline', async () => {
    const client = clientReturning(VALID_JSON);
    const provider = new GeminiVerificationProvider({ client });

    const out = await provider.verify(INPUT);

    expect(out.mocked).toBe(false);
    expect(out.confidence).toBe(0.82);

    const request = client.generateContent.mock.calls[0]?.[0] as {
      model: string;
      contents: Array<{ parts: Array<Record<string, unknown>> }>;
      config: Record<string, unknown>;
    };
    expect(request.model).toBe(GEMINI_MODEL_ID);
    expect(request.config['responseMimeType']).toBe('application/json');
    expect(request.config['responseSchema']).toBeDefined();

    // The data URL's own mime type wins over the caller's default.
    expect(request.contents[0]?.parts[1]).toEqual({
      inlineData: { mimeType: 'image/png', data: 'QUJDREVG' },
    });
  });

  it('grounds the prompt in the landmark, the action, the question and the answer', async () => {
    const client = clientReturning(VALID_JSON);
    await new GeminiVerificationProvider({ client }).verify(INPUT);

    const request = client.generateContent.mock.calls[0]?.[0] as {
      contents: Array<{ parts: Array<{ text?: string }> }>;
      config: { systemInstruction?: string };
    };
    const prompt = request.contents[0]?.parts[0]?.text ?? '';

    expect(prompt).toContain(INPUT.landmarkDescription);
    expect(prompt).toContain(INPUT.randomizedInstruction);
    expect(prompt).toContain(INPUT.observationQuestion);
    expect(prompt).toContain(INPUT.submittedAnswer);

    // Gemini is never asked to score anything.
    expect(request.config.systemInstruction).toMatch(/never award/i);
    expect(prompt.toLowerCase()).not.toContain(' xp');
  });

  it('returns zero confidence — never throws — on a malformed response', async () => {
    const out = await new GeminiVerificationProvider({
      client: clientReturning('not json at all'),
    }).verify(INPUT);

    expect(out.confidence).toBe(0);
    expect(out.landmarkMatch).toBe(false);
    expect(out.mocked).toBe(false);
    expect(out.reason).toMatch(/could not be read/i);
  });

  it('reports a rate limit as unverified rather than as a failed photo', async () => {
    const client: GeminiModelsClient = {
      generateContent: async () => {
        throw Object.assign(new Error('got status: 429 Too Many Requests'), { status: 429 });
      },
    };
    const out = await new GeminiVerificationProvider({ client }).verify(INPUT);

    expect(out.confidence).toBe(0);
    expect(out.reason).toMatch(/rate limited/i);
  });

  it('gives up on a hung request at the configured timeout', async () => {
    const client: GeminiModelsClient = { generateContent: () => new Promise(() => {}) };
    const out = await new GeminiVerificationProvider({ client, timeoutMs: 10 }).verify(INPUT);

    expect(out.confidence).toBe(0);
    expect(out.reason).toMatch(/timed out/i);
  });

  it('treats a safety block as unverified, not as cheating', async () => {
    const client: GeminiModelsClient = {
      generateContent: async () => ({ promptFeedback: { blockReason: 'SAFETY' } }) as never,
    };
    const out = await new GeminiVerificationProvider({ client }).verify(INPUT);

    expect(out.confidence).toBe(0);
    expect(out.reason).toMatch(/declined/i);
  });

  it('refuses to verify with no photo attached', async () => {
    const client = clientReturning(VALID_JSON);
    const out = await new GeminiVerificationProvider({ client }).verify({
      ...INPUT,
      imageBase64: '',
    });

    expect(out.confidence).toBe(0);
    expect(client.generateContent).not.toHaveBeenCalled();
  });

  it('refuses to construct without an API key instead of silently mocking', () => {
    expect(() => new GeminiVerificationProvider({ apiKey: '' })).toThrow(/GEMINI_API_KEY/);
  });

  it('never puts the API key in an error, a reason or the request body', async () => {
    const secret = 'AIza-test-not-a-real-key';
    const client = clientReturning(VALID_JSON);
    const provider = new GeminiVerificationProvider({ apiKey: secret, client });
    const out = await provider.verify(INPUT);

    expect(JSON.stringify(out)).not.toContain(secret);
    expect(JSON.stringify(client.generateContent.mock.calls)).not.toContain(secret);
  });
});
