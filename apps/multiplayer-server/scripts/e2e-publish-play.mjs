/**
 * Creator publish -> playable, without a restart.
 *
 * That is P10's stated acceptance criterion and it had never been driven.
 * Publishing validated the bundle and wrote it to storage, but nobody had
 * confirmed the running server would then serve it, assign its routes, and
 * let two players actually play it.
 *
 * The hunt published here is a deliberately SMALL one (2 stops + a shared
 * finish) built from real Downtown coordinates, so it also proves the engine
 * is not quietly assuming five checkpoints.
 *
 *   pnpm --filter @ww/multiplayer-server e2e:publish
 */

import { Client } from 'colyseus.js';

const WS = process.env.WS_URL ?? 'ws://localhost:2567';
const API = process.env.API_URL ?? 'http://localhost:2567';

const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok, detail });
  console.log(`  ${ok ? '✓' : '✖'} ${name}${detail ? ` — ${detail}` : ''}`);
  return ok;
};
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const HUNT_ID = `hunt_creator_test_${Date.now()}`;
const FINISH_ID = `${HUNT_ID}_finish`;

const mkCheckpoint = (id, name, latitude, longitude, answer) => ({
  id,
  name,
  latitude,
  longitude,
  clue: `Find the place described as ${name.toLowerCase()}.`,
  hint: 'A generous nudge.',
  hints: [
    { text: 'A generous nudge.', costXp: -15 },
    { text: 'An almost-giveaway.', costXp: -25 },
  ],
  challengeKind: 'observe-detail',
  observationQuestion: 'What is the answer?',
  acceptedAnswers: [answer],
  photoRequirement: 'Photograph the landmark.',
  landmarkDescription: 'A building in Downtown Pittsburgh.',
  historicalReveal: 'A short, sourced history of this place.',
  sources: [{ title: 'Test source' }],
  radiusMeters: 50,
  baseXp: 100,
  expectedCompletionSeconds: 300,
});

const finish = mkCheckpoint(FINISH_ID, 'The Point', 40.4417, -80.0093, 'ohio');

const bundle = {
  hunt: {
    id: HUNT_ID,
    title: 'Creator Test Hunt',
    city: 'Pittsburgh',
    theme: 'mixed',
    duration: 'quick-detour',
    description: 'Published through the creator API.',
    finalDestination: finish,
    routeIds: [`${HUNT_ID}_a`, `${HUNT_ID}_b`],
    published: true,
  },
  routes: [
    {
      id: `${HUNT_ID}_a`,
      huntId: HUNT_ID,
      label: 'Route A',
      checkpointIds: [`${HUNT_ID}_a1`, `${HUNT_ID}_a2`, FINISH_ID],
      approxDistanceMeters: 800,
      approxDurationSeconds: 900,
    },
    {
      id: `${HUNT_ID}_b`,
      huntId: HUNT_ID,
      label: 'Route B',
      checkpointIds: [`${HUNT_ID}_b1`, `${HUNT_ID}_b2`, FINISH_ID],
      approxDistanceMeters: 820,
      approxDurationSeconds: 900,
    },
  ],
  checkpoints: [
    mkCheckpoint(`${HUNT_ID}_a1`, 'Market Square', 40.4409, -80.0021, 'diamond'),
    mkCheckpoint(`${HUNT_ID}_a2`, 'PPG Place', 40.4396, -80.0026, 'glass'),
    mkCheckpoint(`${HUNT_ID}_b1`, 'Fort Pitt Blockhouse', 40.4406, -80.0085, 'brick'),
    mkCheckpoint(`${HUNT_ID}_b2`, 'Burke Building', 40.4418, -80.0045, 'stone'),
    finish,
  ],
};

const TINY_JPEG =
  'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AKp//2Q==';

const byId = new Map(bundle.checkpoints.map((c) => [c.id, c]));

class P {
  constructor(room) {
    this.room = room;
    this.log = [];
    this.checkpoint = null;
    this.finished = false;
    this.visited = [];
    room.onMessage('*', (type, payload) => {
      this.log.push({ type, payload });
      if (type === 'hunt_started') this.checkpoint = payload.firstCheckpoint;
      if (type === 'checkpoint_unlocked') this.checkpoint = payload.checkpoint;
      if (type === 'hunt_finished') this.finished = true;
    });
  }
  get index() {
    return this.room.state.players.get(this.room.sessionId)?.checkpointIndex ?? 0;
  }
  get xp() {
    return this.room.state.players.get(this.room.sessionId)?.xp ?? 0;
  }
  async solve() {
    const cp = this.checkpoint;
    if (!cp) return false;
    this.visited.push(cp.id);
    const full = byId.get(cp.id);
    this.room.send('update_location', { latitude: cp.latitude, longitude: cp.longitude, accuracyMeters: 5 });
    await wait(300);
    this.room.send('request_instruction', { checkpointId: cp.id });
    await wait(300);
    const instruction =
      [...this.log].reverse().find((m) => m.type === 'instruction_issued')?.payload?.instruction ?? '';
    const before = this.index;
    this.room.send('submit_checkpoint', {
      submission: {
        checkpointId: cp.id,
        image: TINY_JPEG,
        latitude: cp.latitude,
        longitude: cp.longitude,
        observationAnswer: full?.acceptedAnswers?.[0] ?? '',
        randomizedInstruction: instruction,
        submittedAt: Date.now(),
      },
    });
    for (let i = 0; i < 25; i++) {
      await wait(200);
      if (this.index > before || this.finished) return true;
    }
    return false;
  }
}

async function main() {
  console.log('\nCreator publish -> playable, no restart\n' + '─'.repeat(64));

  // --- 1. publish --------------------------------------------------------
  const res = await fetch(`${API}/api/hunts`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(bundle),
  });
  const body = await res.json();
  check('publish accepted', res.status === 201, `status ${res.status}`);
  check('server reports what it stored', body.routes === 2 && body.checkpoints === 5, JSON.stringify(body));

  // --- 2. immediately readable, same process -----------------------------
  const served = await fetch(`${API}/api/hunt?huntId=${HUNT_ID}`).then((r) =>
    r.ok ? r.json() : null,
  );
  check('published hunt is served immediately', Boolean(served), served?.hunt?.title ?? 'NOT SERVED');
  if (served) {
    const raw = JSON.stringify(served);
    check(
      'published content is still stripped of answers',
      !raw.includes('acceptedAnswers') && !raw.includes('historicalReveal'),
    );
  }

  // --- 3. playable -------------------------------------------------------
  const c1 = new Client(WS);
  const host = await c1.create('hunt', { playerName: 'Cat', mode: 'individual-race', huntId: HUNT_ID });
  const cat = new P(host);
  await wait(300);

  const { roomId } = await fetch(`${API}/api/rooms/${host.state.code}`).then((r) => r.json());
  const c2 = new Client(WS);
  const guest = await c2.joinById(roomId, { playerName: 'Dog' });
  const dog = new P(guest);
  await wait(400);

  check('a room was created for the NEW hunt', host.state.settings.huntId === HUNT_ID, host.state.settings.huntId);

  host.send('start_hunt', {});
  await wait(800);

  check('both got a clue from the new hunt', Boolean(cat.checkpoint && dog.checkpoint));
  check(
    'the two new routes were assigned distinctly',
    cat.checkpoint?.id !== dog.checkpoint?.id,
    `${cat.checkpoint?.id} vs ${dog.checkpoint?.id}`,
  );

  // 3 stops, not 5 — proves nothing assumes the curated route length.
  const total = bundle.routes[0].checkpointIds.length;
  console.log(`\n  walking ${total} stops each (curated hunt has 5)…`);
  for (let i = 0; i < total; i++) {
    const a = await cat.solve();
    const b = await dog.solve();
    console.log(`    ${i + 1}/${total}  Cat ${cat.xp} XP · Dog ${dog.xp} XP`);
    if (!a && !b) break;
  }
  await wait(1000);

  console.log('');
  check('both finished the published hunt', cat.finished && dog.finished);
  check('both ended at the shared finish', cat.visited.at(-1) === FINISH_ID && dog.visited.at(-1) === FINISH_ID);
  check('both scored', cat.xp > 0 && dog.xp > 0, `${cat.xp} / ${dog.xp}`);

  // --- 4. the run persisted under the NEW hunt id ------------------------
  await wait(600);
  const runs = await fetch(`${API}/api/hunts/${HUNT_ID}/runs`).then((r) => r.json());
  check('runs persisted against the new hunt', runs.runs?.length === 2, `${runs.runs?.length ?? 0} runs`);

  await host.leave();
  await guest.leave();

  console.log('\n' + '─'.repeat(64));
  const failed = results.filter((r) => !r.ok);
  console.log(`${results.length - failed.length}/${results.length} checks passed`);
  if (failed.length) {
    console.log('\nFAILED:');
    for (const f of failed) console.log(`  · ${f.name}${f.detail ? ` (${f.detail})` : ''}`);
    process.exit(1);
  }
  console.log('\n✓ a hunt published through the API is immediately playable\n');
}

main().catch((err) => {
  console.error('\n✖ publish/play test crashed:', err?.message ?? err);
  process.exit(1);
});
