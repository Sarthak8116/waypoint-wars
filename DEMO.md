# Three-minute demo script

Setup, then words to say. Adapt the phrasing — the structure is what matters.

## Before you walk up

It is deployed — you do not need a laptop server. Present against:

**https://waypoint-wars-6k98bgh01-waypoint-wars.vercel.app**

Open these tabs in advance and leave them loaded:

1. `/demo` — the replay
2. `/play?demo=1` — solo, simulated walking, no GPS prompt
3. `/lobby` ×2 windows, side by side

`?demo=1` matters: it latches Demo Mode for the whole session, so no screen
asks for GPS mid-presentation.

### Photo verification is a coin flip right now

Measured against the deployed server: **three of six** submissions get a real
verdict; the other three come back *"Verification is rate limited right now."*
The Gemini key is on the free tier and its per-model quota keeps running dry.

So a photo submission on stage has roughly even odds. Plan for it:

- **Solo is unaffected.** It scores on the written answer and labels the result
  "photo NOT verified" — honest, and it always completes.
- **A rate-limited submission no longer costs the player anything.** It used to
  return a rejection, which recorded an incorrect attempt and took 15 XP for
  our outage while telling the player "nothing was counted against you". It now
  reads *"Not sure yet · nothing charged"* and you submit again. **This fix is
  server-side and is NOT deployed** — see the warning above.
- If you want reliable verification, deploy the fallback model:

```bash
railway variables --set ALLOW_PHOTOLESS_SUBMISSIONS=true
railway up --service waypoint-server --detach
```

`gemini-flash-lite-latest` has its own quota and has answered every time it has
been tried.

---

## 0:00 — The problem (20s)

> "When you visit a new city, you either follow a walking tour that talks at
> you, or you wander and miss everything. Neither is memorable. We turned
> exploring a city into a multiplayer game."

## 0:20 — The hook: different routes, same finish (40s)

**Show `/demo`. Press play.**

> "Three players, three different routes through Downtown Pittsburgh. One walks
> the rivers and the founding. One walks steel and money. One walks the arts
> district. They never visit the same place —"

**Let the paths animate. Point at the convergence.**

> "— and they all finish at The Point, where the Allegheny and the Monongahela
> become the Ohio. Three rivers, three trails, one finish."

> "That's the design: because everyone walks somewhere different, everyone
> comes back with a different story. That's what makes the end screen worth
> looking at."

**Point at the discoveries panel as pins light up.**

## 1:00 — The gameplay loop (50s)

**Switch to `/play?demo=1`. Press Start hunt, then Walk there.**

> "Here's what a checkpoint actually is. You get a clue — not the name of the
> place, a clue."

**Read the clue aloud. It's good; let it land.**

> "You walk there. And when you arrive, the game gives you an instruction it
> did not give you before you left."

**Point at the randomized instruction.**

> "Hold up three fingers. That's generated on arrival, so you can't stage the
> photo in advance, and you can't use someone else's."

**Take/submit the photo.**

> "Gemini checks three things: is this the right landmark, did you do the
> required action, and is your observation answer right. All three, or it
> doesn't count."

**On approval, the reveal appears.**

> "And *now* you get the history. You earned it — it isn't homework, it's a
> reward."

## 1:50 — Multiplayer (40s)

**Two `/lobby` windows. Create, show the QR, join.**

> "Multiplayer is a QR code. No app, no install — it's a web app, you scan and
> you're playing."

**Start. Show both getting different first clues.**

> "Different routes, live scores, and you can see roughly where your opponents
> are — but only roughly. We never send anyone your exact location."

## 2:30 — The fairness problem (20s)

> "Different routes means finishing time is meaningless. So the speed bonus is
> normalized per checkpoint against that checkpoint's own expected time, and
> clamped — beating expectations by double gains what missing by double loses.
> One weird checkpoint can't swamp four honest ones."

## 2:50 — Close (10s)

> "Different routes, real-world verification, shared finish. Everyone learns
> something different about the same city, then compares."

---

## Questions you will get, and honest answers

**"Can't someone just fake the photo?"**
> "Four gates: GPS, landmark match, an action they couldn't know in advance,
> and the observation answer. It raises the cost a lot. It's a deterrent, not
> proof — someone with a friend downtown could beat it. We'd rather say that
> than pretend otherwise."

Say this plainly. It reads as rigor; claiming fraud-proof reads as naivety.

**"What stops the AI being talked into passing you?"**
> "Gemini never awards points. It reports what it sees, the server decides. And
> the answer check is a string comparison we own — the model's opinion on the
> answer is advisory. We have a test that feeds it a prompt injection with the
> model insisting the answer is correct, and it still rejects."

**"How do you know the routes are fair?"**
> "Route length is NOT how we make it fair, because it can't be — the three
> seeded routes genuinely differ, 999m to 1683m in straight-line distance
> between stops. What makes it fair is that the speed bonus is normalized per
> checkpoint against that checkpoint's own expected time, and clamped. A long
> route has more checkpoints' worth of expected time to beat; it doesn't have
> a harder bar on any single one."

Do not claim the routes are within 9% of each other. They are not, there is no
build check enforcing it, and the declared `approxDistanceMeters` values
(1700 / 1850 / 1550) are hand-written estimates that do not match the
geometry. The per-checkpoint normalization is the real answer and it is a
better one.

**GENERATED** hunts are balanced — the generator runs a swap pass that got
Savannah from a 51% spread to 4%. That is worth saying, and it is measured.

**"Did you walk these routes?"**
> Be honest. The coordinates are desk estimates with tight radii; the demo runs
> on simulated movement. If you *have* walked one by then, say so.

**"Is that a typical score?"**
> "No — Demo Mode walks 25x real pace, so every checkpoint earns the full
> speed bonus. 225 XP a stop is the ceiling, not the average. On foot you'd
> earn somewhere between 175 and 225 depending on pace."

Say this before anyone asks. The scoring breakdown is 100 for the checkpoint,
50 for the right answer, up to 50 for speed and 25 for not taking a hint; a
hint costs 45 (the −20 penalty plus the forfeited +25 bonus) and a wrong
answer costs 15.

**"Is this real or simulated right now?"**
> "Simulated movement, real everything else — real scoring engine, real Gemini
> calls, real multiplayer server. The walking is what's faked, and it's labeled
> on screen the whole time."

---

## If something breaks

| Symptom | Do this |
| --- | --- |
| Map blank | OSM tiles need network — see "Warm the tile cache" below |
| Photo always rejected | Expected today — Gemini quota. See the warning at the top. Use solo |
| Verification hangs | `curl <server>/health` — if `gemini` isn't `live`, the key didn't load |
| Lobby won't join | The code resolves via `/api/rooms/:code`; the server must be running |
| Anything else | `/demo` is a self-contained, pre-computed replay. It needs the web app only |

**`/demo` is your safety net.** If everything else dies, it still tells the
whole story in ninety seconds.

## Warm the tile cache before you present

The map streams tiles from OpenStreetMap's public servers. On throttled venue
wifi or a captive portal the map area renders as a flat backdrop — the routes
and markers still draw, but the street map behind them does not, and "three
routes converging on Downtown" is most of the visual pitch.

**Do this while you still have good wifi:**

1. Open `/demo` and let the replay run once, start to finish.
2. Open `/play?demo=1` and walk one checkpoint.
3. Do NOT hard-refresh after that.

Those tiles are then in the browser's HTTP cache and will render even if the
network degrades. It costs thirty seconds and removes the single biggest
environmental risk.

I deliberately did NOT bundle tiles with the app: OpenStreetMap's usage policy
prohibits bulk downloading, and their servers return an "Access blocked" image
to clients that try it. If you ever want genuinely offline maps, the supported
route is a paid provider — set `MAPTILER_KEY` and swap the style URL.
