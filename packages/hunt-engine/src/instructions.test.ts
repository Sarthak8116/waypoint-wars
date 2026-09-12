import { describe, it, expect } from 'vitest';
import {
  INSTRUCTION_POOL,
  generateInstruction,
  generateInstructionSet,
  type InstructionInput,
} from './instructions.js';

const input: InstructionInput = {
  checkpointId: 'cp-market-square',
  playerId: 'player-ada',
  arrivalTime: 1_726_000_000_000,
};

describe('anti-cheat instruction generation', () => {
  it('always returns an instruction from the pool', () => {
    for (let i = 0; i < 50; i++) {
      const instruction = generateInstruction({ ...input, arrivalTime: input.arrivalTime + i * 997 });
      expect(INSTRUCTION_POOL).toContain(instruction);
    }
  });

  it('is stable for identical inputs, so a retry cannot reroll it', () => {
    const first = generateInstruction(input);
    for (let i = 0; i < 10; i++) expect(generateInstruction({ ...input })).toBe(first);
    // Sub-second jitter in the recorded arrival must not change it either.
    expect(generateInstruction({ ...input, arrivalTime: input.arrivalTime + 400 })).toBe(first);
  });

  it('differs across checkpoints for the same player and arrival', () => {
    const perCheckpoint = Array.from({ length: 12 }, (_, i) =>
      generateInstruction({ ...input, checkpointId: `cp-${i}` }),
    );
    expect(new Set(perCheckpoint).size).toBeGreaterThan(2);
    expect(perCheckpoint.some((x) => x !== perCheckpoint[0])).toBe(true);
  });

  it('differs across players at the same checkpoint', () => {
    const perPlayer = Array.from({ length: 12 }, (_, i) =>
      generateInstruction({ ...input, playerId: `player-${i}` }),
    );
    expect(new Set(perPlayer).size).toBeGreaterThan(2);
  });

  it('differs across arrivals more than a second apart', () => {
    const perArrival = Array.from({ length: 12 }, (_, i) =>
      generateInstruction({ ...input, arrivalTime: input.arrivalTime + i * 1000 }),
    );
    expect(new Set(perArrival).size).toBeGreaterThan(2);
  });

  it('survives a nonsensical arrival timestamp', () => {
    expect(INSTRUCTION_POOL).toContain(generateInstruction({ ...input, arrivalTime: Number.NaN }));
  });

  it('produces a distinct set when several instructions are requested', () => {
    const set = generateInstructionSet(input, 3);
    expect(set).toHaveLength(3);
    expect(new Set(set).size).toBe(3);
    expect(set[0]).toBe(generateInstruction(input));
    expect(generateInstructionSet(input, 999)).toHaveLength(INSTRUCTION_POOL.length);
    expect(generateInstructionSet(input, 0)).toHaveLength(1);
  });
});
