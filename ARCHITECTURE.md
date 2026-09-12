# Architecture

## The one rule

**Each layer owns exactly one thing.** Most bugs in a stack this wide come from
two layers thinking they own the same state. The boundaries below are not
stylistic — they are the reason this is buildable in a night.

```
┌─────────────────────────────────────────────────────────┐
│  apps/web  (Next.js, React)                             │
│  Owns: navigation, camera, forms, permissions, layout   │
│  ┌───────────────────────┐  ┌────────────────────────┐  │
│  │ MapLibre              │  │ Phaser (packages/game) │  │
│  │ Owns: GEOGRAPHY       │  │ Owns: PRESENTATION     │  │
│  │ player marker, radii, │  │ XP anim, timer, FX,    │  │
│  │ polylines, replay path│  │ results scene          │  │
│  │ Owns NO game state    │  │ Owns NO game state     │  │
│  └───────────────────────┘  └────────────────────────┘  │
└────────────────────────┬────────────────────────────────┘
                         │ ClientMessage / ServerMessage
┌────────────────────────┴────────────────────────────────┐
│  apps/multiplayer-server  (Colyseus + Express)          │
│  Owns: AUTHORITATIVE STATE                              │
│  start time · route assignment · XP · hints · progress  │
│  · leaderboard · geofence validation · API keys         │
└────────┬─────────────────────────────┬──────────────────┘
         │                             │
┌────────┴──────────┐      ┌───────────┴───────────────┐
│ packages/         │      │ services/verification     │
│   hunt-engine     │      │ Gemini. Returns a         │
│ Pure functions.   │      │ JUDGEMENT, never XP.      │
│ Scoring, FSM,     │      └───────────────────────────┘
│ route assignment  │      ┌───────────────────────────┐
│ No I/O, no time   │      │ services/content          │
└───────────────────┘      │ Querit + ElevenLabs       │
                           └───────────────────────────┘
         ┌─────────────────────────────────────┐
         │ packages/shared — the contract      │
         │ imported by literally everything    │
         └─────────────────────────────────────┘
```

## Why each boundary exists

### MapLibre owns geography, Phaser owns feelings
The tempting mistake is to draw the player marker in Phaser so it can be
animated. Don't. The moment two systems both believe they know where the player
is, they drift, and debugging that costs more than the animation is worth.
MapLibre draws anything with a coordinate. Phaser draws anything with a number
that should feel good going up.

### Phaser holds no state
Phaser receives `GameEvent`s and animates. It never decides anything. If Phaser
is destroyed and recreated mid-hunt, nothing is lost. This makes the HUD safe to
unmount, and it makes the results scene replayable.

### The server owns XP, and Gemini does not
`VerificationResult` has no `xp` field, deliberately. The model reports what it
sees — `landmarkMatch`, `requiredActionCompleted`, `answerCorrect`, `confidence`
— and the server combines that with a geofence check it performed itself to
decide the reward. A model that can be talked into awarding points is a model
that will be talked into awarding points.

### hunt-engine is pure
No `Date.now()`, no `Math.random()` without a seed, no network, no DOM. Every
time value is a parameter. This is why the scoring rules are testable, why the
demo is reproducible, and why the same code runs in the browser for solo mode
and on the server for multiplayer without a second implementation.

### Two shapes of Checkpoint
`Checkpoint` (full, server-side) and `PublicCheckpoint` (what a browser may see).
`toPublicCheckpoint()` strips `acceptedAnswers`, `historicalReveal`, `hint`, and
`hiddenDetail`. Without this split, the answers are in the network tab and the
game is over. The reveal is sent only after the server approves a submission.

## Fairness: why normalized XP instead of finishing time

Players walk **different routes**, so raw elapsed time is not comparable and
"first to finish" is meaningless. Instead the speed bonus is computed per
checkpoint against that checkpoint's own `expectedCompletionSeconds`:

```
speedRatio = expectedCompletionSeconds / actualSeconds   (clamped)
```

A player who beats expectations on a hard checkpoint earns the same as one who
beats expectations on an easy one. The clamp exists so a single suspiciously
fast checkpoint (bad GPS, a lucky guess) cannot dominate the leaderboard.

## Privacy: grid-snapping, not noise

Opponents see an `ApproximateRegion`, never a `LatLng`. The region is produced by
snapping to a ~150m grid rather than by adding random jitter — jitter can be
averaged away by an opponent sampling repeatedly while a target stands still,
whereas a snapped cell is stable and reveals nothing finer than the cell.

## Anti-cheat: honest limits

Randomized instructions are issued **on arrival**, not at hunt start, so they
cannot be staged in advance. Combined with GPS and landmark matching, this makes
faking a checkpoint expensive. It does **not** make it impossible, and the README
says so. A determined cheater with a friend downtown wins. That is an acceptable
trade for a hackathon MVP, but it should never be pitched as fraud-proof.

## Degradation

Every external service has a labeled fallback, because the demo cannot depend on
a venue's wifi:

| Service | Absent → | Visible to user? |
| --- | --- | --- |
| Gemini | deterministic mock verdict | yes, badged "mocked" |
| MongoDB | in-memory store | yes, badged "in-memory" |
| ElevenLabs | narration hidden | yes, control absent |
| Querit | canned sources | yes, badged "mocked" |
| MapTiler | free OSM raster tiles | no (visual only) |
| GPS | Demo Mode simulated walking | yes, banner |

`/health` reports which of these are live, and the home page renders it. A mock
is never silently substituted for the real thing.
