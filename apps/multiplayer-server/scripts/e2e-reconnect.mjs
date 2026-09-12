/**
 * Reconnection end-to-end.
 *
 * The realistic demo failure: a phone locks, wifi drops, someone backgrounds
 * the tab mid-hunt. The spec calls for reconnection support and the room
 * implements it, but it had only ever been unit-tested. What matters is that
 * a returning player keeps their XP, their place in the route, and their
 * assigned route — losing any of those mid-demo is unrecoverable.
 *
 * Run against the deterministic mock (GEMINI_API_KEY= on the server) — costs
 * no quota.
 *
 *   pnpm --filter @ww/multiplayer-server e2e:reconnect
 */

import { Client } from 'colyseus.js';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const WS = process.env.WS_URL ?? 'ws://localhost:2567';
const API = process.env.API_URL ?? 'http://localhost:2567';

const here = dirname(fileURLToPath(import.meta.url));
const bundle = JSON.parse(
  readFileSync(resolve(here, '../../../data/pittsburgh-hunts.json'), 'utf8'),
);
const byId = new Map(bundle.checkpoints.map((c) => [c.id, c]));

const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok, detail });
  console.log(`  ${ok ? '✓' : '✖'} ${name}${detail ? ` — ${detail}` : ''}`);
  return ok;
};
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const TINY_JPEG =
  'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AKp//2Q==';

function track(room) {
  const state = { log: [], checkpoint: null };
  room.onMessage('*', (type, payload) => {
    state.log.push({ type, payload });
    if (type === 'hunt_started') state.checkpoint = payload.firstCheckpoint;
    if (type === 'checkpoint_unlocked') state.checkpoint = payload.checkpoint;
  });
  return state;
}

async function solve(room, tracked) {
  const cp = tracked.checkpoint;
  if (!cp) return false;
  const full = byId.get(cp.id);

  room.send('update_location', { latitude: cp.latitude, longitude: cp.longitude, accuracyMeters: 5 });
  await wait(320);
  room.send('request_instruction', { checkpointId: cp.id });
  await wait(320);

  const instruction =
    [...tracked.log].reverse().find((m) => m.type === 'instruction_issued')?.payload?.instruction ??
    '';

  const before = room.state.players.get(room.sessionId)?.checkpointIndex ?? 0;
  room.send('submit_checkpoint', {
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
    if ((room.state.players.get(room.sessionId)?.checkpointIndex ?? 0) > before) return true;
  }
  return false;
}

async function main() {
  console.log('\nReconnection — a player drops mid-hunt and comes back\n' + '─'.repeat(64));

  const health = await fetch(`${API}/health`).then((r) => r.json());
  console.log(`  gemini=${health.integrations.gemini}`);

  const hostClient = new Client(WS);
  const host = await hostClient.create('hunt', {
    playerName: 'Stayer',
    mode: 'individual-race',
    huntId: bundle.hunt.id,
  });
  const hostT = track(host);
  await wait(300);

  const { roomId } = await fetch(`${API}/api/rooms/${host.state.code}`).then((r) => r.json());

  const dropperClient = new Client(WS);
  let dropper = await dropperClient.joinById(roomId, { playerName: 'Dropper' });
  let dropperT = track(dropper);
  await wait(400);

  host.send('start_hunt', {});
  await wait(900);

  const routeBefore = dropperT.checkpoint?.id;
  check('hunt started, dropper has a clue', Boolean(routeBefore), routeBefore ?? '-');

  // Build up some state worth losing.
  await solve(dropper, dropperT);
  await solve(dropper, dropperT);
  await wait(400);

  const self = () => dropper.state.players.get(dropper.sessionId);
  const xpBefore = self()?.xp ?? 0;
  const indexBefore = self()?.checkpointIndex ?? 0;
  const sessionId = dropper.sessionId;
  const reconnectionToken = dropper.reconnectionToken;

  check('dropper made progress before dropping', indexBefore >= 2 && xpBefore > 0, `index=${indexBefore} xp=${xpBefore}`);

  // --- the drop ----------------------------------------------------------
  console.log('\n  …dropper loses connection…');
  await dropper.leave(false); // consented:false — simulates a lost connection
  await wait(900);

  // The room should still know about them, flagged disconnected.
  const stillPresent = host.state.players.get(sessionId);
  check('room still holds the player while they are away', Boolean(stillPresent));
  if (stillPresent) {
    check('player is flagged disconnected', stillPresent.connected === false, String(stillPresent.connected));
    check('their XP is preserved while away', stillPresent.xp === xpBefore, `${stillPresent.xp} vs ${xpBefore}`);
  }

  // --- the return --------------------------------------------------------
  console.log('  …dropper reconnects…\n');
  let reconnected = null;
  try {
    reconnected = await dropperClient.reconnect(reconnectionToken);
  } catch (err) {
    check('reconnect succeeded', false, err?.message ?? String(err));
  }

  if (reconnected) {
    dropper = reconnected;
    dropperT = track(dropper);
    await wait(800);

    const after = dropper.state.players.get(dropper.sessionId);
    check('reconnect succeeded', true);
    check('XP survived the drop', after?.xp === xpBefore, `${after?.xp} vs ${xpBefore}`);
    check(
      'checkpoint index survived the drop',
      after?.checkpointIndex === indexBefore,
      `${after?.checkpointIndex} vs ${indexBefore}`,
    );
    check('marked connected again', after?.connected === true, String(after?.connected));

    // The real question: can they keep playing?
    dropper.send('request_instruction', { checkpointId: '' }); // nudge; ignored if invalid
    await wait(300);

    // Recover the active clue — a returning client needs it re-sent or it is stuck.
    const gotClue =
      dropperT.checkpoint !== null ||
      dropperT.log.some((m) => m.type === 'checkpoint_unlocked' || m.type === 'hunt_started');
    check(
      'returning player can recover their active clue',
      gotClue,
      gotClue ? '' : 'no clue re-sent — the player would be stuck staring at nothing',
    );
  }

  // The player who never dropped must be unaffected.
  check('the other player kept playing throughout', Boolean(hostT.checkpoint));

  await host.leave();
  try {
    await dropper.leave();
  } catch {
    /* already gone */
  }

  console.log('\n' + '─'.repeat(64));
  const failed = results.filter((r) => !r.ok);
  console.log(`${results.length - failed.length}/${results.length} checks passed`);
  if (failed.length) {
    console.log('\nFAILED:');
    for (const f of failed) console.log(`  · ${f.name}${f.detail ? ` (${f.detail})` : ''}`);
    process.exit(1);
  }
  console.log('\n✓ reconnection preserves the run\n');
}

main().catch((err) => {
  console.error('\n✖ reconnect test crashed:', err?.message ?? err);
  process.exit(1);
});
