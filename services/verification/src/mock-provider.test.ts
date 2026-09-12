import { describe, expect, it } from 'vitest';
import type { Checkpoint, CheckpointSubmission } from '@ww/shared';
import { MOCK_REASON_PREFIX, MockVerificationProvider } from './mock-provider.js';
import type { VerificationInput } from './provider.js';
import { verifySubmission } from './verify-submission.js';

const INPUT: VerificationInput = {
  checkpointId: 'cp-ppg-place',
  checkpointName: 'PPG Place',
  landmarkDescription: 'A glass castle with neo-gothic spires.',
  randomizedInstruction: 'Include something red in the shot.',
  observationQuestion: 'How many spires crown the central tower?',
  acceptedAnswers: ['six spires', 'spires'],
  submittedAnswer: 'six spires',
  imageBase64: 'data:image/jpeg;base64,QUJDREVG',
  mimeType: 'image/jpeg',
};

const CHECKPOINT: Checkpoint = {
  id: INPUT.checkpointId,
  name: INPUT.checkpointName,
  latitude: 40.440_2,
  longitude: -80.001_0,
  clue: 'A castle of glass.',
  hint: 'Count the tallest ones.',
  challengeKind: 'count-feature',
  observationQuestion: INPUT.observationQuestion,
  acceptedAnswers: [...INPUT.acceptedAnswers],
  photoRequirement: 'The tower in frame.',
  landmarkDescription: INPUT.landmarkDescription,
  historicalReveal: 'Completed in 1984 and clad in nearly a million square feet of glass.',
  sources: [{ title: 'City Architecture Guide' }],
  radiusMeters: 50,
  baseXp: 100,
  expectedCompletionSeconds: 600,
};

const SUBMISSION: CheckpointSubmission = {
  checkpointId: CHECKPOINT.id,
  image: INPUT.imageBase64,
  latitude: CHECKPOINT.latitude,
  longitude: CHECKPOINT.longitude,
  observationAnswer: INPUT.submittedAnswer,
  randomizedInstruction: INPUT.randomizedInstruction,
  submittedAt: 1_700_000_480_000,
};

describe('MockVerificationProvider', () => {
  it('always labels itself as mocked', async () => {
    const verdict = await new MockVerificationProvider().verify(INPUT);
    expect(verdict.mocked).toBe(true);
    expect(verdict.reason.startsWith(MOCK_REASON_PREFIX)).toBe(true);
  });

  it('is deterministic: the same input twice gives an identical result', async () => {
    const provider = new MockVerificationProvider();
    const first = await provider.verify(INPUT);
    const second = await provider.verify({ ...INPUT });
    expect(first).toEqual(second);

    // And so does a whole verdict, which is what the demo actually replays.
    const a = await verifySubmission(SUBMISSION, CHECKPOINT, provider);
    const b = await verifySubmission({ ...SUBMISSION }, CHECKPOINT, provider);
    expect(a).toEqual(b);
  });

  it('produces a fresh instance with the same verdicts as any other instance', async () => {
    const a = await new MockVerificationProvider().verify(INPUT);
    const b = await new MockVerificationProvider().verify(INPUT);
    expect(a).toEqual(b);
  });

  it('varies confidence across checkpoints without ever being random', async () => {
    const provider = new MockVerificationProvider();
    const confidences = await Promise.all(
      ['cp-a', 'cp-b', 'cp-c', 'cp-d', 'cp-e'].map(async (checkpointId) =>
        (await provider.verify({ ...INPUT, checkpointId })).confidence,
      ),
    );
    expect(new Set(confidences).size).toBeGreaterThan(1);
    for (const c of confidences) {
      expect(c).toBeGreaterThan(0.55);
      expect(c).toBeLessThanOrEqual(0.95);
    }
  });

  it('runs the REAL answer check, so a wrong answer still fails without an API key', async () => {
    const provider = new MockVerificationProvider();
    const wrong = await provider.verify({ ...INPUT, submittedAnswer: 'nine spires' });
    expect(wrong.answerCorrect).toBe(false);

    const verdict = await verifySubmission(
      { ...SUBMISSION, observationAnswer: 'nine spires' },
      CHECKPOINT,
      provider,
    );
    expect(verdict.outcome).toBe('rejected');
    expect(verdict.reveal).toBeUndefined();
  });

  it('accepts the same fuzzy variants the real path accepts', async () => {
    const provider = new MockVerificationProvider();
    for (const answer of ['six spires', 'Six Spires.', ' 6 spires ', 'the six spires']) {
      const out = await provider.verify({ ...INPUT, submittedAnswer: answer });
      expect(out.answerCorrect).toBe(true);
    }
  });

  it('reports nothing observable when no photo was attached', async () => {
    const out = await new MockVerificationProvider().verify({ ...INPUT, imageBase64: '' });
    expect(out.landmarkMatch).toBe(false);
    expect(out.confidence).toBe(0);
    expect(out.mocked).toBe(true);
  });
});
