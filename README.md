# Waypoint Wars

A real-world historical scavenger hunt through Downtown Pittsburgh. Players walk
**different routes**, solve challenges that require physically being there,
verify with live photos, and converge on **the same finish** — The Point, where
the Allegheny and Monongahela become the Ohio.

It is a **web app**. Nothing to install: scan a QR code, the browser opens, you
are in the game.

---

## Run it

```bash
pnpm install
pnpm dev
```

That starts both the Next.js app (`:3000`) and the Colyseus server (`:2567`).

| URL | What it is |
| --- | --- |
| `http://localhost:3000` | Home, with live integration status |
| `http://localhost:3000/play` | **Solo hunt** — full loop, no server or keys needed |
| `http://localhost:3000/demo` | **Route replay** — three players converging (the pitch) |
| `http://localhost:3000/lobby` | **Multiplayer** — create/join a room |

### The three-minute demo

1. Open `/demo`. Three players walk three different Downtown routes
   simultaneously and converge on The Point. Speed controls 1× / 2× / 4×.
2. Open `/play` in another window for a live solo run: clue → walk → arrive →
   photo + answer → verification → the history you just earned → next clue.
3. `/lobby` in two windows for the multiplayer race with QR join.

Demo Mode simulates walking, so none of this requires being outdoors or having
GPS. It is always labeled on screen.

---

## Configuration

Copy `.env.example` to `.env.local`. **Every key is optional** — without one,
that integration runs as a clearly-labeled mock and the app still works.

```bash
GEMINI_API_KEY=      # photo verification. Without it: deterministic mock
MONGODB_URI=         # persistence.      Without it: in-memory store
ELEVENLABS_API_KEY=  # narration.        Without it: audio hidden
MAPTILER_KEY=        # map tiles.        Without it: free OSM raster tiles
QUERIT_API_KEY=      # source retrieval. Without it: canned sources
```

`GET /health` reports which are live, and the home page renders it as badges. A
mock is never silently substituted for the real thing.

---

## Layout

```
apps/web                 Next.js — UI, camera, map, forms
apps/multiplayer-server  Colyseus — AUTHORITATIVE game state
packages/shared          Domain types + wire protocol. The contract.
packages/hunt-engine     Rules: scoring, state machine, route assignment. Pure.
packages/game            Phaser HUD overlay. Presentation only.
services/verification    Gemini. Returns a judgement, never XP.
data/                    Curated content + build/validate scripts
```

Read `ARCHITECTURE.md` for why the boundaries are where they are, and
`DECISIONS.md` for the calls made along the way.

### Commands

```bash
pnpm dev             # web + server together
pnpm build           # build everything
pnpm test            # 222 tests across engine, verification, HUD, rooms
pnpm typecheck       # whole workspace

pnpm --filter @ww/data build      # regenerate pittsburgh-hunts.json from the seed
pnpm --filter @ww/data validate   # check route balance + content integrity
pnpm --filter @ww/game mock       # Phaser animation harness
```

---

## How it stays fair

Players walk different routes, so **raw finishing time is meaningless**. The
speed bonus is normalized per checkpoint against that checkpoint's own expected
time, then clamped:

```
speedRatio = expectedCompletionSeconds / actualSeconds
fraction   = 0.5 + 0.5 * log2(ratio) / log2(4)
```

Logarithmic and symmetric, so beating expectations by 2× gains what missing by
2× loses, and one anomalous checkpoint cannot swamp four honest ones.

`pnpm --filter @ww/data validate` fails the build if the three routes drift more
than 20% apart in measured walking distance, or if their base XP differs at all.

## How it resists cheating — and where it doesn't

Four independent gates per checkpoint:

1. **GPS geofence**, checked server-side *before* any API call
2. **Landmark match** from the photo
3. **A randomized action** issued *on arrival*, so it can't be staged in advance
4. **The observation answer**, matched by a deterministic string comparison

That last one matters: Gemini's opinion on the answer is **advisory only**. The
accepted answers are known exactly, so a string comparison decides — a model
that can be argued into "correct" is an exploitable scoring oracle. There is a
test that submits a prompt-injection string with the model asserting correct at
0.99 confidence, and asserts rejection.

**This is a deterrent, not proof.** A determined cheater with a friend standing
downtown wins. That is an acceptable trade for an MVP, and it should not be
pitched as fraud-proof.

## Privacy

Opponents never receive each other's coordinates. Positions are coarsened by
**snapping to a ~150m grid**, not by adding random noise — noise can be averaged
away by sampling repeatedly while a target stands still; a snapped cell cannot.
Opponents' routes, clues, hints and answers are not sent to the client at all,
not merely hidden in the UI.

---

## Known limits

- Checkpoint coordinates are desk estimates from the content seed. The 30–40m
  radii are tight enough that **real-GPS play needs a walk-through first**.
  Demo Mode is unaffected.
- The live Gemini path runs for the first time when someone submits with a real
  key set; every test injects a fake client by design.
- Real phones need HTTPS for camera and geolocation. `localhost` is exempt, so
  the laptop demo works as-is.
- Persistence defaults to in-memory and resets on restart.
