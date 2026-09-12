import { describe, expect, it } from 'vitest';
import { ROOM_CODE_ALPHABET, ROOM_CODE_LENGTH } from '@ww/shared';
import {
  AMBIGUOUS_CHARACTERS,
  RoomCodeRegistry,
  generateRoomCode,
  isValidRoomCode,
} from './room-codes.js';

describe('room codes', () => {
  it('uses the shared unambiguous alphabet and length', () => {
    expect(ROOM_CODE_LENGTH).toBe(6);
    for (const char of AMBIGUOUS_CHARACTERS) {
      expect(ROOM_CODE_ALPHABET).not.toContain(char);
    }
  });

  it('never generates an ambiguous character', () => {
    // 2000 codes is 12000 characters: if O/0/I/1 were reachable at all, the
    // chance of not seeing one here is effectively zero.
    for (let i = 0; i < 2000; i++) {
      const code = generateRoomCode();
      expect(code).toHaveLength(ROOM_CODE_LENGTH);
      expect(code).toMatch(/^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{6}$/);
      for (const char of AMBIGUOUS_CHARACTERS) {
        expect(code).not.toContain(char);
      }
    }
  });

  it('rejects codes of the wrong shape', () => {
    expect(isValidRoomCode('ABCDEF')).toBe(true);
    expect(isValidRoomCode('ABCDE')).toBe(false);
    expect(isValidRoomCode('ABCDEFG')).toBe(false);
    expect(isValidRoomCode('ABCDE0')).toBe(false);
    expect(isValidRoomCode('ABCDEO')).toBe(false);
    expect(isValidRoomCode('abcdef')).toBe(false);
    expect(isValidRoomCode(123456)).toBe(false);
    expect(isValidRoomCode(undefined)).toBe(false);
  });

  it('hands out a unique code to every concurrent room', () => {
    const registry = new RoomCodeRegistry();
    const codes = new Set<string>();

    for (let i = 0; i < 500; i++) {
      const code = registry.claim(`room_${i}`);
      expect(codes.has(code)).toBe(false);
      codes.add(code);
      expect(registry.roomIdFor(code)).toBe(`room_${i}`);
    }

    expect(codes.size).toBe(500);
    expect(registry.size).toBe(500);
  });

  it('resolves codes case-insensitively so a typed code works', () => {
    const registry = new RoomCodeRegistry();
    const code = registry.claim('room_a');
    expect(registry.roomIdFor(code.toLowerCase())).toBe('room_a');
    expect(registry.has(code.toLowerCase())).toBe(true);
  });

  it('frees a code once its room is disposed', () => {
    const registry = new RoomCodeRegistry();
    const code = registry.claim('room_a');
    registry.release(code);
    expect(registry.roomIdFor(code)).toBeUndefined();
    expect(registry.size).toBe(0);
  });

  it('throws rather than issuing a duplicate when it runs out of attempts', () => {
    const registry = new RoomCodeRegistry();
    // A room without a code is a bug the operator should hear about; a room
    // sharing another room's code is a join that silently lands in the wrong
    // game. The bounded retry must fail loudly rather than return a duplicate.
    expect(() => registry.claim('room_a', 0)).toThrow(/unique room code/i);
    expect(registry.size).toBe(0);
  });
});
