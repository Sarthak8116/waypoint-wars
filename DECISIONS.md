# Decisions & Assumptions

Recorded during the overnight run because the approval gate was waived
(the user was asleep). Review these in the morning — anything here is
reversible, but some are load-bearing.

## D1 — Approval gate waived
The original prompt said "wait for my approval" after the file structure.
The user explicitly asked for an MVP by morning, so the run proceeds and
logs decisions here instead of blocking. **This is the one instruction in
the original spec deliberately not followed.**

## D2 — Free OSM raster tiles instead of MapTiler
No MapTiler key was provided. MapLibre renders fine with OpenStreetMap raster
tiles and needs no key. Slightly less polished than vector tiles.
*Swap:* set `MAPTILER_KEY` and change one style URL.

## D3 — In-memory persistence is the default
No Mongo URI was provided. All storage sits behind a `HuntStore` interface with
two implementations: `MemoryStore` (default) and `MongoStore`. The Mongo adapter
and its 2dsphere index are still written so the Atlas sponsor integration is
real code, not a stub — it just isn't exercised without a URI.
*Swap:* set `MONGODB_URI`.

## D4 — Gemini is the only live integration
`GEMINI_API_KEY` is the sole real key. ElevenLabs and Querit run as mocks that
are **visibly labeled in the UI** (never silently faked). Per the user's rules:
"Clearly label every mock or simulated feature."

## D5 — Querit interface is provisional
I do not have reliable documentation for Querit's API surface. It is implemented
behind a narrow `HistoricalSourceProvider` interface returning
`HistoricalSource[]`. Wiring the real client should be a single-file change.
**Flag for the user: confirm the actual Querit API shape.**

## D6 — Simulated movement is a first-class feature, not a dev hack
The user chose the laptop demo. So simulated movement lives in the product as
"Demo Mode" with a visible banner, rather than hiding behind a dev flag. Real
geolocation remains fully implemented and is the default outside demo mode.
This also protects against venue wifi/GPS failure.

## D7 — Phaser holds no game state
Phaser is a presentation layer only. All state lives in React (solo) or the
Colyseus room (multiplayer). Phaser receives events and animates. This avoids
the classic dual-source-of-truth bug and follows the user's explicit rule.

## D8 — Public vs. private checkpoint shapes
`toPublicCheckpoint()` strips `acceptedAnswers`, `historicalReveal`, `hint`, and
`hiddenDetail` before any checkpoint reaches a browser. Otherwise players could
read answers out of the network tab. Reveals are sent only after approval.

## D9 — Opponent positions are grid-snapped, not noised
Random noise can be averaged out by sampling repeatedly. Snapping to a ~150m
grid cannot. See `toApproximateRegion()` in `packages/shared/src/geo.ts`.

## D10 — Anti-cheat is a deterrent, not proof
Randomized on-arrival instructions + GPS + landmark matching raise the cost of
faking a checkpoint. They do not make it fraud-proof, and the README says so
plainly. Do not claim otherwise in the pitch.

## D11 — Historical accuracy
Reveals are hand-written from well-established Pittsburgh history with sources
cited. Anything uncertain is explicitly labeled a legend. AI-generated history
is never auto-published — it requires human review per the original spec.
**Flag for the user: verify the historical claims before demoing them publicly.**
