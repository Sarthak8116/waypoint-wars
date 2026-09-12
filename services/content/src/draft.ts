/**
 * Turn a verified place into a playable checkpoint.
 *
 * THE DIVISION OF LABOUR, restated because it is the whole safety model:
 * OpenStreetMap owns WHERE. Gemini owns WHAT TO SAY ABOUT IT. Nothing the
 * model returns is allowed to move a checkpoint, and the prompt never asks it
 * for a coordinate.
 *
 * The model is also told, explicitly, to write an observation question about a
 * detail it is CONFIDENT is there — and to say so when it is not confident,
 * rather than inventing a plaque. A fabricated detail is the worst failure
 * this system has: the player stands in the right place, looks for something
 * that does not exist, and concludes the app is broken.
 */

import { GoogleGenAI, ThinkingLevel } from '@google/genai';
import type { ChallengeKind, Checkpoint, HistoricalSource } from '@ww/shared';
import type { Place } from './places.js';

export const DRAFT_MODEL_ID = process.env.GEMINI_MODEL_ID ?? 'gemini-3.6-flash';

/** Matches the verification service; see its notes on erratic latency. */
const TIMEOUT_MS = 45_000;

const SYSTEM_INSTRUCTION = `You write checkpoints for a walking scavenger hunt.

You are given a REAL place with REAL coordinates from OpenStreetMap. Your job
is to write the words around it. You must NEVER supply or alter a coordinate.

For each place produce:

1. clue — leads a player to the place WITHOUT naming it. Evocative, concrete,
   2 sentences maximum. A stranger to the city should be able to follow it.

2. observationQuestion — answerable ONLY by standing there and looking. It must
   be about a DURABLE, OBVIOUS physical feature: a count of something, a
   material, a colour, a shape, a cardinal direction. NEVER invent a plaque,
   an inscription, a statue's pose, or fine detail you are not sure exists.
   DO NOT NAME THE PLACE in the question. The clue deliberately withholds the
   name; a question that says "the courthouse" hands it straight back. Say
   "this building", "the tower", "the entrance" instead.

3. acceptedAnswers — lowercase, 2 to 6 natural variants a player might type.
   Avoid numbers above twenty; the matcher does not compose "twenty-four".

4. photoRequirement — one sentence: what must be in frame.

5. landmarkDescription — what the place physically LOOKS like, concretely, so
   another model can match a photograph against it.

6. historicalReveal — 2 to 4 sentences of genuine interest, shown only AFTER
   the player succeeds. State only what you are confident is true. Mark any
   folklore explicitly as legend. If you know little, say less — a short
   honest reveal beats an invented one.

7. confidence — "high" if you are sure the observable exists and the history is
   accurate; "low" if you are guessing. BE HONEST. Low-confidence drafts are
   shown to a human for review, which is the correct outcome. A confident
   fabrication is the worst thing you can produce.`;

const RESPONSE_SCHEMA = {
  type: 'object',
  properties: {
    clue: { type: 'string' },
    observationQuestion: { type: 'string' },
    acceptedAnswers: { type: 'array', items: { type: 'string' } },
    photoRequirement: { type: 'string' },
    landmarkDescription: { type: 'string' },
    historicalReveal: { type: 'string' },
    hint: { type: 'string' },
    challengeKind: {
      type: 'string',
      enum: [
        'observe-detail',
        'count-feature',
        'missing-name',
        'recreate-pose',
        'then-and-now',
        'hidden-angle',
        'narrated-event',
      ],
    },
    confidence: { type: 'string', enum: ['high', 'low'] },
  },
  required: [
    'clue',
    'observationQuestion',
    'acceptedAnswers',
    'photoRequirement',
    'landmarkDescription',
    'historicalReveal',
    'hint',
    'challengeKind',
    'confidence',
  ],
} as const;

export interface DraftedCheckpoint {
  checkpoint: Checkpoint;
  /** Low-confidence drafts must be reviewed before a hunt is published. */
  needsReview: boolean;
  /** True when produced by the labelled mock rather than the real model. */
  mocked: boolean;
}

export interface DraftOptions {
  /** Seconds a player is expected to need, walk included. */
  expectedCompletionSeconds?: number;
  radiusMeters?: number;
  baseXp?: number;
}

interface RawDraft {
  clue: string;
  observationQuestion: string;
  acceptedAnswers: string[];
  photoRequirement: string;
  landmarkDescription: string;
  historicalReveal: string;
  hint: string;
  challengeKind: ChallengeKind;
  confidence: 'high' | 'low';
}

/**
 * Replace the landmark's name in a question with a neutral noun.
 *
 * Only acts on the DISTINCTIVE part of the name — "Courthouse" from
 * "Miami-Dade County Courthouse" — because the generic tail is usually the
 * word a rewritten question wants anyway.
 */
export function stripPlaceName(question: string, placeName: string): string {
  const full = placeName.trim();
  if (!full) return question;

  const words = full.split(/\s+/).filter(Boolean);

  /**
   * Candidates, longest first so a partial match cannot fragment the sentence:
   *   · the whole name
   *   · the part before "at/of/in/on" ("Freedom Tower at X" -> "Freedom Tower")
   *   · the TRAILING noun ("Miami-Dade County Courthouse" -> "Courthouse"),
   *     which is what a model actually writes when it shortens the name, and
   *     was the case this guard missed on its first pass
   */
  const tail = words.at(-1) ?? '';
  const lastTwo = words.slice(-2).join(' ');

  const candidates = [full, ...full.split(/\s+(?:at|of|in|on)\s+/i), lastTwo, tail]
    .map((c) => c.trim())
    .filter((c) => c.length > 4 && !GENERIC_WORDS.has(c.toLowerCase()))
    .sort((a, b) => b.length - a.length);

  let out = question;
  for (const c of candidates) {
    const escaped = c.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    out = out.replace(new RegExp(`\\b(the\\s+)?${escaped}\\b`, 'gi'), 'this place');
  }

  return out
    .replace(/\bthe\s+this place\b/gi, 'this place')
    .replace(/\bthis place\s+this place\b/gi, 'this place')
    .replace(/\s{2,}/g, ' ');
}

/**
 * Words too generic to strip. Removing "Park" from "How many benches are in
 * the park?" would destroy the question rather than protect it.
 */
const GENERIC_WORDS = new Set([
  'park',
  'garden',
  'plaza',
  'square',
  'street',
  'avenue',
  'building',
  'center',
  'centre',
  'house',
  'hall',
  'place',
  'memorial',
  'monument',
  'statue',
  'church',
  'museum',
]);

function sourcesFor(place: Place): HistoricalSource[] {
  const out: HistoricalSource[] = [
    { title: 'OpenStreetMap contributors', url: 'https://www.openstreetmap.org/copyright' },
  ];
  const wiki = place.tags['wikipedia'];
  if (wiki) {
    const [lang, ...rest] = wiki.split(':');
    if (lang && rest.length) {
      out.unshift({
        title: rest.join(':'),
        url: `https://${lang}.wikipedia.org/wiki/${encodeURIComponent(rest.join(':').replace(/ /g, '_'))}`,
      });
    }
  }
  const site = place.tags['website'];
  if (site) out.push({ title: place.name, url: site });
  return out;
}

/**
 * Assemble a Checkpoint from a verified place plus drafted words.
 * Coordinates come from `place` and nowhere else.
 */
function assemble(place: Place, raw: RawDraft, opts: DraftOptions): Checkpoint {
  return {
    id: `cp_${place.id}`,
    name: place.name,
    // NOT from the model. Ever.
    latitude: place.latitude,
    longitude: place.longitude,

    clue: raw.clue.trim(),
    hint: raw.hint.trim(),
    hints: [{ text: raw.hint.trim(), costXp: -20 }],

    challengeKind: raw.challengeKind,
    // The model is told not to name the place in the question, and mostly
    // obeys. This catches the rest: a question naming the landmark defeats the
    // clue that was written to withhold it.
    observationQuestion: stripPlaceName(raw.observationQuestion.trim(), place.name),
    acceptedAnswers: [...new Set(raw.acceptedAnswers.map((a) => a.toLowerCase().trim()))].filter(
      Boolean,
    ),
    photoRequirement: raw.photoRequirement.trim(),
    landmarkDescription: raw.landmarkDescription.trim(),

    historicalReveal: raw.historicalReveal.trim(),
    sources: sourcesFor(place),

    radiusMeters: opts.radiusMeters ?? 55,
    baseXp: opts.baseXp ?? 100,
    expectedCompletionSeconds: opts.expectedCompletionSeconds ?? 360,

    realWorldLocation: `${place.name} (${place.kind})`,
  };
}

/**
 * Deterministic labelled fallback, used when no API key is present.
 *
 * It produces a PLAYABLE but obviously-placeholder checkpoint and always sets
 * `needsReview`, so a generated hunt is never silently full of filler that
 * looks authored.
 */
function mockDraft(place: Place): RawDraft {
  return {
    clue: `[DRAFT] Find ${place.name}. Look for the ${place.kind} about ${place.distanceMeters} metres from where you started.`,
    observationQuestion: `[DRAFT] What material is ${place.name} mostly built from?`,
    acceptedAnswers: ['stone', 'brick', 'steel', 'concrete', 'glass', 'wood'],
    photoRequirement: `Photograph ${place.name} so the whole structure is in frame.`,
    landmarkDescription: `${place.name}, a ${place.kind} in the area.`,
    historicalReveal: `[DRAFT — no AI key configured] ${place.name} is tagged in OpenStreetMap as ${place.kind}. Generate with GEMINI_API_KEY set for real history.`,
    hint: `[DRAFT] It is the ${place.kind} nearby.`,
    challengeKind: 'observe-detail',
    confidence: 'low',
  };
}

export interface Drafter {
  draft(place: Place, opts?: DraftOptions): Promise<DraftedCheckpoint>;
  readonly mocked: boolean;
}

class GeminiDrafter implements Drafter {
  readonly mocked = false;
  private readonly ai: GoogleGenAI;

  constructor(apiKey: string) {
    this.ai = new GoogleGenAI({ apiKey });
  }

  async draft(place: Place, opts: DraftOptions = {}): Promise<DraftedCheckpoint> {
    const context = [
      `Place name: ${place.name}`,
      `OpenStreetMap kind: ${place.kind}`,
      `Tags: ${Object.entries(place.tags)
        .filter(([k]) => !k.startsWith('addr:'))
        .slice(0, 14)
        .map(([k, v]) => `${k}=${v}`)
        .join(', ')}`,
    ].join('\n');

    try {
      const res = await this.ai.models.generateContent({
        model: DRAFT_MODEL_ID,
        contents: [{ role: 'user', parts: [{ text: context }] }],
        config: {
          systemInstruction: SYSTEM_INSTRUCTION,
          temperature: 0.7, // some variety across checkpoints; not zero
          responseMimeType: 'application/json',
          responseSchema: RESPONSE_SCHEMA as never,
          // Minimal thinking: this is bounded copywriting, and extended
          // reasoning only adds latency across ~15 sequential calls.
          thinkingConfig: { thinkingLevel: ThinkingLevel.MINIMAL },
          httpOptions: { timeout: TIMEOUT_MS },
        },
      });

      const raw = JSON.parse(res.text ?? '{}') as RawDraft;
      if (!raw.clue || !raw.observationQuestion || !raw.acceptedAnswers?.length) {
        throw new Error('incomplete draft');
      }

      return {
        checkpoint: assemble(place, raw, opts),
        needsReview: raw.confidence !== 'high',
        mocked: false,
      };
    } catch {
      // A failed draft degrades to the labelled placeholder and is flagged for
      // review — never to a silent gap in the route.
      return { checkpoint: assemble(place, mockDraft(place), opts), needsReview: true, mocked: true };
    }
  }
}

class MockDrafter implements Drafter {
  readonly mocked = true;
  async draft(place: Place, opts: DraftOptions = {}): Promise<DraftedCheckpoint> {
    return { checkpoint: assemble(place, mockDraft(place), opts), needsReview: true, mocked: true };
  }
}

export function createDrafter(apiKey = process.env.GEMINI_API_KEY): Drafter {
  if (apiKey) {
    console.log('[content] GEMINI_API_KEY detected — drafting with the real model.');
    return new GeminiDrafter(apiKey);
  }
  console.log('[content] no GEMINI_API_KEY — drafting labelled placeholders.');
  return new MockDrafter();
}
