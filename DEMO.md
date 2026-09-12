# Three-minute demo script

Setup, then words to say. Adapt the phrasing — the structure is what matters.

## Before you walk up

```bash
pnpm dev            # web :3000, server :2567
pnpm demo:check     # expect 19/19
```

Open these tabs in advance and leave them loaded:

1. `localhost:3000/demo`
2. `localhost:3000/play`
3. `localhost:3000/lobby` (×2 windows, side by side)

If `demo:check` is not 19/19, **fix that first** — it checks the four things
that actually broke during the build.

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

**Switch to `/play`. You're mid-route or start fresh.**

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
> "The three routes are within 9% of each other on measured walking distance
> and identical on base XP. The content build fails if that drifts past 20%."

**"Did you walk these routes?"**
> Be honest. The coordinates are desk estimates with tight radii; the demo runs
> on simulated movement. If you *have* walked one by then, say so.

**"Is this real or simulated right now?"**
> "Simulated movement, real everything else — real scoring engine, real Gemini
> calls, real multiplayer server. The walking is what's faked, and it's labeled
> on screen the whole time."

---

## If something breaks

| Symptom | Do this |
| --- | --- |
| Map blank | OSM tiles need network. Fall back to `/demo`, it's the strongest piece anyway |
| Verification hangs | Check `curl localhost:2567/health` — if `gemini` isn't `live`, the key didn't load |
| Lobby won't join | The code resolves via `/api/rooms/:code`; the server must be running |
| Anything else | `/demo` is a self-contained, pre-computed replay. It needs the web app only |

**`/demo` is your safety net.** If everything else dies, it still tells the
whole story in ninety seconds.
