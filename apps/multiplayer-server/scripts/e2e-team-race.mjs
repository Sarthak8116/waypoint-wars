/**
 * Team-race end-to-end.
 *
 * Team mode is in the MVP scope and is unit-tested, but had never actually run
 * live. It is structurally different from individual mode in ways unit tests
 * can miss: teammates SHARE a route, share one XP total, appear as ONE
 * leaderboard entry, and a submission by either member must advance both.
 *
 * Runs against the deterministic mock (boot the server with GEMINI_API_KEY
 * empty) so it costs no quota.
 *
 *   pnpm --filter @ww/multiplayer-server e2e:team
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

class Member {
  constructor(room, name) {
    this.room = room;
    this.name = name;
    this.log = [];
    this.checkpoint = null;
    this.finished = false;

    room.onMessage('*', (type, payload) => {
      this.log.push({ type, payload });
      if (type === 'hunt_started') this.checkpoint = payload.firstCheckpoint;
      if (type === 'checkpoint_unlocked') this.checkpoint = payload.checkpoint;
      if (type === 'hunt_finished') this.finished = true;
    });
  }

  get self() {
    return this.room.state.players.get(this.room.sessionId);
  }
  get xp() {
    return this.self?.xp ?? 0;
  }
  get index() {
    return this.self?.checkpointIndex ?? 0;
  }
  get teamId() {
    return this.self?.teamId ?? null;
  }

  async solve() {
    const cp = this.checkpoint;
    if (!cp) return { ok: false, why: 'no checkpoint' };
    const full = byId.get(cp.id);

    this.room.send('update_location', {
      latitude: cp.latitude,
      longitude: cp.longitude,
      accuracyMeters: 5,
    });
    await wait(320);
    this.room.send('request_instruction', { checkpointId: cp.id });
    await wait(320);

    const instruction =
      [...this.log].reverse().find((m) => m.type === 'instruction_issued')?.payload?.instruction ??
      '';

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

    for (let i = 0; i < 30; i++) {
      await wait(200);
      if (this.index > before || this.finished) break;
    }
    const verdict = [...this.log].reverse().find((m) => m.type === 'submission_result')?.payload
      ?.verdict;
    return { ok: this.index > before || this.finished, outcome: verdict?.outcome, cp: cp.id };
  }
}

async function main() {
  console.log('\nTeam race — two members, one route, one score\n' + '─'.repeat(64));

  const health = await fetch(`${API}/health`).then((r) => r.json());
  console.log(`  gemini=${health.integrations.gemini}`);
  if (health.integrations.gemini === 'live') {
    console.log('  ⚠ Gemini LIVE — this will spend quota. Boot with GEMINI_API_KEY= for the mock.\n');
  }

  const hostClient = new Client(WS);
  const host = await hostClient.create('hunt', {
    playerName: 'Ana',
    mode: 'team-race',
    teamName: 'Rivers',
    huntId: bundle.hunt.id,
  });
  const ana = new Member(host, 'Ana');
  await wait(300);

  const { roomId } = await fetch(`${API}/api/rooms/${host.state.code}`).then((r) => r.json());

  const c2 = new Client(WS);
  const guest = await c2.joinById(roomId, { playerName: 'Bo', teamName: 'Rivers' });
  const bo = new Member(guest, 'Bo');
  await wait(500);

  check('both joined', host.state.players.size === 2);
  check('room is in team mode', host.state.settings?.mode === 'team-race', host.state.settings?.mode);

  host.send('start_hunt', {});
  await wait(900);

  check('both received a first clue', Boolean(ana.checkpoint && bo.checkpoint));

  // The defining property of team mode.
  check(
    'teammates share the SAME first checkpoint',
    ana.checkpoint?.id === bo.checkpoint?.id,
    `${ana.checkpoint?.id} vs ${bo.checkpoint?.id}`,
  );
  check(
    'teammates share a teamId',
    Boolean(ana.teamId) && ana.teamId === bo.teamId,
    String(ana.teamId),
  );

  const total = bundle.routes[0].checkpointIds.length;
  console.log(`\n  ${total} checkpoints, members alternating who submits…`);

  for (let step = 0; step < total; step++) {
    // Alternate submitter: either teammate's submission must advance the team.
    const submitter = step % 2 === 0 ? ana : bo;
    const other = step % 2 === 0 ? bo : ana;
    const beforeOther = other.index;

    const r = await submitter.solve();
    await wait(400);

    console.log(
      `    ${step + 1}/${total}  ${submitter.name} submitted ${r.outcome ?? '-'} (${r.cp ?? '-'})  ` +
        `· teammate index ${beforeOther} -> ${other.index}`,
    );

    if (!r.ok) {
      check(`step ${step + 1} advanced`, false, r.why ?? r.outcome);
      break;
    }

    // One member solving must carry the other forward, or the team desyncs.
    if (!other.finished) {
      check(
        `step ${step + 1}: teammate advanced too`,
        other.index === submitter.index,
        `${other.index} vs ${submitter.index}`,
      );
    }

    // Keep the non-submitter's clue fresh for the next round.
    other.checkpoint = submitter.checkpoint;
  }

  await wait(1200);

  console.log('');
  check('team XP is shared, not doubled', ana.xp === bo.xp, `${ana.xp} / ${bo.xp}`);
  check('team earned XP', ana.xp > 0, String(ana.xp));
  check('both members see the hunt finished', ana.finished && bo.finished);

  const board =
    [...ana.log].reverse().find((m) => m.type === 'hunt_finished')?.payload?.entries ?? [];
  check('leaderboard has ONE entry for the team', board.length === 1, `${board.length} entries`);
  if (board.length === 1) {
    check('entry is flagged as a team', board[0].isTeam === true, String(board[0].isTeam));
    console.log(`\n    1. ${board[0].displayName} — ${board[0].xp} XP  ${board[0].checkpointsCompleted}/${board[0].totalCheckpoints}`);
  }

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
  console.log('\n✓ team race runs end to end\n');
}

main().catch((err) => {
  console.error('\n✖ team race crashed:', err?.message ?? err);
  process.exit(1);
});
