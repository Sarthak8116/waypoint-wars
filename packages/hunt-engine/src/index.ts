/**
 * @ww/hunt-engine — the rules of Waypoint Wars.
 *
 * Framework-independent by contract: no React, no Phaser, no Colyseus, no DOM,
 * no network, no `Date.now()`, no `Math.random()`. Everything is a pure
 * function of its arguments, so the browser and the authoritative server run
 * byte-identical logic and the tests are fully deterministic.
 */

export * from './state-machine.js';
export * from './scoring.js';
export * from './answers.js';
export * from './route-assignment.js';
export * from './instructions.js';
export { createRng, hashString, shuffle } from './random.js';
export * from './routes.js';
