# Waypoint Wars — Implementation Plan

> **This file is the overnight run's source of truth.** Each phase has an
> acceptance test. Do not start phase N+1 until phase N builds, typechecks,
> and passes its test. Update the status boxes as you go.

## Confirmed constraints (answered by the user before the run)

| Decision | Value |
| --- | --- |
| Demo area | **Downtown Pittsburgh**, finishing at Point State Park Fountain |
| Demo method | **Simulated movement** on laptops is the primary path; real GPS must still work |
| Live API keys | **Gemini only.** Mongo / ElevenLabs / Querit / MapTiler run as labeled mocks |
| Git | **Local only.** Commit per phase. No remote, no push, no deploy |
| Approval gate | **Waived** — user is asleep. Record decisions in `DECISIONS.md` instead |

## Non-negotiable demo (if everything else is cut)

Two browser windows join a room, receive **different** routes, walk (simulated)
to checkpoints, submit photos verified by **real Gemini**, earn synchronized XP,
finish at the **same** destination, and see a leaderboard + animated route replay.

---

## Phase status

- [x] **P1 — Foundation**
- [ ] **P2 — Content: three Downtown routes**
- [x] **P3 — Hunt engine (scoring + state machine)**
- [x] **P4 — Map + single-player vertical slice**
- [ ] **P5 — Gemini verification**
- [ ] **P6 — Phaser HUD layer**
- [x] **P7 — Colyseus multiplayer**
- [ ] **P8 — Persistence (Mongo adapter + in-memory fallback)**
- [ ] **P9 — Route replay + demo mode**
- [ ] **P10 — Creator dashboard**
- [ ] **P11 — Optional: Querit + ElevenLabs**
- [ ] **P12 — Demo hardening**

---

### P1 — Foundation ✅

pnpm workspace, shared types, env template, gitignore-before-first-commit.

**Acceptance:** `pnpm install && pnpm typecheck` passes; `.env.local` is ignored.

---

### P2 — Content: three Downtown routes

Write `data/pittsburgh-hunts.json` by hand. Do **not** wait on AI generation —
stable test data unblocks every other phase.

Anchor landmarks (all walkable, Downtown):
Fort Pitt Blockhouse · Market Square · PPG Place · Smithfield Street Bridge ·
Allegheny County Courthouse · Burke Building · Point State Park Fountain (finish)

Requirements:
- 3 routes × 4 checkpoints + 1 **shared** final destination
- Comparable length and difficulty across routes
- Each route reveals **different** history (this is what makes the end-screen comparison interesting)
- Every checkpoint carries all three layers: clue / challenge / reveal
- Coordinates verified against real map positions
- Every `historicalReveal` cites a source, and **uncertain claims are labeled as legend**

**Acceptance:** a script validates all 3 routes parse, have equal checkpoint
counts, share a final destination, and sit within ±20% of each other on distance.

---

### P3 — Hunt engine

`packages/hunt-engine`, framework-independent and fully unit-tested.

- State machine: `NOT_STARTED → NAVIGATING → ARRIVED → CHALLENGE_OPEN → VERIFYING → COMPLETED → NEXT_CHECKPOINT → FINISHED`
- Only the active checkpoint is submittable; future clues stay locked
- XP calculation per `XP_RULES`
- **Speed bonus is normalized per checkpoint** (`expected / actual`, clamped) so
  different routes stay comparable — this is the core fairness mechanism
- Route assignment: distinct routes where possible, all sharing a destination
- Fuzzy answer matching (case/punctuation/whitespace tolerant)

**Acceptance:** unit tests cover the full happy path, rejected submission +
retry, hint penalty, speed-bonus clamping, and route-assignment distinctness.

---

### P4 — Map + single-player vertical slice

`apps/web` — Next.js, mobile-first.

- MapLibre with free OSM raster tiles (no key needed)
- Player marker + accuracy radius; active checkpoint radius; completed polyline
- **Future checkpoints hidden.** Only current target + completed points render
- Geolocation permission states handled explicitly
- Dev/demo movement controls (simulated walking) — this is the demo path
- Arrival detection emits a typed `checkpoint:arrived` event
- Camera capture, retake, answer input, upload progress
- Mocked verification so the loop closes before Gemini exists

**Acceptance:** one complete 4-checkpoint solo run, start to results, using
simulated movement, with no server and no API keys.

---

### P5 — Gemini verification

`services/verification` — server-side only.

- Structured JSON output: `landmarkMatch`, `requiredActionCompleted`, `answerCorrect`, `confidence`, `reason`
- Grounding: submitted photo + landmark description + randomized instruction + question + accepted-answer criteria
- **Gemini never awards XP.** Server combines the verdict with the geofence check
- Randomized instruction issued **on arrival**, not at hunt start
- Low confidence → `needs-review`, not a silent pass
- Labeled mock when `GEMINI_API_KEY` is absent
- API key never reaches the browser

**Acceptance:** tests for pass / fail / low-confidence; a real photo verifies
end-to-end against live Gemini.

---

### P6 — Phaser HUD

`packages/game` — transparent overlay. Presentation only, **no game state**.

XP counter · countdown · progress bar · hint button · verification animation ·
opponent progress · results scene. Typed React→Phaser event bridge.
Every animation under 1 second (players are walking).

**Acceptance:** standalone mock page fires every animation; no duplicated state.

---

### P7 — Colyseus multiplayer

`apps/multiplayer-server` — authoritative.

Server owns start time, route assignment, XP, hints, progress, leaderboard.
Clients **cannot** assign themselves XP. Six-char join codes + QR.
Individual and team modes. Reconnection.
Opponents see approximate regions + progress — **never** raw coordinates,
routes, clues, or answers.

**Acceptance:** two browser windows, different routes, synchronized XP,
shared finish. A crafted `xp` message from a client is rejected.

---

### P8 — Persistence

Collections: hunts, routes, checkpoints, submissions, completed_runs, historical_sources.
2dsphere index on checkpoint coordinates. Live locations kept in-room and only
the completed path persisted. **In-memory adapter is the default** (no Mongo key).

**Acceptance:** identical behaviour with and without `MONGODB_URI`; seed script
is idempotent.

---

### P9 — Route replay + demo mode

Sample location every 10–15s while active. MapLibre draws paths, Phaser draws
avatars/effects. Replay shows each player's path, checkpoint moments, XP, hints,
final arrival, and **route-exclusive discoveries**. Speed 1× / 2× / 4×.

Demo mode simulates two players walking the whole hunt in ~3 minutes.

**Acceptance:** the full three-minute demo runs start to finish, unattended,
with no physical walking.

---

### P10 — Creator dashboard

Next.js + MapLibre. Click to add checkpoint, drag to move, reorder, fill all
three layers, upload reference image, set XP/radius/expected time, preview,
publish. Internal only — no public marketplace.

**Acceptance:** a new checkpoint created in the UI is playable without a restart.

---

### P11 — Optional integrations

Querit source retrieval → Gemini drafts clue/question/answer/reveal → **human
review required before publish**. Source URLs stored with every reveal.
ElevenLabs narration, cached, optional, game works without it.

---

### P12 — Demo hardening

Seed reset command · error states · reconnect · the 3-minute script rehearsed ·
README with exact run instructions.

---

## Build order if time collapses

Cut in this order: **creator dashboard → Querit → ElevenLabs → team mode**.
Protect the non-negotiable demo above all else.
