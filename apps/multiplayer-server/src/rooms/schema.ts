/**
 * Colyseus room state.
 *
 * ---------------------------------------------------------------------------
 * EVERYTHING IN THIS FILE IS PUBLIC TO EVERY CLIENT IN THE ROOM.
 *
 * Colyseus broadcasts the whole schema to every connected client on every
 * patch. There is no per-client filtering here, so a field added to these
 * classes is a field every opponent can read out of their network tab. That
 * makes this file the privacy boundary for the entire multiplayer feature.
 *
 * Deliberately ABSENT, and it must stay that way:
 *   - `routeId` / `checkpointIds`  — which route a player drew, and its content
 *   - `acceptedAnswers`            — the answers
 *   - `hint` / `hints`             — hint text
 *   - `historicalReveal`/`sources` — the earned payload
 *   - raw `latitude` / `longitude` — a player's actual position
 *   - the active checkpoint's id or clue
 *
 * All of those travel by targeted `client.send()` from HuntRoom instead. The
 * only geography here is `RegionState`, which is already grid-snapped by
 * `toApproximateRegion()` (DECISIONS.md D9) and is what opponents are meant
 * to see.
 *
 * The non-decorator `defineTypes` API is used rather than `@type` decorators:
 * it needs no transpiler configuration, so the same classes behave identically
 * under tsc, tsx and vitest's esbuild pipeline.
 * ---------------------------------------------------------------------------
 */

import { ArraySchema, MapSchema, Schema, defineTypes } from '@colyseus/schema';

/**
 * A grid-snapped position. Never a raw fix.
 * `hasRegion` is false when the player has opted out of sharing, or has not
 * reported a position yet — schema has no null, so the flag carries the
 * distinction instead of a sentinel coordinate.
 */
export class RegionState extends Schema {
  latitude = 0;
  longitude = 0;
  radiusMeters = 0;
  hasRegion = false;
}

defineTypes(RegionState, {
  latitude: 'number',
  longitude: 'number',
  radiusMeters: 'number',
  hasRegion: 'boolean',
});

/**
 * One player, as everyone in the room sees them.
 *
 * `checkpointIndex` and `xp` are here because opponent progress is the point of
 * the race — but they are written ONLY by HuntRoom from hunt-engine output.
 * There is no client message that can set either one.
 */
export class PlayerState extends Schema {
  id = '';
  sessionId = '';
  name = '';
  /** '' when the player is not on a team (individual-race). */
  teamId = '';
  /** Index into the player's own route. The route itself is never published. */
  checkpointIndex = 0;
  totalCheckpoints = 0;
  xp = 0;
  hintsUsed = 0;
  incorrectAttempts = 0;
  finished = false;
  /** 0 until finished. */
  finishedAt = 0;
  /** False while a disconnected player is inside their reconnection window. */
  connected = true;
  isHost = false;
  sharingLocation = true;
  /** 0 until the first leaderboard is computed. */
  rank = 0;
  region: RegionState = new RegionState();
}

defineTypes(PlayerState, {
  id: 'string',
  sessionId: 'string',
  name: 'string',
  teamId: 'string',
  checkpointIndex: 'number',
  totalCheckpoints: 'number',
  xp: 'number',
  hintsUsed: 'number',
  incorrectAttempts: 'number',
  finished: 'boolean',
  finishedAt: 'number',
  connected: 'boolean',
  isHost: 'boolean',
  sharingLocation: 'boolean',
  rank: 'number',
  region: RegionState,
});

/**
 * A team in `team-race`: one shared route, one shared XP total, one
 * leaderboard entry. The route id is absent here for the same reason it is
 * absent from PlayerState.
 */
export class TeamState extends Schema {
  id = '';
  name = '';
  xp = 0;
  checkpointIndex = 0;
  totalCheckpoints = 0;
  hintsUsed = 0;
  finished = false;
  finishedAt = 0;
  rank = 0;
  memberIds: ArraySchema<string> = new ArraySchema<string>();
}

defineTypes(TeamState, {
  id: 'string',
  name: 'string',
  xp: 'number',
  checkpointIndex: 'number',
  totalCheckpoints: 'number',
  hintsUsed: 'number',
  finished: 'boolean',
  finishedAt: 'number',
  rank: 'number',
  memberIds: ['string'],
});

export class RoomSettingsState extends Schema {
  huntId = '';
  /** GameMode, as a string because schema has no union type. */
  mode = 'individual-race';
  duration = 'city-quest';
  maxPlayers = 8;
  hintsEnabled = true;
}

defineTypes(RoomSettingsState, {
  huntId: 'string',
  mode: 'string',
  duration: 'string',
  maxPlayers: 'number',
  hintsEnabled: 'boolean',
});

export class HuntRoomState extends Schema {
  /** Six characters from ROOM_CODE_ALPHABET. */
  code = '';
  settings: RoomSettingsState = new RoomSettingsState();
  /** Server-stamped at `start_hunt`. 0 means "not started" — never a client clock. */
  startedAt = 0;
  finishedAt = 0;
  /** Only this session may start the hunt. */
  hostSessionId = '';
  players: MapSchema<PlayerState> = new MapSchema<PlayerState>();
  teams: MapSchema<TeamState> = new MapSchema<TeamState>();
  /**
   * Leaderboard ordering: entry ids (player ids, or team ids in team-race)
   * best-first. Kept as an ordering rather than duplicated rows so there is
   * exactly one copy of every score.
   */
  leaderboard: ArraySchema<string> = new ArraySchema<string>();
}

defineTypes(HuntRoomState, {
  code: 'string',
  settings: RoomSettingsState,
  startedAt: 'number',
  finishedAt: 'number',
  hostSessionId: 'string',
  players: { map: PlayerState },
  teams: { map: TeamState },
  leaderboard: ['string'],
});
