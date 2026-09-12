# Waypoint Wars — "Three Rivers Run"

A complete, ready-to-seed sample hunt for downtown Pittsburgh. Every checkpoint is a real place with a real, on-site observable, verified against public sources (cited per checkpoint in the seed file). The machine-readable object lives in `waypoint-wars-seed.ts`; this document is the human-readable spec.

> **One thing to preserve above all:** the anti-cheat split. GPS proximity is a device geofence and is *never* sent to Gemini. Gemini only ever judges the photo + the answer, using the `verification` block. The randomized photo action is what stops recycled/borrowed photos.

---

## 1. Hunt overview

| Field | Value |
|---|---|
| **Hunt id** | `hunt_three_rivers_run` |
| **Name** | Three Rivers Run |
| **Tagline** | Three trails through downtown Pittsburgh. One fountain where the rivers — and the racers — meet. |
| **Geographic area** | Downtown Pittsburgh / the Golden Triangle: Cultural District, Grant St, Smithfield & Fourth Ave, Market Square, PPG Place, Point State Park |
| **Expected duration** | ~50 min per route (walking + challenges) |
| **Difficulty** | Easy-to-moderate; all public sidewalks, ~1.5–1.9 km per route |
| **Players** | 1–3 solo players/teams for the asymmetric 3-route demo; team mode 2–4 per team |

**Game loop:** `CLUE → NAVIGATE → ARRIVE (GPS) → OBSERVE → PHOTO + ANSWER → VERIFY (Gemini) → XP → HISTORICAL REVEAL → NEXT CLUE`, ending in a shared climactic finish at the Point.

**Central idea:** three different but balanced trails, each four observation checkpoints, all converging on the Point State Park fountain — the confluence of the Allegheny and Monongahela into the Ohio. The rivers meeting *is* the routes meeting. Historical content is always a **reward after** completing a stop, never a lecture before arrival.

---

## 2. Route overview

| Route id | Name | Theme | Checkpoint sequence | Dist | Time | Max XP* |
|---|---|---|---|---|---|---|
| `route_confluence` | **Confluence Trail** | Rivers & the founding | Smithfield St Bridge → Market Square → PPG Place → Fort Pitt Block House | 1.7 km | ~49 min | 900 |
| `route_foundry` | **Foundry Trail** | Steel, stone & money | U.S. Steel Tower → Courthouse (Bridge of Sighs) → Kaufmann's Clock → Dollar Bank Lions | 1.85 km | ~52 min | 900 |
| `route_marquee` | **Marquee Trail** | Arts & discovery | Katz Plaza → Byham Theater → Roberto Clemente Bridge → Fort Duquesne Outline | 1.55 km | ~48 min | 900 |

*Max XP excludes the time bonus (up to +40), which is identical across routes. All three routes share the same scoring template, so maximum scores are equal by construction. All three end at **The Point — Confluence Fountain** (`final_point_fountain`).

**Convergence geometry:** each route trends westward toward the Point. Confluence runs the southern riverfront; Foundry descends Grant St then the Smithfield banking corridor; Marquee sweeps the northern Cultural District to the Allegheny, then west along the boulevard. All three funnel into Point State Park and finish at the fountain at the tip.

---

## 3. Complete checkpoint specifications

Compact spec per checkpoint below; exhaustive machine fields (full `verification`, `demo`, `sources`, hint costs) are in `waypoint-wars-seed.ts`. Radii are generous starting values — **tune on-site** (phone GPS is only 3–10 m accurate; keep radii ≥ 25 m).

### Route A — Confluence Trail

**A1 · Smithfield Street Bridge** — `cp_smithfield_bridge`
- **Location / coords / radius:** Downtown portal of the bridge over the Mon · `40.4360, -80.0007` · 40 m
- **Clue:** "Where the city's oldest river crossing still stands, two great steel eyes lie on their sides and stare across the Mon. Find the portal and look down the span."
- **Hints:** (−15) carries Smithfield St to Station Square, start downtown end · (−25) the side trusses bow out and back like a lens/eye — that's your photo.
- **Observation:** frame the bridge down its length so the lens-shaped ("lenticular") truss reads.
- **Answer Q:** what everyday shape does each side truss resemble? → `lens / eye / oval / almond / lenticular`
- **Verify:** lens-profile steel truss, pale blue-and-beige paint, stone Gothic portal, river beyond + assigned photo action. Low confidence: tight paint/railing crop with no truss curve.
- **XP:** 100 + 30 + 20 · **Walk 0 min / Challenge 5 min**
- **Reveal:** Pittsburgh's oldest river bridge; Gustav Lindenthal, 1883; first American use of the lenticular truss; on Roebling's older piers; a National Historic Landmark.

**A2 · Market Square (The Diamond)** — `cp_market_square`
- **Location / coords / radius:** Market Square plaza; Original Oyster House · `40.4411, -80.0019` · 30 m
- **Clue:** "In the open square Pittsburgh has gathered in since 1784, find the fried-fish sign of the city's oldest tavern and put it in frame."
- **Hints:** (−15) find the Original Oyster House, here since 1870 · (−25) the old name is a card suit, shown on nearby signage.
- **Observation:** photograph the Original Oyster House storefront (oldest bar/restaurant in the city).
- **Answer Q:** one-word nickname for this square since 1784? → `diamond / the diamond`
- **Verify:** "Original Oyster House" storefront on the open plaza (Belgian block) + action. Low confidence: name illegible or wrong eatery.
- **XP:** 100 + 30 + 20 · **Walk 9 min / Challenge 5 min**
- **Reveal:** laid out 1784 as "the Diamond"; held the first courthouse, jail, and first newspaper west of the Alleghenies; Oyster House opened 1870 on the 1827 Bear Tavern site.

**A3 · PPG Place Plaza** — `cp_ppg_place`
- **Location / coords / radius:** PPG Place plaza · `40.4405, -80.0030` · 30 m
- **Clue:** "Six towers of mirror glass rise like a fairy-tale castle. At their feet, a stone needle balances on a cluster of dark spheres — count what holds it up."
- **Hints:** (−15) plaza at the center of the glass complex; needle = pink granite obelisk · (−25) count the large black balls at its base.
- **Observation:** count the black granite spheres under the obelisk ("Tomb of the Unknown Bowler"); frame obelisk + glass tower.
- **Answer Q:** how many black balls support the obelisk? → `4 / four`
- **Verify:** pink obelisk on black spheres, ringed by reflective neo-Gothic glass towers + action. Low confidence: tower only, or winter rink/tree hiding the base.
- **XP:** 100 + 30 + 20 · **Walk 3 min / Challenge 5 min**
- **Reveal:** Philip Johnson & John Burgee, 1984; ~1M sq ft of glass, 231 neo-Gothic spires; designed to echo the Cathedral of Learning and the Allegheny County Courthouse.

**A4 · Fort Pitt Block House** — `cp_block_house`
- **Location / coords / radius:** Point State Park · `40.4412, -80.0098` · 25 m
- **Clue:** "The oldest building in Pittsburgh is small, brick, and armed with narrow slits. Reach the little fort in the park and count its walls."
- **Hints:** (−15) tiny brick redoubt near the Fort Pitt Museum · (−25) walk its perimeter — it isn't a square.
- **Observation:** photograph the five-sided brick redoubt so a musket loophole and its shape are visible.
- **Answer Q:** how many sides? → `5 / five / pentagon(al)`
- **Verify:** two-story brick redoubt, narrow vertical musket slits, pyramidal roof, parkland + action. Low confidence: interior/plaque shot only.
- **XP:** 100 + 30 + 20 · **Walk 9 min / Challenge 5 min**
- **Reveal:** built 1764 (Bouquet's Redoubt), oldest building in Pittsburgh, only surviving piece of Fort Pitt; saved by families living in it, given to the DAR by Mary Schenley in 1894.

### Route B — Foundry Trail

**B1 · U.S. Steel Tower** — `cp_us_steel_tower`
- **Location / coords / radius:** 600 Grant St, tower base · `40.4416, -79.9957` · 35 m
- **Clue:** "The tallest tower in the city was built to rust on purpose. Stand at the foot of one of its enormous outside columns and look up."
- **Hints:** (−15) tallest building downtown, Grant St, huge exterior steel columns · (−25) the unpainted steel's color is the answer.
- **Observation:** photograph an exterior column / the rust-brown weathering-steel facade looking up.
- **Answer Q:** what color has the weathering steel turned? → `rust / brown / orange / bronze`
- **Verify:** rust-brown structural columns at street level, dark tower above, triangular notched footprint + action. Low confidence: neighboring building or all-glass/sky frame.
- **XP:** 100 + 30 + 20 · **Walk 0 min / Challenge 5 min**
- **Reveal:** 1970, tallest in Pittsburgh (64 fl, 841 ft), triangular plan echoing the Golden Triangle; a showcase for COR-TEN weathering steel (U.S. Steel patented it in 1933) — engineered to rust into a protective patina, never painted.

**B2 · Allegheny County Courthouse — Bridge of Sighs** — `cp_courthouse_bridge_of_sighs`
- **Location / coords / radius:** Ross St side of 436 Grant St · `40.4385, -79.9953` · 30 m
- **Clue:** "Behind the great stone courthouse, an enclosed bridge crosses a street in mid-air, once used to walk prisoners from their cells. Find it and read the street it leaps."
- **Hints:** (−15) go to the Ross Street side and look up · (−25) the street name is on the corner sign beneath the bridge.
- **Observation:** photograph the enclosed stone Bridge of Sighs spanning the street.
- **Answer Q:** which street does it span? → `ross / ross street` (forces reading the on-site sign)
- **Verify:** roofed stone bridge with small arches between two rusticated-granite Romanesque buildings + action. Low confidence: Grant St front, or facade with no elevated bridge.
- **XP:** 100 + 30 + 20 · **Walk 6 min / Challenge 5 min**
- **Reveal:** H. H. Richardson's 1888 masterpiece (namesake of "Richardsonian Romanesque"); the Venice-style Bridge of Sighs carried prisoners to court; scene of the 1902 Biddle brothers / Mrs. Soffel escape.

**B3 · Kaufmann's Clock** — `cp_kaufmanns_clock`
- **Location / coords / radius:** Fifth Ave & Smithfield St corner · `40.4400, -79.9986` · 20 m (small)
- **Clue:** "For a century Pittsburghers have met sweethearts and friends beneath one bronze clock hanging from a department-store corner. Stand under it and name the crossing."
- **Hints:** (−15) projects from the building corner one story up · (−25) two street-name signs meet here — either is the answer.
- **Observation:** photograph the ornate bronze corner clock looking up.
- **Answer Q:** name either street at this corner → `fifth avenue / smithfield street` (forces on-site reading)
- **Verify:** ornate bronze clock cantilevered from a masonry corner over a busy intersection + action. Low confidence: generic street clock.
- **XP:** 100 + 30 + 20 · **Walk 6 min / Challenge 4 min**
- **Reveal:** the 2,500-lb clock went up in 1913; "Meet me under Kaufmann's clock" became a generational tradition; the Kaufmanns also commissioned Frank Lloyd Wright's Fallingwater.

**B4 · Dollar Bank Lions** — `cp_dollar_bank_lions`
- **Location / coords / radius:** 340 Fourth Ave · `40.4396, -79.9983` · 25 m
- **Clue:** "On the old banking street, two great stone lions have guarded the people's savings since 1871. Photograph the pair."
- **Hints:** (−15) they flank the Dollar Bank entrance on Fourth Ave · (−25) tradition says they guard the people's *money*.
- **Observation:** photograph both brownstone lions (one guarding, one resting).
- **Answer Q:** the lions guard the people's ____ → `money / savings`
- **Verify:** pair of carved stone lions flanking an ornate columned bank entrance on a low-rise avenue + action. Low confidence: one lion only, or a different Fourth Ave lion without the bank.
- **XP:** 100 + 30 + 20 · **Walk 3 min / Challenge 4 min**
- **Reveal:** carved 1871 by Max Kohler from single blocks of Connecticut brownstone; Dollar Bank let you open an account with one dollar; current lions are exact replicas (originals moved indoors 2012); Fourth Ave was Pittsburgh's Wall Street.

### Route C — Marquee Trail

**C1 · Agnes R. Katz Plaza (Eyeball Park)** — `cp_katz_plaza`
- **Location / coords / radius:** 7th St & Penn Ave, Cultural District · `40.4437, -79.9992` · 25 m
- **Clue:** "In the theater district there's a plaza locals call 'Eyeball Park.' Find out why, and sit for a photo with one of its odd stone benches."
- **Hints:** (−15) plaza at 7th & Penn with a tall bronze fountain · (−25) the benches are shaped like the body part you're reading with.
- **Observation:** photograph one of the giant eye-shaped granite benches.
- **Answer Q:** what body part are the benches shaped like? → `eye / eyeball`
- **Verify:** smooth granite bench sculpted as a human eye, plaza with tall irregular bronze fountain + action. Low confidence: an ordinary rectangular bench.
- **XP:** 100 + 30 + 20 · **Walk 0 min / Challenge 5 min**
- **Reveal:** opened 1999; eye benches + 25-ft bronze fountain by Louise Bourgeois (her largest US commission then), with Daniel Kiley (landscape) and Michael Graves (architecture); the fountain's two streams stand for a couple whose lives mesh.

**C2 · Byham Theater** — `cp_byham_theater`
- **Location / coords / radius:** 101 Sixth St · `40.4432, -80.0001` · 25 m
- **Clue:** "A 1903 vaudeville house on Sixth Street has worn three different names in its life. Photograph the name lit on its marquee today."
- **Hints:** (−15) the historic Cultural Trust theater on Sixth St · (−25) the marquee name is a family surname — read it off the sign.
- **Observation:** photograph the illuminated marquee / name sign.
- **Answer Q:** what single name is on the marquee today? → `byham`
- **Verify:** historic theater facade, illuminated marquee/blade sign reading "BYHAM" + action. Low confidence: a neighboring venue's marquee (Benedum, Heinz Hall).
- **XP:** 100 + 30 + 20 · **Walk 3 min / Challenge 4 min**
- **Reveal:** opened 1903 as the Gayety (vaudeville — Ethel Barrymore, Helen Hayes), became the Fulton movie palace in the 1930s, restored and renamed the Byham in 1995. Three names, one surviving building.

**C3 · Roberto Clemente Bridge** — `cp_clemente_bridge`
- **Location / coords / radius:** Downtown (6th St) end of the bridge · `40.4444, -80.0016` · 35 m
- **Clue:** "One of three near-identical sisters crosses the Allegheny here, painted a color you can't miss, and closed to cars on ball-game days. Shoot straight up its span."
- **Hints:** (−15) carries Sixth St to the North Shore / PNC Park; start downtown end · (−25) its paint color is the answer.
- **Observation:** photograph the bridge along its length from the downtown end.
- **Answer Q:** what color is it painted? → `yellow / gold / aztec gold`
- **Verify:** bright-yellow suspension bridge, tall towers, eyebar chains, river/North Shore beyond + action. (Generic "sister" shot acceptable — only color + form are checked.)
- **XP:** 100 + 30 + 20 · **Walk 6 min / Challenge 4 min**
- **Reveal:** the Roberto Clemente (Sixth Street) Bridge, one of the "Three Sisters" (6th/7th/9th) — the only trio of near-identical bridges and among the first self-anchored suspension spans in the US; renamed 1998; closes to cars on Pirates game days. *(Note: don't ask for the Clemente statue — it's across the river at PNC Park.)*

**C4 · Fort Duquesne Outline** — `cp_fort_duquesne_outline`
- **Location / coords / radius:** Great Lawn, Point State Park · `40.4423, -80.0083` · 30 m
- **Clue:** "In the great lawn near the rivers, the ghost of a vanished French fort is drawn in stone on the ground. Find the outline and its center marker."
- **Hints:** (−15) look down — a granite line traces a fort in the lawn · (−25) a European power built and burned it in the 1750s.
- **Observation:** photograph the granite outline / the central bronze medallion.
- **Answer Q:** which European power built the fort? → `french / france`
- **Verify:** pale granite line flush in a grass lawn forming a fort outline, round bronze medallion at center + action. Low confidence: plain lawn or unrelated plaque.
- **XP:** 100 + 30 + 20 · **Walk 11 min / Challenge 5 min**
- **Reveal:** Fort Duquesne, built by the French in 1754, burned by the retreating French in 1758 so the British couldn't take it; the British then built Fort Pitt. The granite tracery (bronze medallion at its heart) marks where it stood, lit at night.

---

## 4. Final destination specification

**The Point — Confluence Fountain** — `final_point_fountain`
- **Location / coords / radius:** tip of Point State Park, at the fountain / Great Allegheny Passage bronze terminus medallion · `40.4417, -80.0093` · 40 m
- **Clue:** "Every trail ends where two rivers become a third. Reach the very tip of the Point, find the bronze medallion set in the stone, and mark your arrival together."
- **Hints:** (−15) walk to the farthest tip, past the fountain · (−25) a large round bronze medallion is set in the stone at the tip.
- **Final challenge:** all three trails converge here. At the tip where the rivers meet, find the bronze medallion (western end of the Great Allegheny Passage) and take **one arrival photo** — a team group shot or a selfie with the confluence behind you. Fountain geyser in frame = bonus flair.
- **Answer Q:** name the river that begins where the other two meet → `ohio / ohio river`
- **Verify:** the point of land where two rivers join into one, open water/sky, ideally the bronze medallion and/or the tall geyser + arrival action. **Never fail solely because the fountain is off** (it's seasonal).
- **XP:** 100 base + 30 answer + 20 photo + **150 final-destination bonus** = **300**
- **Reveal:** the Point — Allegheny + Monongahela → Ohio, Pittsburgh's birthplace; the 150-ft fountain (opened 1974; an idea Frank Lloyd Wright floated in 1947) draws on the "fourth river" aquifer; the medallion marks Mile 0 of the 150-mile Great Allegheny Passage.

**Climactic extras (content-level; implementation is engineering's):**
- **Final completion animation concept:** on verify, the fountain "erupts" full-height tinted in the player/team color; the three route paths animate inward across the map and lock together at the Point with a burst.
- **Leaderboard reveal concept:** map dissolves to a podium — final XP, elapsed time, hints used, observation streak per player/team; winner's row highlighted with a confluence motif.
- **Route replay concept:** each player's full path draws checkpoint-to-checkpoint with timestamps and the photo submitted at each pin; the three replays can play side by side to show the asymmetric routes converging.
- **Multiplayer convergence behavior:** all routes' final clue resolves to this single geofence; players arrive independently; opponents' full routes are only revealed *after* the match closes, in replay.

---

## 5. Scoring rules

Explain-in-20-seconds version: **100 per stop, +30 for the observation answer, +20 for nailing the randomized photo action, 150 bonus at the Point, small time bonus. Hints cost you.**

| Rule | Value |
|---|---|
| Checkpoint completion (GPS + photo pass) | **+100 XP** |
| Observation answer correct | **+30 XP** |
| Randomized photo action clearly performed | **+20 XP** |
| Hint 1 used | **−15 XP** |
| Hint 2 used | **−25 XP** (additional, if both used) |
| Final-destination completion bonus | **+150 XP** (on top of the final's own 100+30+20) |
| Time bonus | **+40** if finish < 40 min, else **+20** if < 55 min, else 0 |

- **Max per checkpoint:** 150 (with 0 hints). **Final:** 300. **Route max (excl. time):** 4×150 + 300 = **900**. **With time bonus:** **940**. Identical across all three routes.
- **Tie-breakers (in order):** (1) higher total XP → (2) more observation answers correct → (3) earlier finish timestamp → (4) fewer hints used.
- **Design intent:** observation + photo bonuses (50 XP/stop) outweigh the time bonus (≤40 total), so the game rewards *seeing things* over reckless speed, exactly as briefed.

---

## 6. Multiplayer rules (content level — no networking here)

- **Route assignment:** each player/team is randomly assigned one of the three routes; in 3-way play it's A/B/C with no repeats. Teammates always share a route.
- **Opponents can see:** checkpoints-cleared count (n/4), total XP, the live event feed.
- **Hidden from opponents:** clues, exact locations, route name, future checkpoints, map position.
- **Progress display:** a simple leaderboard (name + n/4 + XP) plus a scrolling event feed. No opponent pins on the map during play (that would leak routes).
- **Opponent XP timing:** updates on *checkpoint completion*, not per attempt — so nothing leaks beyond "a checkpoint was cleared."
- **Team mode:** 2–4 players share one route and one progress state; any member's GPS + photo completes a checkpoint; XP is pooled; the final is a team group photo.
- **Ties:** use the tie-breakers above.
- **Early finish:** the first to finish locks score + time, then watches the leaderboard/feed and can start their replay; the match closes when all finish or a match timer expires.
- **On opponent checkpoint:** show a generic event message + bump their leaderboard XP; never name the location.

**Event messages (all leak progress/score only — never route/location):**
1. "An explorer just cleared a checkpoint — two stops from the Point."
2. "Someone nailed a tricky photo challenge. +20 bonus."
3. "A rival burned a hint to move forward."
4. "First to the river! An explorer reached their third checkpoint."
5. "An explorer has reached the Point. The fountain awaits."
6. "New XP leader — the lead just changed hands."

---

## 7. Demo script (~4 min, laptop, no walking)

**Simulated:** player GPS movement (a scripted walk), the opponent (a scripted bot named "Nakama"), and submitted photos (pre-loaded samples).
**Identical to real gameplay:** the whole clue→verify→XP→reveal loop, the Gemini verification call + response handling, XP math + hint penalties, the event feed, leaderboard, and route replay. *Only the inputs are faked; the game logic and AI verification run for real.*

| Time | Beat |
|---|---|
| 0:00 | Host creates lobby "Three Rivers Run — Downtown"; match code shown. |
| 0:10 | Bot "Nakama" joins via code. |
| 0:20 | Route assignment animation — you = Confluence (blue), Nakama = Foundry (amber), drawn as distinct paths. |
| 0:35 | First clue (Smithfield St Bridge); scripted walk moves your avatar toward the geofence. |
| 1:00 | Geofence triggers: checkpoint-discovered animation, observation challenge + randomized photo action revealed. |
| 1:15 | Pre-loaded sample photo → Gemini verification animation → PASS, with `landmarkMatch / requiredActionCompleted / answerCorrect` shown. |
| 1:35 | XP animation +100 +30 +20; historical reveal card slides in; audio-narration toggle plays the short reveal. |
| 1:55 | Event feed: "Foundry explorer cleared a checkpoint"; leaderboard XP bumps. |
| 2:05 | Next checkpoint: tap Hint 1, XP −15, hint reveals — shows the cost mechanic. |
| 2:20 | Fast-forward (sped up) through remaining checkpoints to build to the finale. |
| 2:45 | Race to the final: both avatars converge on the Point; the two paths light up and meet at the fountain. |
| 3:05 | Final challenge: arrival group photo → verify → fountain "erupts" in team color, confetti. |
| 3:25 | Final leaderboard: XP, time, hints; winner highlighted. |
| 3:40 | Animated route replay retraces your full path with checkpoint pins, times, and submitted photos. |

**Impact ordering rationale:** open on the "another player joined + asymmetric routes" moment (originality + multiplayer), land the full verify→XP→reveal loop once at full fidelity (technical challenge + demo quality), show one hint (usefulness of the economy), then compress to the convergence + fountain finale (payoff), and close on the replay (track relevance / shareability).

---

## 8. Seed data

The full developer object is `waypoint-wars-seed.ts` — a single default export `pittsburghDemoHunt` plus named exports (`checkpoints`, `routes`, `finalDestination`, `scoring`, `multiplayer`, `demo`, `RANDOM_PHOTO_ACTIONS`, `CORNERS`). It validated clean: 12 checkpoints, 3 routes of 4, all `checkpointIds` resolve, route max = 900 XP.

Top-level shape:

```ts
pittsburghDemoHunt = {
  id, name, tagline, description, geographicArea,
  expectedDurationMinutes, difficulty, players, gameLoopSummary,
  finalDestination: { …, finalChallenge, verification, scoring, historicalReveal,
                      finalCompletionAnimationConcept, leaderboardRevealConcept,
                      routeReplayConcept, multiplayerConvergenceBehavior, demo },
  routes: [ { id, name, theme, checkpointIds[], estimatedWalkingDistanceKm,
              expectedCompletionMinutes, maxXpExclTime } ],
  checkpoints: [ { id, name, realWorldLocation, coordinates{lat,lng}, radiusMeters,
                   designerNote, clue, hints[{text,costXp}], timing{walkFromPrevMin,challengeMin},
                   challenge{observation, randomizedPhotoInstructionExample, answerQuestion, acceptedAnswerCriteria[]},
                   verification{landmarkMatch, requiredActionCompleted, answerCorrect, confidenceConcerns},
                   scoring{baseXp, observationBonusXp, hardPhotoBonusXp},
                   historicalReveal{full, audioShort}, sources[], accessibility, demo{…} } ],
  scoring, multiplayer, demo, randomPhotoActions,
}
```

Randomized photo action is composed server-side from `RANDOM_PHOTO_ACTIONS` × `CORNERS` (+ a 1–5 finger count) per attempt, so each attempt gets a fresh instruction the submitted photo must satisfy.

---

## Engineering handoff notes

Only the things the implementation session must preserve:

1. **Keep the verification split.** GPS proximity = device geofence, pass/fail locally, **never** sent to Gemini. Gemini receives only: submitted photo, reference image, `landmarkMatch`, the resolved randomized instruction, `answerQuestion`, `acceptedAnswerCriteria`. It returns `{ landmarkMatch, requiredActionCompleted, answerCorrect, confidence }`.
2. **Randomize the photo action per attempt, server-side**, from `RANDOM_PHOTO_ACTIONS` (+ corner + finger count). The stored `randomizedPhotoInstructionExample` is only a sample — don't ship it as the fixed instruction, or old photos pass.
3. **Coordinates are desk estimates.** Field-walk every stop, replace lat/lng with a real GPS fix, then tune `radiusMeters` (start 25–40 m; never below ~25). The small ones (Kaufmann's Clock 20 m) assume the player stands at the exact corner.
4. **Confidence → manual review.** Treat the `confidenceConcerns` note as the low-confidence branch: on low confidence, queue for manual review rather than auto-fail. Auto-pass only on clear landmark + action + answer.
5. **The final must not require a running fountain.** The Point fountain is seasonal (off in winter and during maintenance). Required = confluence/tip + arrival action; running geyser = bonus only.
6. **XP is fixed and equal across routes** (900 excl. time). Don't rebalance per route; they're already equal by template. Hints are −15 / −25. Time bonus tiers: <40 min +40, <55 min +20.
7. **Never leak route info in multiplayer.** Opponents get only n/4 + XP + generic event messages. No opponent map pins, no location names, XP updates only on checkpoint completion.
8. **Historical reveal fires only AFTER a checkpoint passes** — it's the reward, never shown before arrival. `audioShort` is the optional narration string.
9. **Don't invent content.** Every observable here was verified against the cited sources. If a stop changes (a marquee reworded, a sign removed), update `challenge`/`verification`/`acceptedAnswerCriteria` together — don't paper over it with a guessable trivia question.
10. **Assumptions logged:** Foundry Trail starts east (Grant St) and has a longer final westward leg to the Point; Marquee Trail is slightly shorter and offsets with denser Cultural District spacing — both were accepted to keep all three converging cleanly on the fountain with equal XP. Mellon Square and Heinz Hall were verified but left unused (spare, swappable checkpoints).
