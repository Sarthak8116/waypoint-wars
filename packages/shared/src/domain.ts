/**
 * Core domain model for Waypoint Wars.
 *
 * This file is the single source of truth for every entity that crosses a
 * process boundary (web <-> colyseus <-> mongo <-> verification service).
 * Changing a type here is an architectural decision — record it in DECISIONS.md.
 */

// ---------------------------------------------------------------------------
// Geography
// ---------------------------------------------------------------------------

export interface LatLng {
  latitude: number;
  longitude: number;
}

/** A GPS sample recorded during an active hunt, used for the route replay. */
export interface LocationSample extends LatLng {
  /** Epoch milliseconds. */
  timestamp: number;
  /** Device-reported accuracy in metres, when available. */
  accuracyMeters?: number;
}

/**
 * A deliberately coarsened position broadcast to opponents.
 * The server NEVER broadcasts a raw LatLng of one player to another.
 */
export interface ApproximateRegion {
  /** Centre of the region, snapped to a coarse grid. */
  center: LatLng;
  /** Radius of ambiguity in metres (100–200 in the MVP). */
  radiusMeters: number;
}

// ---------------------------------------------------------------------------
// Hunt content
// ---------------------------------------------------------------------------

export type HuntTheme =
  | 'famous-landmarks'
  | 'hidden-history'
  | 'architecture'
  | 'strange-stories'
  | 'local-legends'
  | 'mixed';

/** Nominal hunt length. Determines which curated route set is offered. */
export type HuntDuration = 'quick-detour' | 'city-quest' | 'deep-dive';

export const HUNT_DURATION_MINUTES: Record<HuntDuration, number> = {
  'quick-detour': 30,
  'city-quest': 60,
  'deep-dive': 150,
};

export type ChallengeKind =
  | 'observe-detail'
  | 'count-feature'
  | 'missing-name'
  | 'recreate-pose'
  | 'then-and-now'
  | 'hidden-angle'
  | 'narrated-event';

/** A cited historical source shown in the post-completion reveal. */
export interface HistoricalSource {
  title: string;
  url?: string;
  publisher?: string;
  /** True when retrieved via Querit rather than hand-entered. */
  retrieved?: boolean;
}

/**
 * The three-layer checkpoint: clue (find it), challenge (prove you're there),
 * reveal (earn the story).
 */
export interface Checkpoint {
  id: string;
  /** Human-readable name — shown only AFTER completion, never in the clue. */
  name: string;
  latitude: number;
  longitude: number;

  // --- Layer 1: the clue ---
  clue: string;
  hint: string;

  // --- Layer 2: the challenge ---
  challengeKind: ChallengeKind;
  observationQuestion: string;
  /** Lowercased, trimmed candidate answers. Matching is fuzzy, server-side. */
  acceptedAnswers: string[];
  photoRequirement: string;
  /** What the landmark should look like, passed to Gemini as grounding text. */
  landmarkDescription: string;
  /** Optional reference image path/URL for visual grounding. */
  referenceImageUrl?: string;

  // --- Layer 3: the reveal ---
  historicalReveal: string;
  sources: HistoricalSource[];
  /** An extra detail worth bonus XP if the player notices it. */
  hiddenDetail?: string;

  // --- Scoring + geofence ---
  radiusMeters: number;
  baseXp: number;
  expectedCompletionSeconds: number;
}

/** An ordered sequence of checkpoints ending at the shared destination. */
export interface Route {
  id: string;
  huntId: string;
  label: string;
  /** Ordered checkpoint ids. All routes in a hunt share a length. */
  checkpointIds: string[];
  /** Rough walking distance, for balance auditing. */
  approxDistanceMeters: number;
  approxDurationSeconds: number;
}

export interface Hunt {
  id: string;
  title: string;
  city: string;
  theme: HuntTheme;
  duration: HuntDuration;
  description: string;
  /** Every route in the hunt terminates here. */
  finalDestination: Checkpoint;
  routeIds: string[];
  published: boolean;
}

// ---------------------------------------------------------------------------
// Players and rooms
// ---------------------------------------------------------------------------

export type GameMode = 'solo' | 'individual-race' | 'team-race';

export interface Player {
  id: string;
  sessionId: string;
  name: string;
  teamId?: string;
  routeId: string;
  /** Index into the assigned route's checkpointIds. */
  checkpointIndex: number;
  xp: number;
  hintsUsed: number;
  incorrectAttempts: number;
  finished: boolean;
  finishedAt?: number;
  connected: boolean;
}

export interface Team {
  id: string;
  name: string;
  memberIds: string[];
  routeId: string;
  xp: number;
  checkpointIndex: number;
  finished: boolean;
}

export interface RoomSettings {
  huntId: string;
  duration: HuntDuration;
  mode: GameMode;
  maxPlayers: number;
  hintsEnabled: boolean;
}

export interface GameRoomState {
  code: string;
  settings: RoomSettings;
  /** Authoritative, server-assigned. Null until the host starts. */
  startedAt: number | null;
  finishedAt: number | null;
  players: Player[];
  teams: Team[];
}

// ---------------------------------------------------------------------------
// Submission + verification
// ---------------------------------------------------------------------------

export interface CheckpointSubmission {
  checkpointId: string;
  /** Base64 data URL or object-store key. */
  image: string;
  latitude: number;
  longitude: number;
  observationAnswer: string;
  /** Issued on arrival, not at hunt start — see DECISIONS.md. */
  randomizedInstruction: string;
  submittedAt: number;
}

/**
 * Gemini's structured judgement. Note it carries NO xp field:
 * the model reports observations, the server decides rewards.
 */
export interface VerificationResult {
  landmarkMatch: boolean;
  requiredActionCompleted: boolean;
  answerCorrect: boolean;
  /** 0..1 */
  confidence: number;
  reason: string;
  /** True when the response came from the labeled mock, not real Gemini. */
  mocked: boolean;
}

export type SubmissionOutcome = 'approved' | 'rejected' | 'needs-review';

/** The server's decision, derived from VerificationResult + geofence check. */
export interface SubmissionVerdict {
  outcome: SubmissionOutcome;
  verification: VerificationResult;
  withinRadius: boolean;
  distanceMeters: number;
  xpDelta: number;
  xpBreakdown: XpBreakdown;
  /** Populated only on approval. */
  reveal?: {
    name: string;
    historicalReveal: string;
    sources: HistoricalSource[];
    hiddenDetail?: string;
  };
  message: string;
}

// ---------------------------------------------------------------------------
// Scoring
// ---------------------------------------------------------------------------

export interface XpBreakdown {
  checkpointCompletion: number;
  correctObservation: number;
  speedBonus: number;
  noHintBonus: number;
  hiddenDetailBonus: number;
  incorrectPenalty: number;
  hintPenalty: number;
  routeCompletionBonus: number;
  total: number;
}

export const XP_RULES = {
  CHECKPOINT_COMPLETION: 100,
  CORRECT_OBSERVATION: 50,
  SPEED_BONUS_MAX: 50,
  NO_HINT_BONUS: 25,
  HIDDEN_DETAIL_BONUS: 25,
  INCORRECT_PENALTY: -15,
  HINT_PENALTY: -20,
  ROUTE_COMPLETION_BONUS: 150,
} as const;

// ---------------------------------------------------------------------------
// Results
// ---------------------------------------------------------------------------

export interface CompletedCheckpoint {
  checkpointId: string;
  completedAt: number;
  durationSeconds: number;
  xpAwarded: number;
  hintUsed: boolean;
  incorrectAttempts: number;
}

export interface CompletedRun {
  id: string;
  huntId: string;
  routeId: string;
  playerId: string;
  playerName: string;
  teamId?: string;
  mode: GameMode;
  startedAt: number;
  finishedAt: number;
  totalXp: number;
  checkpoints: CompletedCheckpoint[];
  /** Downsampled breadcrumb trail for the replay. */
  path: LocationSample[];
  achievements: string[];
}

export interface LeaderboardEntry {
  rank: number;
  playerId: string;
  displayName: string;
  isTeam: boolean;
  xp: number;
  checkpointsCompleted: number;
  totalCheckpoints: number;
  hintsUsed: number;
  finished: boolean;
}
