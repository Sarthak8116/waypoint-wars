/**
 * End-to-end multiplayer smoke test.
 *
 * Client and server were built separately against a shared type contract.
 * This script is the first time they actually speak: two real Colyseus
 * clients join one room, the host starts, and we assert the properties the
 * demo depends on.
 *
 * Run:  node scripts/e2e-race.mjs         (server must already be running)
 */

import { Client } from 'colyseus.js';

const WS = process.env.WS_URL ?? 'ws://localhost:2567';
const API = process.env.API_URL ?? 'http://localhost:2567';

const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok, detail });
  console.log(`${ok ? '  ✓' : '  ✖'} ${name}${detail ? ` — ${detail}` : ''}`);
};

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

/** Collect messages per client so we can assert on what each one received. */
function record(room, label) {
  const log = [];
  room.onMessage('*', (type, payload) => {
    log.push({ type, payload });
  });
  room.onError((code, msg) => console.log(`  ! ${label} room error ${code}: ${msg}`));
  return log;
}

const firstOf = (log, type) => log.find((m) => m.type === type)?.payload;

async function main() {
  console.log('\nEnd-to-end multiplayer race\n' + '─'.repeat(60));

  // --- health ------------------------------------------------------------
  const health = await fetch(`${API}/health`).then((r) => r.json());
  check('server healthy', health.ok === true);
  console.log(`    gemini=${health.integrations.gemini}  mongo=${health.integrations.mongo}`);

  // --- host creates ------------------------------------------------------
  const hostClient = new Client(WS);
  const host = await hostClient.create('hunt', {
    playerName: 'HostAva',
    mode: 'individual-race',
    huntId: 'hunt_three_rivers_run',
  });
  const hostLog = record(host, 'host');
  await wait(300);

  const code = host.state?.code;
  check('room created with a join code', typeof code === 'string' && code.length === 6, code);

  // --- code resolves over HTTP (what the QR/lobby flow needs) ------------
  const resolved = await fetch(`${API}/api/rooms/${code}`).then((r) =>
    r.ok ? r.json() : null,
  );
  check('code resolves to a roomId over HTTP', Boolean(resolved?.roomId), resolved?.roomId ?? 'FAILED');

  // --- guest joins by that roomId ---------------------------------------
  const guestClient = new Client(WS);
  const guest = await guestClient.joinById(resolved.roomId, { playerName: 'GuestBen' });
  const guestLog = record(guest, 'guest');
  await wait(400);

  check('two players in the room', host.state.players.size === 2, `size=${host.state.players.size}`);

  // --- PRIVACY: guest state must not leak host's route -------------------
  const guestState = JSON.parse(JSON.stringify(guest.state.toJSON()));
  const serialized = JSON.stringify(guestState);
  check(
    'opponent routeId absent from replicated state',
    !serialized.includes('route_confluence') &&
      !serialized.includes('route_foundry') &&
      !serialized.includes('route_marquee'),
  );

  // --- host starts -------------------------------------------------------
  host.send('start_hunt', {});
  await wait(700);

  const hostStart = firstOf(hostLog, 'hunt_started');
  const guestStart = firstOf(guestLog, 'hunt_started');
  check('both players received hunt_started', Boolean(hostStart && guestStart));

  const hostCp = hostStart?.firstCheckpoint;
  const guestCp = guestStart?.firstCheckpoint;
  check(
    'players got DIFFERENT first checkpoints',
    Boolean(hostCp && guestCp) && hostCp.id !== guestCp.id,
    `${hostCp?.id} vs ${guestCp?.id}`,
  );

  // --- PRIVACY: the clue payload must not carry answers or reveals -------
  const cpKeys = Object.keys(hostCp ?? {});
  const forbidden = ['acceptedAnswers', 'historicalReveal', 'hint', 'hiddenDetail', 'landmarkDescription'];
  const leaked = forbidden.filter((k) => cpKeys.includes(k));
  check('checkpoint payload carries no answers/reveals', leaked.length === 0, leaked.join(',') || 'clean');

  // --- ANTI-CHEAT: client cannot award itself XP -------------------------
  const xpBefore = host.state.players.get(host.sessionId)?.xp ?? 0;
  host.send('score_update', { xp: 999999 });
  host.send('submission_result', { verdict: { xpDelta: 999999 } });
  await wait(400);
  const xpAfter = host.state.players.get(host.sessionId)?.xp ?? 0;
  check('crafted XP messages are ignored', xpBefore === xpAfter, `${xpBefore} -> ${xpAfter}`);

  // --- D15: submitting a checkpoint you are not on -----------------------
  host.send('submit_checkpoint', {
    submission: {
      checkpointId: 'final_point_fountain',
      image: 'data:image/jpeg;base64,/9j/4AAQSkZJRg==',
      latitude: 40.4417,
      longitude: -80.0093,
      observationAnswer: 'ohio',
      randomizedInstruction: '',
      submittedAt: Date.now(),
    },
  });
  await wait(500);
  const idxAfterCheat = host.state.players.get(host.sessionId)?.checkpointIndex ?? 0;
  check('submission for a non-active checkpoint rejected', idxAfterCheat === 0, `index=${idxAfterCheat}`);

  // --- location privacy: opponent sees a coarse region only --------------
  const rawLat = 40.44061234;
  const rawLng = -80.00457891;
  host.send('update_location', { latitude: rawLat, longitude: rawLng, accuracyMeters: 8 });
  await wait(600);

  const region = firstOf(guestLog, 'player_region');
  check('opponent receives a region broadcast', Boolean(region));
  if (region?.region) {
    const exact =
      region.region.center.latitude === rawLat || region.region.center.longitude === rawLng;
    check('broadcast region is NOT the raw fix', !exact, JSON.stringify(region.region.center));
  }

  // --- hint flow ---------------------------------------------------------
  host.send('request_hint', { checkpointId: hostCp.id });
  await wait(400);
  const hint = firstOf(hostLog, 'hint_issued');
  check('hint returned to requester', Boolean(hint?.hint));
  check('guest did NOT receive the hint text', !guestLog.some((m) => m.type === 'hint_issued'));

  // --- instruction is gated on ARRIVAL, not on asking --------------------
  // Asking from far away must fail: the whole anti-cheat premise is that the
  // required action cannot be known before you are standing there.
  const instrBefore = hostLog.filter((m) => m.type === 'instruction_issued').length;
  host.send('request_instruction', { checkpointId: hostCp.id });
  await wait(400);
  check(
    'instruction REFUSED before arrival',
    hostLog.filter((m) => m.type === 'instruction_issued').length === instrBefore,
  );

  // Now actually walk into the geofence and ask again.
  host.send('update_location', {
    latitude: hostCp.latitude,
    longitude: hostCp.longitude,
    accuracyMeters: 6,
  });
  await wait(600);
  host.send('request_instruction', { checkpointId: hostCp.id });
  await wait(500);
  const instr = firstOf(hostLog, 'instruction_issued');
  check('instruction issued after arrival', Boolean(instr?.instruction), instr?.instruction ?? '');

  // --- a real submission at the right place ------------------------------
  host.send('submit_checkpoint', {
    submission: {
      checkpointId: hostCp.id,
      image: 'data:image/jpeg;base64,/9j/4AAQSkZJRg==',
      latitude: hostCp.latitude,
      longitude: hostCp.longitude,
      observationAnswer: 'lens',
      randomizedInstruction: instr?.instruction ?? '',
      submittedAt: Date.now(),
    },
  });
  await wait(900);
  const verdict = firstOf(hostLog, 'submission_result');
  check('server returned a verdict', Boolean(verdict?.verdict), verdict?.verdict?.outcome ?? '');

  await host.leave();
  await guest.leave();

  // --- summary -----------------------------------------------------------
  console.log('─'.repeat(60));
  const failed = results.filter((r) => !r.ok);
  console.log(`${results.length - failed.length}/${results.length} checks passed`);
  if (failed.length) {
    console.log('\nFAILED:');
    for (const f of failed) console.log(`  · ${f.name}${f.detail ? ` (${f.detail})` : ''}`);
    process.exit(1);
  }
  console.log('\n✓ end-to-end race verified\n');
}

main().catch((err) => {
  console.error('\n✖ e2e crashed:', err?.message ?? err);
  process.exit(1);
});
