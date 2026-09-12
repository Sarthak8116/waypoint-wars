/**
 * Six-character join codes.
 *
 * The alphabet comes from @ww/shared and omits O/0/I/1, because the code is
 * read off a phone screen and typed into another phone, or dictated across a
 * noisy room. Ambiguous glyphs turn a join into a support call.
 *
 * Codes are also the demo's reproducibility seed: `assignRoutes` is seeded from
 * the room code, so the same code always produces the same route allocation.
 * That means a code must be unique across LIVE rooms (two rooms sharing a code
 * would be unjoinable), which the registry below enforces.
 */

import { randomInt } from 'node:crypto';
import { ROOM_CODE_ALPHABET, ROOM_CODE_LENGTH } from '@ww/shared';

export const CODE_ALPHABET = ROOM_CODE_ALPHABET;
export const CODE_LENGTH = ROOM_CODE_LENGTH;

/** Characters a human confuses with another character in the alphabet. */
export const AMBIGUOUS_CHARACTERS = ['O', '0', 'I', '1'] as const;

/**
 * `crypto.randomInt` rather than `Math.random`: the code is the only thing
 * standing between a stranger and a room, and a predictable PRNG makes codes
 * enumerable. (hunt-engine's seeded RNG is for reproducible GAME logic; this is
 * a security boundary and wants real entropy.)
 */
export function generateRoomCode(length: number = CODE_LENGTH): string {
  let out = '';
  for (let i = 0; i < length; i++) {
    out += CODE_ALPHABET[randomInt(CODE_ALPHABET.length)];
  }
  return out;
}

export function isValidRoomCode(code: unknown): code is string {
  if (typeof code !== 'string' || code.length !== CODE_LENGTH) return false;
  for (const char of code) {
    if (!CODE_ALPHABET.includes(char)) return false;
  }
  return true;
}

/**
 * Live-room code registry.
 *
 * Also serves code -> roomId lookups for `GET /api/rooms/:code`, so a player
 * can type a code instead of pasting a room id. Entries are removed in
 * `onDispose`, so a code is reusable once its room is gone.
 */
export class RoomCodeRegistry {
  private readonly byCode = new Map<string, string>();

  get size(): number {
    return this.byCode.size;
  }

  has(code: string): boolean {
    return this.byCode.has(code.toUpperCase());
  }

  roomIdFor(code: string): string | undefined {
    return this.byCode.get(code.toUpperCase());
  }

  /**
   * Claim an unused code. Collisions are astronomically unlikely (32^6 ~= 1.07
   * billion) but a collision is a broken join, not a rare annoyance, so we
   * check rather than hope. The bounded retry exists so a pathological registry
   * cannot spin forever; it throws instead of returning a duplicate.
   */
  claim(roomId: string, attempts = 32): string {
    for (let i = 0; i < attempts; i++) {
      const code = generateRoomCode();
      if (!this.byCode.has(code)) {
        this.byCode.set(code, roomId);
        return code;
      }
    }
    throw new Error(`Could not allocate a unique room code after ${attempts} attempts.`);
  }

  release(code: string): void {
    this.byCode.delete(code.toUpperCase());
  }

  clear(): void {
    this.byCode.clear();
  }
}

/** Process-wide registry shared by HuntRoom and the HTTP lookup endpoint. */
export const roomCodes = new RoomCodeRegistry();
