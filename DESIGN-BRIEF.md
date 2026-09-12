Design **Waypoint Wars** — wireframe mockups for a real-world scavenger-hunt game. Mobile-first, played outdoors on a phone, one-handed, in sunlight. Please plan the aesthetic direction first, then lay out every screen below.

---

## What the product is

Players walk a real city solving location-specific challenges. Each player gets a **different route** through Downtown Pittsburgh, and every route ends at **the same finish** — The Point, where two rivers become a third.

A checkpoint has three layers, and the order matters to the whole feel of the product:

1. **The clue** — enough to find a place without naming it. *"Where the city's oldest river crossing still stands, two great steel eyes lie on their sides and stare across the Mon."*
2. **The challenge** — something that requires physically being there. An observation question about a small physical detail, plus a photo. On arrival, and not before, the game issues a **randomized instruction** ("hold up three fingers", "include something red in the shot") so a photo can't be staged in advance. Google Gemini verifies the landmark, the action, and the answer.
3. **The reveal** — the actual history, shown *only after* you succeed. This is the emotional core: **the history is a reward, not homework.** Design should make the reveal feel earned — it is the moment the product is about.

Because everyone walks somewhere different, everyone comes back with a different story. The end screen exists so people compare what they found.

## Who is using it, and where

A tourist or a group of friends, **standing on a street corner, holding a phone in one hand**, possibly in bright sun, possibly cold, wanting to look up at a building rather than down at a screen. This drives most of the design:

- **Glanceable.** The screen is consulted in bursts between walking. Nothing should need study.
- **Thumb-reachable.** Primary actions in the lower third. Minimum 48px targets.
- **High contrast.** Legible in daylight.
- **Never block the walk.** Animations under one second. No modal that traps someone mid-street.
- The map is the backdrop; the current instruction is the foreground. Only ever **one** thing to do.

## Hard structural constraint

A full-bleed map fills the screen. A **bottom sheet** carries the current state and actions. A thin transparent game HUD (XP, countdown, checkpoint progress) floats at the top over the map.

The HUD occupies the **top-left (XP)** and **top-right (timer)** corners — any banner or status pill must fit in the gap between them, or sit below. This has already caused collisions; please design the top strip deliberately.

Future checkpoints are **never** shown. Only the current target and already-completed stops appear on the map. The unknown is the point.

---

## Screens to design

### 1. Home
Entry. Product name, one-line explanation, three routes in: **Play solo**, **Multiplayer lobby**, **Creator**. Plus a small system-status row of pills showing which integrations are live vs. mocked (e.g. `gemini: live`, `storage: file`, `elevenlabs: disabled`). That honesty row should look intentional, not like debug output.

### 2. Route replay / demo — *the most important screen*
This is what gets shown to an audience to explain the product in ninety seconds. Full map with **three players' paths animating simultaneously** in three distinct colours, converging on one finish pin. Below: playback controls (play/pause, restart, 1× / 2× / 4×), a scrub bar, a live per-player XP row (name, route name, XP, colour swatch), and a feed of **"Discoveries along the way"** — the route-exclusive history surfacing as each pin is reached.

The convergence is the story. Make it read instantly.

### 3. Solo hunt — the main game loop, five states of one screen
- **Pre-start** — your assigned route name, stop count, a primary "Start hunt" button, and a secondary choice between real GPS and a simulated "Demo Mode".
- **Navigating** — "CLUE 3 OF 5", the clue text (this is prose worth reading — give it room and good typography), distance remaining, a hint button labelled with its XP cost.
- **Arrived** — an unmistakable state change. The observation question, the photo requirement, and the **randomized instruction in a visually distinct callout** — it is the anti-cheat mechanic and should feel like the game speaking to you. Camera capture, photo preview, retake, an answer field, submit.
- **Verifying** — a photo is going to an AI model; this takes 1–5 seconds and occasionally longer. Needs an honest waiting state.
- **Reveal** — *the payoff.* XP earned, the place's real name, 2–4 sentences of genuine history, cited sources, and "Next clue". This should feel like a small gift. It is the screen people will remember.
- **Rejected** — helpful, not punishing. The model says things like *"The image is entirely black, so the landmark isn't visible. The text answer matches the accepted list."* Show which half was wrong. The typed answer is preserved; only the photo clears.
- **Finished** — final XP, discoveries count, a route to the replay.

### 4. Multiplayer lobby
Two modes on one screen: **create a room** (individual vs. team toggle, then create) and **join with a six-character code** (e.g. `XJS2VN`, unambiguous alphabet, no O/0/I/1 — design the input to suit). Once in a room: the code displayed large, a **QR code** (joining must work for a stranger who has never seen the app — scan, browser opens, playing), a player list, and a host-only "Start hunt".

### 5. Multiplayer race
The solo loop plus opponents. Opponents appear as **progress only** — name, checkpoints done, XP, a hint-used marker — and as **deliberately coarse regions** on the map, never precise pins. Privacy is a product feature; make the coarseness look intentional rather than broken.

### 6. Results / leaderboard
Ranked entries: rank, name, XP, checkpoints completed, hints used. Teams appear as a single entry. Then the invitation to watch the replay and compare routes. Framing is "everyone found something different", not "you lost".

### 7. Creator dashboard — **desktop, not mobile**
An internal authoring tool with a different job and so a different density. Three columns: hunt/route forms on the left, an editable map in the centre (click to add a checkpoint, drag markers to move), a live validation panel on the right. The validation panel shows pass/fail rules and a route-balance table, and the publish button is disabled while any rule fails. This screen should feel like a precise instrument — closer to a code editor than to the game.

---

## Existing palette — replace it if you can do better

A dark, slightly blue-leaning scheme is in place. Treat it as a starting point, not a constraint:

```
bg        #0b1020    surface   #141b32    surface-2 #1d2743
line      #2a3557    text      #eef2ff    muted     #9aa6c9
accent    #5eead4  (teal)      accent-2  #a78bfa  (violet)
warn      #fbbf24    bad       #fb7185    good      #4ade80
```

Three player colours are needed for the replay that stay distinguishable **on top of a street map** and for colour-blind viewers.

## Tone

The subject is real history — 1764 blockhouses, 1883 steel bridges, eye-shaped granite benches by Louise Bourgeois. It should feel like **a good museum with a sense of humour**, not a mobile game with loot boxes. Confident, a little cinematic, never twee. XP and progression exist but should not shout over the content.

Dark theme is right: it is legible at dusk and lets the map carry the colour.

## Please avoid

- Burying the clue text. It is the best writing in the product.
- Treating the reveal as a dismissible toast. It is the reward.
- Gamification chrome — badges, confetti, aggressive streaks — competing with the history.
- Anything requiring two hands or precise aim.
- Showing future checkpoints, or opponents' exact positions. Both are deliberate.

## Deliverable

Wireframe mockups of screens 1–7, at phone width for 1–6 and desktop for 7. Include the **multiple states** of screen 3 — that is where the product actually lives. A short note on the aesthetic direction and type choices would be welcome before the layouts.
