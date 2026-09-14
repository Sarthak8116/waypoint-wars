# Historical fact-check

I said verifying the history was the one thing only you could do. That was
half-right: I can check the **factual claims** against public sources. What I
still cannot check is whether each observable is **physically still there and
photographable from a public sidewalk** — that needs someone standing in
Downtown Pittsburgh.

Checked 2026-09-12 against the sources linked below.

---

## ✅ Verified correct

### Smithfield Street Bridge — the opening clue of Route 1

Every claim in the reveal holds:

| Claim | Verdict |
| --- | --- |
| Pittsburgh's oldest river bridge | ✅ |
| Among the first major steel bridges in the US | ✅ |
| Completed 1883 | ✅ opened for traffic 19 March 1883 |
| Gustav Lindenthal designed it | ✅ |
| Built on the stone piers of an earlier Roebling suspension bridge | ✅ |
| First use of the lenticular truss in America | ✅ |
| National Historic Landmark | ✅ designated 1976 |

**Answer `lens / eye / oval / lenticular` — correct.** "Lenticular" is the term
the sources themselves use, and they gloss it as "lens-shaped".

One detail I could not confirm to the day: **"just 32"**. Lindenthal was born in
1850, so at the March 1883 opening he was 32 if his birthday fell later in the
year, 33 otherwise. If a judge presses, say "in his early thirties" — the point
survives and you are not defending a number you cannot source.

### PPG Place — the riskiest question in the set

**"How many large black stone balls support the base of the plaza obelisk?"
Answer: 4. ✅ Confirmed.** The 44-foot rose granite obelisk rests on four black
spheres — locals call it the "Tomb of the Unknown Bowler". This was the answer
I most expected to be wrong; it is right.

### Allegheny County Courthouse — Bridge of Sighs

**Spans Ross Street. ✅** It connects the courthouse (436 Grant) to the old jail
(420 Ross) across Ross Street.

### Fort Pitt Block House

**Pentagonal, five sides. ✅** Built 1764, the shape mirrors Fort Pitt itself in
miniature. Also confirmed: oldest structure in Pittsburgh, and Mary Schenley
gave it to the DAR in 1894 — both as your reveal states.

### Roberto Clemente Bridge

**"Aztec gold". ✅** Originally green and grey; repainted Aztec gold in 1975
after the city adopted black and gold. `yellow / gold / aztec gold` all accepted,
which is the right call — a player will say "yellow".

### Agnes R. Katz Plaza

**Eye-shaped benches, opened 1999, 25-foot bronze fountain. ✅** All by Louise
Bourgeois; "Eyeball Park" is a genuine local nickname. Sources say **three**
Eye Benches — your question only asks the shape, so this does not affect the
answer, but do not volunteer a count.

### U.S. Steel Tower

**64 floors, 841 feet, completed 1970, triangular, COR-TEN. ✅** All correct.
Sources confirm the columns were deliberately placed on the exterior to
showcase COR-TEN, exactly as your reveal says.

---

## ⚠️ Still unverified — and only you can close these

1. **Is the observable still there, and visible from a public sidewalk?**
   Signage changes, plaques get removed, scaffolding goes up. Your own seed
   file warns about this. The Byham marquee and the Kaufmann's clock are the
   ones most likely to have changed.
2. **Coordinates.** Still desk estimates with 30–40m radii. Fine for the
   simulated demo; a walk-through is needed before real-GPS play.
3. ~~The remaining smaller dates and attributions.~~ **Checked — see below.
   Every factual claim in the seeded content has now been checked against a
   public source.** What is still open is only item 1: whether each observable
   is physically still there.

---

## Checked 2026-09-13 — and one was wrong

### ❌ Market Square — CORRECTED

The reveal said **"Philadelphia surveyors laid out this square in 1784."** They
were not Philadelphia surveyors. The survey was carried out by **Colonel George
Woods, assisted by Thomas Vickroy**, both of Bedford County, working *for* the
Philadelphia-based Penn proprietors — "A Draught of the Town Plat of Pittsburgh,
Surveyed for John Penn, Jr., and John Penn, by George Woods, May 31st 1784."

Corrected in `data/source/three-rivers-run.seed.ts`, which is the content of
record. **`data/pittsburgh-hunts.json` is a build artifact** — `pnpm build`
regenerates it from the seed, so an edit made there is silently discarded on
the next build. I made that mistake twice before noticing the file reverting
under me. If you are correcting a fact, edit the seed.

The rest of that reveal holds: "the Diamond" is the Scotch-Irish idiom for a
public square ✅; first courthouse and first jail (both 1795) ✅; first newspaper
west of the Alleghenies, the Pittsburgh Gazette, 1786 ✅.

### ✅ Original Oyster House

Opened **12 October 1870** ✅; its current premises were the **Bear Tavern,
1827** ✅; it is **Pittsburgh's oldest bar and restaurant** ✅.

### ✅ Kaufmann's clock

The current clock went up **with the 1913 store expansion** ✅ (an earlier
free-standing four-dial clock dates from 1887). "Meet me under Kaufmann's clock"
✅. The Kaufmanns did commission Wright's **Fallingwater** ✅.

The **2,500 lb** figure is widely repeated but is not in the sources checked —
uncited rather than contradicted.

### ❌ Byham Theater — CORRECTED

The reveal said it **"opened in 1903 as the Gayety."** It was *built* in 1903
and **opened on Halloween night 1904**. Corrected.

The rest holds: a vaudeville house that hosted **Ethel Barrymore and Helen
Hayes** ✅; renamed **The Fulton in the 1930s** when it became a full-time
movie house ✅; renamed the **Byham in 1995** after a naming gift from Carolyn
and William Byham ✅.

The **pressed-copper cherubs** are not in the sources checked — uncited rather
than contradicted.

### ❌ The Point — CORRECTED

The reveal credited Frank Lloyd Wright with the idea for the fountain: *"opened
in 1974 (an idea Frank Lloyd Wright first floated in 1947)."* He had nothing to
do with the fountain. What Wright proposed for the Point, in **April 1947**,
was a **circular civic centre over 1,000 feet across** containing an opera
house, arena, cinemas and a convention hall, wrapped in a spiral roadway. It
was never built, and the site became Point State Park.

Rewritten to say that, which is both true and a far better story than the
version it replaces.

Verified around it: fountain **opened 1974** ✅, sprays to **150 feet** ✅,
the fountain is the **western terminus of the Great Allegheny Passage** ✅.
The **bronze Mile 0 medallion** and the **"fourth river" aquifer** are not in
the sources checked — uncited rather than contradicted.

### ✅ Fort Duquesne

Built by the French in **1754** at the confluence ✅; the French **destroyed
and abandoned it** ahead of the Forbes Expedition on **25 November 1758**
rather than surrender it ✅; the British then built the larger **Fort Pitt**
(1759–61) ✅.

### ✅ Dollar Bank lions

**Max Kohler**, **1871**, carved from a single block of brownstone ✅; the
weather-worn originals moved **indoors in February 2012** ✅; Dollar Bank really
did let anyone open an account with **one dollar** ✅.

Two nuances worth knowing if challenged: Kohler had an assistant, **Richard C.
Morgan**, whom the reveal does not name; and the sources say "quarry-bedded
brownstone" without confirming **Connecticut** as the source.

---

## If a judge challenges a fact

Say what is true: the content is hand-authored with sources cited per
checkpoint, the headline claims have been verified against public sources, and
the coordinates are desk estimates pending a walk-through. That is a stronger
answer than a confident guess.

## Sources

- [Smithfield Street Bridge — Wikipedia](https://en.wikipedia.org/wiki/Smithfield_Street_Bridge)
- [Smithfield Street Bridge — ASCE Historic Landmarks](https://www.asce.org/about-civil-engineering/history-and-heritage/historic-landmarks/smithfield-street-bridge)
- [Smithfield Street Bridge — SAH Archipedia](https://sah-archipedia.org/buildings/PA-01-AL4)
- [PPG Place — Wikipedia](https://en.wikipedia.org/wiki/PPG_Place)
- [Allegheny County Courthouse — Wikipedia](https://en.wikipedia.org/wiki/Allegheny_County_Courthouse)
- [Bridge of Sighs, Ross Street façades — Library of Congress](https://www.loc.gov/resource/hhh.pa0034.photos/?sp=8)
- [Fort Pitt Block House — official site](http://www.fortpittblockhouse.com/about/)
- [Fort Pitt Block House — Wikipedia](https://en.wikipedia.org/wiki/Fort_Pitt_Block_House)
- [Roberto Clemente Bridge — Wikipedia](https://en.wikipedia.org/wiki/Roberto_Clemente_Bridge)
- [Katz Plaza — Pittsburgh Cultural Trust](https://trustarts.org/pct_home/visual-arts/long-term-projects/katz-plaza)
- [Agnes R. Katz Plaza — TCLF](https://www.tclf.org/landscapes/agnes-r-katz-plaza)
- [U.S. Steel Tower — Wikipedia](https://en.wikipedia.org/wiki/U.S._Steel_Tower)
- [Market Square — Wikipedia](https://en.wikipedia.org/wiki/Market_Square_(Pittsburgh))
- [The Original Oyster House — Our Story](http://www.originaloysterhousepittsburgh.com/our-story)
- [Kaufmann's — Wikipedia](https://en.wikipedia.org/wiki/Kaufmann%27s)
- [Dollar Bank — Wikipedia](https://en.wikipedia.org/wiki/Dollar_Bank)
- [Byham Theater — Wikipedia](https://en.wikipedia.org/wiki/Byham_Theater)
- [Fort Duquesne — Wikipedia](https://en.wikipedia.org/wiki/Fort_Duquesne)
- [Point State Park — Wikipedia](https://en.wikipedia.org/wiki/Point_State_Park)
- [Point Park Civic Center — Wikipedia](https://en.wikipedia.org/wiki/Point_Park_Civic_Center)
- [Market Square Historic District walking tour — Pittsburgh History & Landmarks Foundation](https://phlf.org/event/walking-tour-market-square-historic-district/)
