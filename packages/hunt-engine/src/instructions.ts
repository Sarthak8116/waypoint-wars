/**
 * Randomized anti-cheat photo instructions.
 *
 * ---------------------------------------------------------------------------
 * THIS IS A DETERRENT, NOT PROOF.
 *
 * A randomized instruction ("hold up two fingers", "include something red")
 * raises the cost of faking a checkpoint: a stock photo from the internet, a
 * screenshot, or a picture taken yesterday will not satisfy an instruction the
 * player could not have known in advance. That is all it does. A determined
 * cheat with a confederate on site, or with image editing, will beat it.
 *
 * It must therefore never be the only control. Real confidence comes from the
 * combination of: server-side geofence, the instruction being issued only ON
 * ARRIVAL, Gemini's landmark match, and the observation answer. The server
 * combines all of them; none is individually sufficient, and Gemini's verdict
 * alone never awards XP.
 * ---------------------------------------------------------------------------
 *
 * The instruction is derived deterministically from
 * (checkpointId, playerId, arrivalTime) so that:
 *   - retrying a rejected submission shows the SAME instruction (otherwise a
 *     player could reroll until they got an easy one), and
 *   - the browser and the server derive the same string without an extra round
 *     trip, and a server restart mid-checkpoint does not change it.
 * It is unpredictable in advance because arrivalTime is not known until the
 * player physically arrives.
 */

import { hashString } from './random.js';

export const INSTRUCTION_POOL: readonly string[] = [
  'Hold up two fingers in the shot.',
  'Include something red in the shot.',
  'Point toward the building name or street sign.',
  'Recreate the pose of a statue or figure you can see.',
  'Include every teammate with you in the photo.',
  'Hold up three fingers in the shot.',
  'Put your hand flat against the wall or railing in frame.',
  'Take the photo from a low angle, looking upward.',
  'Include your shoes and the ground you are standing on.',
  'Give a thumbs-down next to the landmark.',
  'Frame the landmark so it fills the left half of the photo.',
  'Include something with writing on it that you can read.',
] as const;

export interface InstructionInput {
  checkpointId: string;
  playerId: string;
  /** Epoch ms when the player arrived. Recorded once, reused on every retry. */
  arrivalTime: number;
}

/**
 * Bucketed to whole seconds so a caller that re-derives the instruction from a
 * slightly different millisecond reading still lands on the same entry.
 */
function seedFor(input: InstructionInput): number {
  const bucket = Number.isFinite(input.arrivalTime) ? Math.floor(input.arrivalTime / 1000) : 0;
  return hashString(`${input.checkpointId}|${input.playerId}|${bucket}`);
}

/** Stable for identical inputs; unpredictable before arrival. */
export function generateInstruction(input: InstructionInput): string {
  const index = seedFor(input) % INSTRUCTION_POOL.length;
  return INSTRUCTION_POOL[index] as string;
}

/**
 * `count` distinct instructions for the same arrival, walking the pool from
 * the derived offset. Used where one action is too easy to fake (team mode).
 */
export function generateInstructionSet(input: InstructionInput, count: number): string[] {
  const wanted = Math.max(1, Math.min(INSTRUCTION_POOL.length, Math.trunc(count) || 1));
  const start = seedFor(input) % INSTRUCTION_POOL.length;
  const out: string[] = [];
  for (let i = 0; i < wanted; i++) {
    out.push(INSTRUCTION_POOL[(start + i) % INSTRUCTION_POOL.length] as string);
  }
  return out;
}
