/**
 * Waypoint Wars — "Three Rivers Run" demo hunt (Downtown Pittsburgh)
 * -----------------------------------------------------------------------------
 * Content-only seed. No app logic here — shapes are illustrative and meant to be
 * adapted into the engineering session's shared TypeScript types.
 *
 * VERIFY BEFORE SHIPPING:
 *  - Every coordinate below is a best-estimate desk value. Walk each stop with a
 *    GPS device and replace lat/lng with a real fix, then tune radiusMeters.
 *  - All observable details (counts, shapes, signage) were verified against
 *    public sources (see `sources` on each checkpoint), but confirm on-site that
 *    the object is still present and photographable from a public sidewalk.
 *
 * ANTI-CHEAT SPLIT (do not blur these):
 *  - GPS proximity  -> device geofence only. NEVER sent to Gemini.
 *  - Photo + answer  -> Gemini verification, using the `verification` block.
 *  - randomizedPhotoActions -> server picks ONE per attempt so stale/borrowed
 *    photos fail the requiredActionCompleted check.
 */

// ---- shared enums / pools ---------------------------------------------------

export const RANDOM_PHOTO_ACTIONS = [
  { id: "fingers", template: "Hold up {n} fingers in the {corner} of the frame", randomize: ["n:1-5", "corner"] },
  { id: "peace", template: "Make a peace sign in the {corner} of the frame", randomize: ["corner"] },
  { id: "point-left", template: "Include your left hand pointing at the landmark", randomize: [] },
  { id: "shoe", template: "Include the tip of one shoe at the bottom edge of the frame", randomize: [] },
  { id: "palm", template: "Hold one open palm, facing the camera, beside the landmark", randomize: [] },
  { id: "thumbs", template: "Give a thumbs-up in the {corner} of the frame", randomize: ["corner"] },
] as const;

export const CORNERS = ["lower-left", "lower-right", "upper-left", "upper-right"] as const;

export const SCORING = {
  checkpointBaseXp: 100,        // GPS + photo pass
  observationBonusXp: 30,       // correct answer question
  hardPhotoBonusXp: 20,         // randomized action clearly performed
  hint1PenaltyXp: -15,
  hint2PenaltyXp: -25,          // additional, on top of hint1 if both used
  finalDestinationBonusXp: 150, // on top of the final's own 150 (base+answer+photo)
  timeBonus: [                  // evaluated once, at finish; first match wins
    { underMinutes: 40, xp: 40 },
    { underMinutes: 55, xp: 20 },
  ],
  maxRouteXpExclTime: 900,      // 4*(100+30+20) + (100+30+20) + 150
  maxRouteXpInclTime: 940,
  tieBreakers: [
    "higherTotalXp",
    "moreObservationAnswersCorrect",
    "earlierFinishTimestamp",
    "fewerHintsUsed",
  ],
} as const;

// ---- checkpoints ------------------------------------------------------------

export const checkpoints = [
  // ========================= ROUTE A — CONFLUENCE TRAIL =====================
  {
    id: "cp_smithfield_bridge",
    name: "Smithfield Street Bridge",
    realWorldLocation: "Downtown (Fort Pitt Blvd) approach/portal of the Smithfield Street Bridge over the Monongahela",
    coordinates: { latitude: 40.4360, longitude: -80.0007 },
    radiusMeters: 40,
    designerNote: "Route A opener. Strong, unmistakable observable (lens-shaped truss + Gothic portal). Keep the player on the pedestrian walkway; do not send them onto the roadway.",
    clue: "Where the city's oldest river crossing still stands, two great steel eyes lie on their sides and stare across the Mon. Find the portal and look down the span.",
    hints: [
      { text: "It carries Smithfield Street across the Monongahela toward Station Square — start from the downtown end.", costXp: -15 },
      { text: "The side trusses bow out and back in like a lens or an eye. That's your photo.", costXp: -25 },
    ],
    timing: { walkFromPrevMin: 0, challengeMin: 5 },
    challenge: {
      observation: "The side trusses are a 'lenticular' design — each bows out then back in like a double-convex lens. Frame the bridge down its length so that lens shape reads.",
      randomizedPhotoInstructionExample: "Include the tip of one shoe at the bottom edge of the frame",
      answerQuestion: "What everyday shape does each side truss resemble?",
      acceptedAnswerCriteria: ["lens", "eye", "oval", "almond", "lenticular", "convex lens"],
    },
    verification: {
      landmarkMatch: "A long steel through-truss whose top and bottom chords curve apart then together (lens/eye profile); pale blue-and-beige paint; a stone Gothic-Revival portal arch at the entrance; river and Station Square beyond.",
      requiredActionCompleted: "The randomized action is present (e.g., a shoe tip at the bottom edge, or N fingers in the named corner).",
      answerCorrect: "Any synonym for a lens/eye/oval shape.",
      confidenceConcerns: "Lower confidence if the shot is a tight close-up of paint or railing with no truss curvature visible, or taken at night with the truss unlit.",
    },
    scoring: { baseXp: 100, observationBonusXp: 30, hardPhotoBonusXp: 20 },
    historicalReveal: {
      full: "You're standing on the oldest river bridge in Pittsburgh and one of the first major steel bridges in the United States. Gustav Lindenthal — just 32 — completed it in 1883 on the stone piers of an earlier John Roebling suspension bridge, which itself replaced a wooden covered bridge lost to the Great Fire of 1845. Its lens-shaped 'lenticular' trusses were the first of their kind used in America; the whole span is now a National Historic Landmark.",
      audioShort: "This is Pittsburgh's oldest river bridge — an 1883 steel span whose lens-shaped trusses were the first of their kind in America.",
    },
    sources: ["ASCE Historic Landmarks", "SAH Archipedia", "Wikipedia: Smithfield Street Bridge"],
    accessibility: "Flat sidewalk approach; stay on the pedestrian walkway, away from traffic lanes. Windy over the river.",
    demo: {
      referenceImageId: "ref_smithfield_bridge",
      scriptedArrival: true,
      sampleSubmissionId: "sample_smithfield_pass",
    },
  },
  {
    id: "cp_market_square",
    name: "Market Square (The Diamond)",
    realWorldLocation: "Market Square plaza, Downtown Pittsburgh; Original Oyster House storefront",
    coordinates: { latitude: 40.4411, longitude: -80.0019 },
    radiusMeters: 30,
    designerNote: "Central, lively, easy win. Observable = the Original Oyster House (oldest bar/restaurant in the city). Answer keys off the square's 1784 nickname.",
    clue: "In the open square Pittsburgh has gathered in since 1784, find the fried-fish sign of the city's oldest tavern and put it in frame.",
    hints: [
      { text: "Look for the Original Oyster House — it's been on this square since 1870.", costXp: -15 },
      { text: "The square's old name is a gem — literally a card suit. It shows up on nearby signage.", costXp: -25 },
    ],
    timing: { walkFromPrevMin: 9, challengeMin: 5 },
    challenge: {
      observation: "Find the Original Oyster House, Pittsburgh's oldest bar and restaurant (since 1870), and photograph its storefront/sign.",
      randomizedPhotoInstructionExample: "Hold up 3 fingers in the lower-right corner of the frame",
      answerQuestion: "By what one-word nickname has this square been known since 1784?",
      acceptedAnswerCriteria: ["diamond", "the diamond"],
    },
    verification: {
      landmarkMatch: "A vintage storefront reading 'Original Oyster House' on the open Market Square plaza (Belgian-block paving, surrounding low-rise brick facades).",
      requiredActionCompleted: "Named finger count in the named corner (or whichever action was assigned).",
      answerCorrect: "'Diamond' / 'the Diamond'.",
      confidenceConcerns: "Lower confidence if the storefront name isn't legible, or if a different Market Square eatery is shown.",
    },
    scoring: { baseXp: 100, observationBonusXp: 30, hardPhotoBonusXp: 20 },
    historicalReveal: {
      full: "Colonel George Woods and his assistant Thomas Vickroy laid out this square in 1784, surveying for the Penn family, and called it 'the Diamond,' a Scotch-Irish word for a town's public square. It held Pittsburgh's first courthouse, its first jail, and the first newspaper published west of the Alleghenies. The Original Oyster House opened in 1870 on the site of the 1827 Bear Tavern and is still the oldest bar and restaurant in the city.",
      audioShort: "This is 'the Diamond,' Pittsburgh's public square since 1784 — home to its first courthouse and, since 1870, the city's oldest bar.",
    },
    sources: ["WPXI 'On This Day'", "Popular Pittsburgh", "Post-Gazette The Digs"],
    accessibility: "Fully flat pedestrian plaza; benches; busy at lunchtime. Exterior only — no need to enter any business.",
    demo: { referenceImageId: "ref_oyster_house", scriptedArrival: true, sampleSubmissionId: "sample_market_square_pass" },
  },
  {
    id: "cp_ppg_place",
    name: "PPG Place Plaza",
    realWorldLocation: "PPG Place plaza, between Third & Fourth Ave and Market & Wood St",
    coordinates: { latitude: 40.4405, longitude: -80.0030 },
    radiusMeters: 30,
    designerNote: "Countable observable (four black balls under the obelisk) = a clean, un-guessable answer. Glass 'castle' makes a great photo.",
    clue: "Six towers of mirror glass rise like a fairy-tale castle. At their feet, a stone needle balances on a cluster of dark spheres — count what holds it up.",
    hints: [
      { text: "Go to the plaza at the center of the glass complex; the needle is a pink granite obelisk.", costXp: -15 },
      { text: "Look at the base of the obelisk — large black stone balls carry it. Count them.", costXp: -25 },
    ],
    timing: { walkFromPrevMin: 3, challengeMin: 5 },
    challenge: {
      observation: "The plaza obelisk rests on large black granite spheres (locals call it the 'Tomb of the Unknown Bowler'). Count the spheres, and frame the obelisk with the glass tower behind it.",
      randomizedPhotoInstructionExample: "Include your left hand pointing at the landmark",
      answerQuestion: "How many large black stone balls support the base of the plaza obelisk?",
      acceptedAnswerCriteria: ["4", "four"],
    },
    verification: {
      landmarkMatch: "A pink granite obelisk on a cluster of black spheres, set in a plaza ringed by reflective neo-Gothic glass towers bristling with spires.",
      requiredActionCompleted: "Left hand pointing at the obelisk/tower (or whichever action was assigned).",
      answerCorrect: "Exactly four.",
      confidenceConcerns: "Lower confidence if only the tower (no obelisk) is shown, or in winter when the ice rink/holiday tree may partly obscure the obelisk base.",
    },
    scoring: { baseXp: 100, observationBonusXp: 30, hardPhotoBonusXp: 20 },
    historicalReveal: {
      full: "PPG Place, finished in 1984 by Philip Johnson and John Burgee, wraps modern offices in almost a million square feet of reflective glass and 231 neo-Gothic spires — a mirror-glass castle. Johnson said he was echoing two Pittsburgh landmarks you may meet elsewhere on this hunt: the University of Pittsburgh's Cathedral of Learning and H. H. Richardson's Allegheny County Courthouse.",
      audioShort: "PPG Place is a 1984 glass 'castle' of 231 neo-Gothic spires, designed by Philip Johnson to echo the city's older Gothic landmarks.",
    },
    sources: ["PPG Place official", "WPXI history", "Vitro Glass", "ArchDaily"],
    accessibility: "Flat, open plaza; seasonal fountain in summer and ice rink in winter. Exterior only.",
    demo: { referenceImageId: "ref_ppg_obelisk", scriptedArrival: true, sampleSubmissionId: "sample_ppg_pass" },
  },
  {
    id: "cp_block_house",
    name: "Fort Pitt Block House",
    realWorldLocation: "Fort Pitt Block House, Point State Park",
    coordinates: { latitude: 40.4412, longitude: -80.0098 },
    radiusMeters: 25,
    designerNote: "Route A's near-Point stop. Observable = the five-sided brick redoubt and its musket loopholes. Exterior is always viewable even when the museum is closed.",
    clue: "The oldest building in Pittsburgh is small, brick, and armed with narrow slits. Reach the little fort in the park and count its walls.",
    hints: [
      { text: "It's the tiny brick redoubt near the Fort Pitt Museum, close to the Point.", costXp: -15 },
      { text: "Walk its perimeter — it isn't a square. Count the sides.", costXp: -25 },
    ],
    timing: { walkFromPrevMin: 9, challengeMin: 5 },
    challenge: {
      observation: "The Block House is a five-sided (pentagonal) brick redoubt lined with narrow musket loopholes on both floors. Photograph the building so a loophole and its five-sided shape are visible.",
      randomizedPhotoInstructionExample: "Give a thumbs-up in the upper-right corner of the frame",
      answerQuestion: "How many sides does the brick blockhouse have?",
      acceptedAnswerCriteria: ["5", "five", "pentagon", "pentagonal"],
    },
    verification: {
      landmarkMatch: "A small two-story brick redoubt with narrow vertical musket slits and a pyramidal roof, standing in parkland near the rivers.",
      requiredActionCompleted: "Thumbs-up in the named corner (or whichever action was assigned).",
      answerCorrect: "Five / pentagonal.",
      confidenceConcerns: "Lower confidence if the shot is an interior/plaque photo with no exterior wall count, or a generic parkland photo.",
    },
    scoring: { baseXp: 100, observationBonusXp: 30, hardPhotoBonusXp: 20 },
    historicalReveal: {
      full: "Built in 1764 as one of five small redoubts guarding Fort Pitt, this is the oldest building in Pittsburgh and the only surviving piece of the fort. Colonel Henry Bouquet ordered it after Native attacks on the frontier, which is why its walls are pierced with musket loopholes. It survived demolition because families lived in it for over a century, and in 1894 Mary Schenley gave it to the Daughters of the American Revolution, who protect it still.",
      audioShort: "This 1764 brick redoubt is Pittsburgh's oldest building — the last surviving piece of Fort Pitt, saved and still cared for by the DAR.",
    },
    sources: ["Fort Pitt Block House official", "Pittsburgh Quarterly", "Steel City History", "Wikipedia"],
    accessibility: "Paved park paths, ADA accessible; exterior viewable anytime. Near the fountain and museum.",
    demo: { referenceImageId: "ref_block_house", scriptedArrival: true, sampleSubmissionId: "sample_block_house_pass" },
  },

  // ========================== ROUTE B — FOUNDRY TRAIL =======================
  {
    id: "cp_us_steel_tower",
    name: "U.S. Steel Tower",
    realWorldLocation: "600 Grant Street (base of the U.S. Steel / UPMC Tower)",
    coordinates: { latitude: 40.4416, longitude: -79.9957 },
    radiusMeters: 35,
    designerNote: "Route B opener. Observable = the rust-brown weathering steel and the giant exterior columns. Photograph at street level looking up a column.",
    clue: "The tallest tower in the city was built to rust on purpose. Stand at the foot of one of its enormous outside columns and look up.",
    hints: [
      { text: "It's the tallest building downtown, on Grant Street, with huge steel columns standing outside the glass.", costXp: -15 },
      { text: "Look at the steel's surface — it isn't painted. Its color is the answer.", costXp: -25 },
    ],
    timing: { walkFromPrevMin: 0, challengeMin: 5 },
    challenge: {
      observation: "The tower is clad in COR-TEN 'weathering steel' that forms a rust-brown protective skin, with massive structural columns on the outside of the building. Photograph one exterior column / the rust-brown facade looking upward.",
      randomizedPhotoInstructionExample: "Hold one open palm, facing the camera, beside the landmark",
      answerQuestion: "What color has the tower's weathering steel turned?",
      acceptedAnswerCriteria: ["rust", "rusty", "rust-brown", "brown", "orange", "bronze"],
    },
    verification: {
      landmarkMatch: "Massive rust-brown steel structural columns at street level, a dark curtain-wall tower rising above; the tower's footprint is triangular with notched corners.",
      requiredActionCompleted: "Open palm beside a column (or whichever action was assigned).",
      answerCorrect: "Any rust/brown/orange descriptor.",
      confidenceConcerns: "Lower confidence if a neighboring building's columns are shown, or if the frame is all sky/glass with no weathering-steel surface visible.",
    },
    scoring: { baseXp: 100, observationBonusXp: 30, hardPhotoBonusXp: 20 },
    historicalReveal: {
      full: "Finished in 1970, this is the tallest building in Pittsburgh (64 floors, 841 feet), with a triangular floor plan that mirrors the city's 'Golden Triangle.' U.S. Steel built it as a showcase for COR-TEN, the weathering steel it patented in 1933 — steel engineered to rust into a stable brown patina that protects the metal beneath, so it never needs paint.",
      audioShort: "Pittsburgh's tallest tower, from 1970, is a triangular showcase for weathering steel — metal designed to rust on purpose and never be painted.",
    },
    sources: ["Double Stone Steel", "Wikipedia: U.S. Steel Tower"],
    accessibility: "Flat downtown sidewalk at the tower base; busy office district on weekdays. Exterior only.",
    demo: { referenceImageId: "ref_us_steel_column", scriptedArrival: true, sampleSubmissionId: "sample_us_steel_pass" },
  },
  {
    id: "cp_courthouse_bridge_of_sighs",
    name: "Allegheny County Courthouse — Bridge of Sighs",
    realWorldLocation: "Ross Street side of the Allegheny County Courthouse (436 Grant St), enclosed bridge to the old jail",
    coordinates: { latitude: 40.4385, longitude: -79.9953 },
    radiusMeters: 30,
    designerNote: "Answer keys off the street sign (Ross St), which forces on-site reading. Direct the player to the Ross Street side, not Grant Street.",
    clue: "Behind the great stone courthouse, an enclosed bridge crosses a street in mid-air, once used to walk prisoners from their cells. Find it and read the street it leaps.",
    hints: [
      { text: "Go around to the Ross Street side of the courthouse and look up.", costXp: -15 },
      { text: "The street name is posted on the corner sign right beneath the bridge.", costXp: -25 },
    ],
    timing: { walkFromPrevMin: 6, challengeMin: 5 },
    challenge: {
      observation: "An enclosed stone 'Bridge of Sighs' arches over the street, linking the courthouse to the old jail. Photograph the bridge spanning the street.",
      randomizedPhotoInstructionExample: "Hold up 2 fingers in the lower-left corner of the frame",
      answerQuestion: "Which street does the enclosed Bridge of Sighs span?",
      acceptedAnswerCriteria: ["ross", "ross street", "ross st"],
    },
    verification: {
      landmarkMatch: "A short, roofed stone bridge with small arched openings spanning a street between two heavy rusticated-granite Romanesque buildings.",
      requiredActionCompleted: "Two fingers in the named corner (or whichever action was assigned).",
      answerCorrect: "Ross Street.",
      confidenceConcerns: "Lower confidence if only a building facade is shown with no elevated bridge, or if the Grant Street front is photographed instead.",
    },
    scoring: { baseXp: 100, observationBonusXp: 30, hardPhotoBonusXp: 20 },
    historicalReveal: {
      full: "This is H. H. Richardson's masterpiece, finished in 1888 — the building that gave the whole 'Richardsonian Romanesque' style its name. Its enclosed 'Bridge of Sighs,' modeled on the one in Venice, carried prisoners from the old jail to the courtroom. In 1902 the warden's wife, Kate Soffel, fell for one of the Biddle brothers and helped the two convicted murderers escape across it — a scandal Pittsburgh still tells.",
      audioShort: "Richardson's 1888 courthouse gave a whole architectural style its name; its Venice-style Bridge of Sighs once carried prisoners — and a famous 1902 escape.",
    },
    sources: ["SAH Archipedia", "Library of Congress HABS", "Wikipedia: Allegheny County Jail"],
    accessibility: "Public sidewalk on Ross Street; the bridge is viewable from the street. Some slope on Grant/Ross.",
    demo: { referenceImageId: "ref_bridge_of_sighs", scriptedArrival: true, sampleSubmissionId: "sample_courthouse_pass" },
  },
  {
    id: "cp_kaufmanns_clock",
    name: "Kaufmann's Clock",
    realWorldLocation: "Corner of Fifth Avenue & Smithfield Street (former Kaufmann's / Macy's building)",
    coordinates: { latitude: 40.4400, longitude: -79.9986 },
    radiusMeters: 20,
    designerNote: "Small radius (single corner). Answer keys off the two street signs, forcing on-site reading rather than trivia recall.",
    clue: "For a century Pittsburghers have met sweethearts and friends beneath one bronze clock hanging from a department-store corner. Stand under it and name the crossing.",
    hints: [
      { text: "It projects from the building corner one story up, at a famous downtown intersection.", costXp: -15 },
      { text: "Two street-name signs meet at this exact corner — either one is the answer.", costXp: -25 },
    ],
    timing: { walkFromPrevMin: 6, challengeMin: 4 },
    challenge: {
      observation: "A large ornate bronze clock projects from the building corner, one story above the sidewalk. Photograph it looking up.",
      randomizedPhotoInstructionExample: "Make a peace sign in the lower-right corner of the frame",
      answerQuestion: "Name either of the two streets that meet at this corner.",
      acceptedAnswerCriteria: ["fifth", "fifth avenue", "5th", "5th avenue", "smithfield", "smithfield street"],
    },
    verification: {
      landmarkMatch: "An ornate bronze clock cantilevered from a masonry building corner, one story up, over a busy downtown intersection.",
      requiredActionCompleted: "Peace sign in the named corner (or whichever action was assigned).",
      answerCorrect: "Fifth Avenue or Smithfield Street.",
      confidenceConcerns: "Lower confidence if a generic street clock or a different building clock is shown; the clock should read as ornate bronze projecting from a corner.",
    },
    scoring: { baseXp: 100, observationBonusXp: 30, hardPhotoBonusXp: 20 },
    historicalReveal: {
      full: "The 2,500-pound bronze clock overhead went up in 1913 on the Kaufmann's department store, and 'Meet me under Kaufmann's clock' became the phrase generations of Pittsburghers used for a downtown rendezvous. The Kaufmann family's taste ran deep: they also commissioned Frank Lloyd Wright's Fallingwater. The store is apartments and shops now, but the clock still keeps time.",
      audioShort: "This 1913 bronze clock gave Pittsburgh the phrase 'meet me under Kaufmann's clock' — from the family that later commissioned Fallingwater.",
    },
    sources: ["Wikipedia: Kaufmann's", "CBS Pittsburgh", "PA Historical Marker (HMdb)"],
    accessibility: "Flat street corner; can be crowded. Exterior only. Small geofence — expect the player to stand at the corner.",
    demo: { referenceImageId: "ref_kaufmanns_clock", scriptedArrival: true, sampleSubmissionId: "sample_clock_pass" },
  },
  {
    id: "cp_dollar_bank_lions",
    name: "Dollar Bank Lions",
    realWorldLocation: "Dollar Bank, 340 Fourth Avenue (historic 'Fourth Avenue' banking row)",
    coordinates: { latitude: 40.4396, longitude: -79.9983 },
    radiusMeters: 25,
    designerNote: "Route B's last stop before the long walk to the Point. Observable = the pair of brownstone lions flanking the entrance.",
    clue: "On the old banking street, two great stone lions have guarded the people's savings since 1871. Photograph the pair.",
    hints: [
      { text: "They flank the entrance of Dollar Bank on Fourth Avenue.", costXp: -15 },
      { text: "The tradition says they guard the people's money — that word is your answer.", costXp: -25 },
    ],
    timing: { walkFromPrevMin: 3, challengeMin: 4 },
    challenge: {
      observation: "Two life-size brownstone lions flank the bank's entrance — one posed guarding, one resting. Photograph both lions.",
      randomizedPhotoInstructionExample: "Include the tip of one shoe at the bottom edge of the frame",
      answerQuestion: "By tradition, the lions stand guard over the people's ____.",
      acceptedAnswerCriteria: ["money", "savings", "the people's money"],
    },
    verification: {
      landmarkMatch: "A pair of carved stone lions on pedestals flanking an ornate columned bank entrance on a low-rise historic avenue.",
      requiredActionCompleted: "Shoe tip at the bottom edge (or whichever action was assigned).",
      answerCorrect: "Money / savings.",
      confidenceConcerns: "Lower confidence if only one lion is in frame, or if a different Fourth Avenue lion (there are several) is shown without the bank entrance.",
    },
    scoring: { baseXp: 100, observationBonusXp: 30, hardPhotoBonusXp: 20 },
    historicalReveal: {
      full: "Max Kohler carved these lions in 1871 from single blocks of Connecticut brownstone as 'guardians of the people's money.' Dollar Bank made its name letting working people open an account with as little as one dollar. The lions you see are exact replicas — the weather-worn originals were moved indoors in 2012. Fourth Avenue was Pittsburgh's Wall Street, and if you look around, more carved lions are hunting along it.",
      audioShort: "Carved in 1871 as guardians of the people's money, these Dollar Bank lions anchor Pittsburgh's old Wall Street on Fourth Avenue.",
    },
    sources: ["Dollar Bank history", "PHLF", "90.5 WESA", "The Clio"],
    accessibility: "Flat sidewalk; lions are at the entrance steps. Exterior only.",
    demo: { referenceImageId: "ref_dollar_bank_lions", scriptedArrival: true, sampleSubmissionId: "sample_lions_pass" },
  },

  // ========================== ROUTE C — MARQUEE TRAIL =======================
  {
    id: "cp_katz_plaza",
    name: "Agnes R. Katz Plaza (Eyeball Park)",
    realWorldLocation: "Agnes R. Katz Plaza, corner of 7th Street & Penn Avenue, Cultural District",
    coordinates: { latitude: 40.4437, longitude: -79.9992 },
    radiusMeters: 25,
    designerNote: "Route C opener. Delightfully un-guessable observable (giant eye-shaped benches). Answer is the body part they're shaped like.",
    clue: "In the theater district there's a plaza locals call 'Eyeball Park.' Find out why, and sit for a photo with one of its odd stone benches.",
    hints: [
      { text: "It's the small plaza at 7th and Penn with a tall bronze fountain at its center.", costXp: -15 },
      { text: "The big granite benches are carved as a body part — the one you're using to read this.", costXp: -25 },
    ],
    timing: { walkFromPrevMin: 0, challengeMin: 5 },
    challenge: {
      observation: "The plaza's oversized granite benches are carved as human eyes (three pairs), around a 25-foot bronze fountain. Photograph one of the eye-shaped benches.",
      randomizedPhotoInstructionExample: "Give a thumbs-up in the upper-left corner of the frame",
      answerQuestion: "The plaza's giant granite benches are carved in the shape of what body part?",
      acceptedAnswerCriteria: ["eye", "eyes", "eyeball", "eyeballs"],
    },
    verification: {
      landmarkMatch: "A large smooth granite bench sculpted as a human eye, in a paved plaza with a tall irregular bronze fountain and rows of clipped trees.",
      requiredActionCompleted: "Thumbs-up in the named corner (or whichever action was assigned).",
      answerCorrect: "Eye / eyeball.",
      confidenceConcerns: "Lower confidence if a plain rectangular bench is shown (there are also ordinary benches under the trees) rather than an eye-shaped one.",
    },
    scoring: { baseXp: 100, observationBonusXp: 30, hardPhotoBonusXp: 20 },
    historicalReveal: {
      full: "This is Agnes R. Katz Plaza, opened in 1999 and nicknamed 'Eyeball Park.' The eye-shaped benches and the 25-foot bronze fountain are the work of Louise Bourgeois — her largest public commission in the U.S. at the time — with landscape by Daniel Kiley and architecture by Michael Graves. Bourgeois said the fountain's two streams of water stand for a couple whose lives mesh together.",
      audioShort: "Louise Bourgeois's 'Eyeball Park' — giant eye-shaped benches and a bronze fountain, opened in 1999 in the Cultural District.",
    },
    sources: ["Pittsburgh Cultural Trust", "The Cultural Landscape Foundation", "Sculpture Magazine"],
    accessibility: "Flat paved plaza with seating. Exterior public space.",
    demo: { referenceImageId: "ref_eye_bench", scriptedArrival: true, sampleSubmissionId: "sample_katz_pass" },
  },
  {
    id: "cp_byham_theater",
    name: "Byham Theater",
    realWorldLocation: "Byham Theater, 101 Sixth Street, Cultural District",
    coordinates: { latitude: 40.4432, longitude: -80.0001 },
    radiusMeters: 25,
    designerNote: "Observable = the illuminated marquee/name sign. Answer is the single name currently on it. Exterior only — no entry.",
    clue: "A 1903 vaudeville house on Sixth Street has worn three different names in its life. Photograph the name lit on its marquee today.",
    hints: [
      { text: "It's the historic theater on Sixth Street run by the Cultural Trust.", costXp: -15 },
      { text: "The name on the marquee is a family's surname — read it off the sign.", costXp: -25 },
    ],
    timing: { walkFromPrevMin: 3, challengeMin: 4 },
    challenge: {
      observation: "Photograph the theater's illuminated marquee / vertical name sign on Sixth Street.",
      randomizedPhotoInstructionExample: "Hold up 4 fingers in the lower-right corner of the frame",
      answerQuestion: "What single name is displayed on the theater's marquee today?",
      acceptedAnswerCriteria: ["byham"],
    },
    verification: {
      landmarkMatch: "A historic theater facade with an illuminated marquee and/or vertical blade sign reading 'BYHAM' on a Cultural District street.",
      requiredActionCompleted: "Four fingers in the named corner (or whichever action was assigned).",
      answerCorrect: "Byham.",
      confidenceConcerns: "Lower confidence if a neighboring venue (Benedum, Heinz Hall, O'Reilly) marquee is shown instead, or if no legible name is captured.",
    },
    scoring: { baseXp: 100, observationBonusXp: 30, hardPhotoBonusXp: 20 },
    historicalReveal: {
      full: "This theater opened in 1903 as the Gayety, a vaudeville house that hosted stars like Ethel Barrymore and Helen Hayes. In the 1930s it became the Fulton movie palace, and in 1995 the Pittsburgh Cultural Trust restored it and renamed it the Byham after a gift from the Byham family. Three names, three eras, one stubbornly surviving building — with pressed-copper cherubs still watching from the ceiling inside.",
      audioShort: "Opened in 1903 as the Gayety, later the Fulton movie palace, and the Byham since 1995 — three names, one surviving theater.",
    },
    sources: ["Wikipedia: Byham Theater", "Pittsburgh Cultural Trust", "Experience Pennsylvania"],
    accessibility: "Flat sidewalk; exterior marquee is public. No entry required.",
    demo: { referenceImageId: "ref_byham_marquee", scriptedArrival: true, sampleSubmissionId: "sample_byham_pass" },
  },
  {
    id: "cp_clemente_bridge",
    name: "Roberto Clemente Bridge",
    realWorldLocation: "Downtown (Sixth Street) end of the Roberto Clemente Bridge over the Allegheny",
    coordinates: { latitude: 40.4444, longitude: -80.0016 },
    radiusMeters: 35,
    designerNote: "Observable = the bright yellow self-anchored suspension span. Photograph up the length from the downtown end. Do NOT ask for the Clemente statue (it's across the river at PNC Park).",
    clue: "One of three near-identical sisters crosses the Allegheny here, painted a color you can't miss, and closed to cars on ball-game days. Shoot straight up its span.",
    hints: [
      { text: "It carries Sixth Street to the North Shore and PNC Park — start from the downtown end.", costXp: -15 },
      { text: "Its paint color is the answer, and it's the same on all three 'sister' bridges.", costXp: -25 },
    ],
    timing: { walkFromPrevMin: 6, challengeMin: 4 },
    challenge: {
      observation: "This bright-yellow self-anchored suspension bridge is one of the 'Three Sisters.' Photograph it looking along its length from the downtown end.",
      randomizedPhotoInstructionExample: "Make a peace sign in the upper-right corner of the frame",
      answerQuestion: "What color is the bridge painted?",
      acceptedAnswerCriteria: ["yellow", "gold", "aztec gold"],
    },
    verification: {
      landmarkMatch: "A bright-yellow suspension bridge with tall towers and eyebar chains, crossing a river toward a ballpark/North Shore skyline.",
      requiredActionCompleted: "Peace sign in the named corner (or whichever action was assigned).",
      answerCorrect: "Yellow / gold.",
      confidenceConcerns: "Lower confidence if the shot could be any of the three near-identical sister bridges photographed generically — that's acceptable here since only color + form are checked.",
    },
    scoring: { baseXp: 100, observationBonusXp: 30, hardPhotoBonusXp: 20 },
    historicalReveal: {
      full: "This is the Roberto Clemente (Sixth Street) Bridge, one of the 'Three Sisters' at 6th, 7th, and 9th Streets — the only set of three nearly identical bridges anywhere, and among the first self-anchored suspension spans built in the United States. It was renamed in 1998 for the Pirates' Hall of Fame right fielder, and it closes to traffic and fills with pedestrians on game days at PNC Park just across the water.",
      audioShort: "The yellow Roberto Clemente Bridge is one of Pittsburgh's 'Three Sisters' — closed to cars on Pirates game days and named for the Hall of Famer.",
    },
    sources: ["Wikipedia: Roberto Clemente Bridge", "Bridgeville Area Historical Society", "Positively Pittsburgh"],
    accessibility: "Sidewalk/pedestrian access at the downtown end; windy over the river. Stay on the walkway.",
    demo: { referenceImageId: "ref_clemente_bridge", scriptedArrival: true, sampleSubmissionId: "sample_clemente_pass" },
  },
  {
    id: "cp_fort_duquesne_outline",
    name: "Fort Duquesne Outline",
    realWorldLocation: "Granite tracery of Fort Duquesne in the Great Lawn, Point State Park",
    coordinates: { latitude: 40.4423, longitude: -80.0083 },
    radiusMeters: 30,
    designerNote: "Route C's near-Point stop; distinct from Route A's Block House. Observable = the granite outline in the lawn with a bronze medallion at its center.",
    clue: "In the great lawn near the rivers, the ghost of a vanished French fort is drawn in stone on the ground. Find the outline and its center marker.",
    hints: [
      { text: "Look down, not up — a granite line traces a fort's shape in the open lawn.", costXp: -15 },
      { text: "A European power built and then burned this fort in the 1750s. That nation is the answer.", costXp: -25 },
    ],
    timing: { walkFromPrevMin: 11, challengeMin: 5 },
    challenge: {
      observation: "A granite tracery set into the lawn outlines the vanished Fort Duquesne, with a bronze medallion at its center depicting the fort. Photograph the stone outline / the central medallion.",
      randomizedPhotoInstructionExample: "Include your left hand pointing at the landmark",
      answerQuestion: "The outline traces a fort built by which European power?",
      acceptedAnswerCriteria: ["french", "france", "the french"],
    },
    verification: {
      landmarkMatch: "A pale granite line set flush into a broad grass lawn forming a geometric fort outline, often with a round bronze medallion at the center; rivers/park beyond.",
      requiredActionCompleted: "Left hand pointing at the outline/medallion (or whichever action was assigned).",
      answerCorrect: "French / France.",
      confidenceConcerns: "Lower confidence if a plain lawn or an unrelated plaque is shown with no visible stone outline.",
    },
    scoring: { baseXp: 100, observationBonusXp: 30, hardPhotoBonusXp: 20 },
    historicalReveal: {
      full: "You're standing on the footprint of Fort Duquesne, built by the French in 1754 to hold the forks of the Ohio. When the British closed in during 1758, the French burned it themselves rather than surrender it, and the British then built the far larger Fort Pitt nearby. The granite outline — bronze medallion at its heart — marks exactly where the French fort stood, and it glows under LED light at night.",
      audioShort: "This stone outline marks Fort Duquesne — built by the French in 1754 and burned by them in 1758 rather than let the British take it.",
    },
    sources: ["PA DCNR Point State Park", "NPS", "Great Allegheny Passage"],
    accessibility: "Flat lawn and paved park paths, ADA accessible. Open parkland.",
    demo: { referenceImageId: "ref_fort_duquesne_outline", scriptedArrival: true, sampleSubmissionId: "sample_duquesne_pass" },
  },
] as const;

// ---- final destination (shared) --------------------------------------------

export const finalDestination = {
  id: "final_point_fountain",
  name: "The Point — Confluence Fountain",
  realWorldLocation: "Tip of Point State Park, at the Point Fountain / Great Allegheny Passage bronze terminus medallion",
  coordinates: { latitude: 40.4417, longitude: -80.0093 },
  radiusMeters: 40,
  designerNote: "Shared finish for all three routes. The three rivers meeting = the three routes meeting. Do NOT require the fountain geyser to be running (it is seasonal / can be under maintenance); make the running geyser a bonus, not a requirement.",
  clue: "Every trail ends where two rivers become a third. Reach the very tip of the Point, find the bronze medallion set in the stone, and mark your arrival together.",
  hints: [
    { text: "Walk to the farthest tip of Point State Park, past the fountain, to the confluence.", costXp: -15 },
    { text: "A large round bronze medallion is set into the stone at the tip — that's your marker.", costXp: -25 },
  ],
  timing: { walkFromPrevMin: 3, challengeMin: 6 },
  finalChallenge:
    "All three trails converge here. Stand at the tip of the Point where the rivers meet, find the bronze medallion set into the stone (the western end of the Great Allegheny Passage), and take one arrival photo — a team group shot, or a selfie with the confluence behind you. If the fountain's geyser is running, get it in frame for bonus flair.",
  randomizedPhotoInstructionExample: "Everyone in frame holds up the number of checkpoints they cleared (fingers)",
  answerQuestion: "Two rivers meet here to form a third — name the river that begins at this point.",
  acceptedAnswerCriteria: ["ohio", "ohio river"],
  verification: {
    landmarkMatch: "The tip of a point of land where two rivers join into one, open sky/water, park paving; ideally a round bronze medallion in the stone and/or a tall fountain geyser.",
    requiredActionCompleted: "The arrival action (group in frame / assigned gesture). Running geyser in frame = bonus only.",
    answerCorrect: "Ohio / Ohio River.",
    confidenceConcerns: "Lower confidence if the water/confluence isn't visible, or if the shot is elsewhere in the park with no riverfront. Never fail solely because the fountain is off.",
  },
  scoring: {
    baseXp: 100,
    observationBonusXp: 30,
    hardPhotoBonusXp: 20,
    finalDestinationBonusXp: 150,
  },
  historicalReveal: {
    full: "This is the Point — where the Allegheny and the Monongahela join to form the Ohio, the spot that made Pittsburgh worth fighting three empires over and the birthplace of the city. The 150-foot fountain, opened in 1974 (an idea Frank Lloyd Wright first floated in 1947), draws on water locals call the 'fourth river,' an aquifer beneath your feet. The bronze medallion marks Mile 0 — the western end of the 150-mile Great Allegheny Passage. Three rivers, three trails, one finish.",
    audioShort: "The Point, where the Allegheny and Monongahela form the Ohio — Pittsburgh's birthplace, its 150-foot fountain, and Mile 0 of the Great Allegheny Passage.",
  },
  finalCompletionAnimationConcept:
    "On verify, the fountain art 'erupts' full-height, water tinted with the player's team color; the three route paths animate inward across the map and lock together at the Point with a burst.",
  leaderboardRevealConcept:
    "Map dissolves to a podium/leaderboard: final XP, elapsed time, hints used, and observation streak per player/team; winner's row highlighted in team color with a confluence motif.",
  routeReplayConcept:
    "After the leaderboard, replay each player's full path drawing checkpoint-to-checkpoint with timestamps and the photo they submitted at each pin; all three replays can play side by side to show the asymmetric routes converging.",
  multiplayerConvergenceBehavior:
    "All routes' final clue resolves to this single geofence. Players/teams arrive independently; the first to verify locks the top time, but XP (not speed) usually decides the winner. The map only reveals opponents' full routes AFTER the match closes, in replay.",
  sources: ["PA DCNR", "Pittsburgh Magazine", "Clio", "Great Allegheny Passage", "NPS"],
  accessibility: "Paved, ADA-accessible park paths to the tip. Fountain is seasonal (off in winter and during maintenance). Open and exposed — wind and sun.",
  demo: { referenceImageId: "ref_point_fountain", scriptedArrival: true, sampleSubmissionId: "sample_final_pass" },
} as const;

// ---- routes -----------------------------------------------------------------

export const routes = [
  {
    id: "route_confluence",
    name: "Confluence Trail",
    theme: "Rivers & the founding — the city's oldest ground, followed downstream to the Point.",
    checkpointIds: ["cp_smithfield_bridge", "cp_market_square", "cp_ppg_place", "cp_block_house"],
    estimatedWalkingDistanceKm: 1.7,
    expectedCompletionMinutes: 49,
    maxXpExclTime: 900,
  },
  {
    id: "route_foundry",
    name: "Foundry Trail",
    theme: "Steel, stone & money — the towers, courthouse, and banks the city built.",
    checkpointIds: ["cp_us_steel_tower", "cp_courthouse_bridge_of_sighs", "cp_kaufmanns_clock", "cp_dollar_bank_lions"],
    estimatedWalkingDistanceKm: 1.85,
    expectedCompletionMinutes: 52,
    maxXpExclTime: 900,
  },
  {
    id: "route_marquee",
    name: "Marquee Trail",
    theme: "Arts & discovery — the Cultural District and public art, out to the rivers.",
    checkpointIds: ["cp_katz_plaza", "cp_byham_theater", "cp_clemente_bridge", "cp_fort_duquesne_outline"],
    estimatedWalkingDistanceKm: 1.55,
    expectedCompletionMinutes: 48,
    maxXpExclTime: 900,
  },
] as const;

// ---- multiplayer rules (content level) -------------------------------------

export const multiplayer = {
  routeAssignment:
    "At match start each player/team is randomly assigned one of the three routes; in 3-way play the assignment is A/B/C with no repeats. Teammates always share one route.",
  opponentsCanSee: ["checkpointsClearedCount (n/4)", "totalXp", "liveEventFeedMessages"],
  hiddenFromOpponents: ["clues", "exactLocations", "routeName", "futureCheckpoints", "mapPosition"],
  progressDisplay: "A simple leaderboard of name + n/4 + XP, plus a scrolling event feed. No opponent pins on the map during play.",
  opponentXpTiming: "Opponent XP updates on their checkpoint completion (not per-attempt), so nothing leaks route timing beyond 'a checkpoint was cleared.'",
  teamMode:
    "2–4 players share one route and one progress state; any member's GPS+photo completes a checkpoint, XP is pooled, and the final challenge is a team group photo.",
  ties: SCORING.tieBreakers,
  earlyFinish:
    "A player who finishes first locks their score and time, then watches the live leaderboard/feed and can start their route replay. The match closes when all finish or a match timer expires; the final leaderboard locks at close.",
  onOpponentCheckpoint: "Show a generic event message + bump their leaderboard XP. Never name the location.",
  eventMessages: [
    "An explorer just cleared a checkpoint — two stops from the Point.",
    "Someone nailed a tricky photo challenge. +20 bonus.",
    "A rival burned a hint to move forward.",
    "First to the river! An explorer reached their third checkpoint.",
    "An explorer has reached the Point. The fountain awaits.",
    "New XP leader — the lead just changed hands.",
  ],
} as const;

// ---- demo script (content level) -------------------------------------------

export const demo = {
  targetDurationMinutes: 4,
  simulated: ["playerGpsMovement (scripted walk)", "opponentPlayer (scripted bot)", "submittedPhotos (pre-loaded samples)"],
  identicalToRealGameplay: [
    "clue -> arrival -> challenge -> Gemini verification -> XP -> historical reveal -> next clue loop",
    "the Gemini verification call and response handling",
    "XP math and hint penalties",
    "event feed, leaderboard, and route replay",
  ],
  beats: [
    { t: "0:00", beat: "Host creates lobby 'Three Rivers Run — Downtown', match code shown." },
    { t: "0:10", beat: "Bot player 'Nakama' joins via code." },
    { t: "0:20", beat: "Route assignment animation: you = Confluence Trail (blue), Nakama = Foundry Trail (amber), drawn as distinct paths." },
    { t: "0:35", beat: "First clue (Smithfield Street Bridge). Scripted walk moves your avatar toward the geofence." },
    { t: "1:00", beat: "Geofence triggers: checkpoint-discovered animation, observation challenge + randomized photo action revealed." },
    { t: "1:15", beat: "Pre-loaded sample photo submitted -> Gemini verification animation -> PASS, with landmarkMatch / requiredActionCompleted / answerCorrect shown." },
    { t: "1:35", beat: "XP animation +100 +30 +20; historical reveal card slides in; audio-narration toggle plays the short reveal." },
    { t: "1:55", beat: "Event feed: 'Foundry explorer cleared a checkpoint'; leaderboard XP bumps." },
    { t: "2:05", beat: "Next checkpoint: tap Hint 1, XP -15, hint reveals — shows the cost mechanic." },
    { t: "2:20", beat: "Fast-forward (sped-up) through the remaining checkpoints to build to the finale." },
    { t: "2:45", beat: "Race to the final: both avatars converge on the Point; the two route paths light up and meet at the fountain." },
    { t: "3:05", beat: "Final challenge: arrival group photo -> verify -> fountain 'erupts' in team color, confetti." },
    { t: "3:25", beat: "Final leaderboard reveal: XP, time, hints; winner highlighted." },
    { t: "3:40", beat: "Animated route replay retraces your full path with checkpoint pins, times, and submitted photos." },
  ],
} as const;

// ---- top-level hunt ---------------------------------------------------------

export const pittsburghDemoHunt = {
  id: "hunt_three_rivers_run",
  name: "Three Rivers Run",
  tagline: "Three trails through downtown Pittsburgh. One fountain where the rivers — and the racers — meet.",
  description:
    "A compact, walkable downtown Pittsburgh hunt. Each team is sent on a different but balanced trail of four observation checkpoints, all converging on the Point State Park fountain at the confluence of the three rivers. Every stop is a real place with a real, on-site observable — count the black balls under the PPG obelisk, read the street the Bridge of Sighs leaps, find the eye-shaped benches — verified by GPS, a live photo with a randomized action, and a short observation question.",
  geographicArea: "Downtown Pittsburgh (Golden Triangle): Cultural District, Grant St, Smithfield/Fourth Ave, Market Square, PPG Place, and Point State Park.",
  expectedDurationMinutes: 50,
  difficulty: "easy-to-moderate (all public sidewalks, ~1.5–1.9 km walking per route)",
  players: "1–3 solo players/teams for the asymmetric 3-route demo; team mode 2–4 per team.",
  gameLoopSummary: "CLUE -> NAVIGATE -> ARRIVE (GPS) -> OBSERVE -> PHOTO + ANSWER -> VERIFY (Gemini) -> XP -> HISTORICAL REVEAL -> NEXT CLUE, ending in a shared climactic finish at the Point.",
  finalDestination,
  routes,
  checkpoints,
  scoring: SCORING,
  multiplayer,
  demo,
  randomPhotoActions: RANDOM_PHOTO_ACTIONS,
} as const;

export default pittsburghDemoHunt;
