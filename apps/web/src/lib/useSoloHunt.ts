'use client';

/**
 * Solo hunt controller.
 *
 * Owns the authoritative client-side state for a single-player run by driving
 * the pure `@ww/hunt-engine` state machine. Multiplayer replaces this with the
 * Colyseus room, but the RULES are identical because both sides call the same
 * engine — that is the entire point of keeping the engine framework-free.
 *
 * Nothing here animates and nothing here draws. It produces state; the map and
 * the Phaser HUD render it.
 */

import { useCallback, useMemo, useReducer, useRef, useState } from 'react';
import {
  createHuntState,
  transition,
  scoreCheckpoint,
  matchesAcceptedAnswer,
  generateInstruction,
  type HuntState,
  type HuntAction,
} from '@ww/hunt-engine';
import type { Checkpoint, SubmissionVerdict, VerificationResult, XpBreakdown } from '@ww/shared';

export interface SubmissionOutcomeView {
  outcome: 'approved' | 'rejected' | 'needs-review';
  message: string;
  xpAwarded: number;
  breakdown?: XpBreakdown;
  reveal?: { name: string; historicalReveal: string; sources: Checkpoint['sources'] };
  verification?: VerificationResult;
  /**
   * Set when the photo could NOT be checked and the result rests on the answer
   * alone. The UI must show this — an unverified pass presented as verified is
   * exactly the silent degradation this project keeps getting bitten by.
   */
  degraded?: string;
}

const reducer = (state: HuntState, action: HuntAction): HuntState => transition(state, action);

export function useSoloHunt(routeId: string, checkpoints: Checkpoint[]) {
  const checkpointIds = useMemo(() => checkpoints.map((c) => c.id), [checkpoints]);

  const [state, dispatch] = useReducer(
    reducer,
    undefined,
    () => createHuntState(routeId, checkpointIds),
  );

  const [instruction, setInstruction] = useState<string | null>(null);
  const [hintText, setHintText] = useState<string | null>(null);
  const [lastOutcome, setLastOutcome] = useState<SubmissionOutcomeView | null>(null);
  const [verifying, setVerifying] = useState(false);

  /** Wall-clock of arrival, used to key the anti-cheat instruction. */
  const arrivedAt = useRef<number>(0);

  const activeCheckpoint = checkpoints[state.activeIndex] ?? null;
  const activeProgress = state.progress[state.activeIndex];

  const start = useCallback(() => {
    dispatch({ type: 'START_HUNT', now: Date.now() });
  }, []);

  /**
   * Called when the player enters the active checkpoint's radius. The
   * randomized instruction is generated HERE — on arrival, not at hunt start —
   * so it cannot be staged in advance from a photo taken earlier.
   */
  const arrive = useCallback(() => {
    if (!activeCheckpoint) return;
    const now = Date.now();
    arrivedAt.current = now;

    dispatch({ type: 'ARRIVE', checkpointIndex: state.activeIndex, now });
    setInstruction(
      generateInstruction({
        checkpointId: activeCheckpoint.id,
        playerId: 'solo',
        arrivalTime: now,
      }),
    );
  }, [activeCheckpoint, state.activeIndex]);

  const openChallenge = useCallback(() => {
    dispatch({ type: 'OPEN_CHALLENGE', checkpointIndex: state.activeIndex, now: Date.now() });
  }, [state.activeIndex]);

  const requestHint = useCallback(() => {
    if (!activeCheckpoint) return;
    // The engine charges at most once per checkpoint; asking twice is free.
    dispatch({ type: 'REQUEST_HINT', checkpointIndex: state.activeIndex, now: Date.now() });
    setHintText(activeCheckpoint.hints?.[0]?.text ?? activeCheckpoint.hint);
  }, [activeCheckpoint, state.activeIndex]);

  /** Reveal the second, more explicit hint tier if the content has one. */
  const requestDeeperHint = useCallback(() => {
    if (!activeCheckpoint?.hints?.[1]) return;
    setHintText(activeCheckpoint.hints[1].text);
  }, [activeCheckpoint]);

  /**
   * Submit a photo + answer. In solo mode verification runs through the server
   * endpoint (so the Gemini key stays server-side); if the server is
   * unreachable the run falls back to local answer-only checking, clearly
   * labeled, so a demo is never blocked by a dead backend.
   */
  const submit = useCallback(
    async (imageDataUrl: string, answer: string, apiUrl: string) => {
      const cp = activeCheckpoint;
      if (!cp || !activeProgress) return;

      const now = Date.now();
      dispatch({ type: 'SUBMIT', checkpointIndex: state.activeIndex, now });
      setVerifying(true);

      /**
       * `/api/verify` returns a full SubmissionVerdict, not a bare
       * VerificationResult — the server has already combined the model's
       * judgement with its own geofence check. Take `.verification` off it
       * rather than reading fields that only exist one level down; casting the
       * verdict to the inner type silently yields `undefined` for every field,
       * and every submission gets rejected.
       */
      let verdict: SubmissionVerdict | null = null;
      let degraded: string | null = null;

      try {
        const res = await fetch(`${apiUrl}/api/verify`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            checkpointId: cp.id,
            image: imageDataUrl,
            latitude: cp.latitude,
            longitude: cp.longitude,
            observationAnswer: answer,
            randomizedInstruction: instruction ?? '',
            submittedAt: now,
          }),
        });

        if (res.ok) {
          verdict = (await res.json()) as SubmissionVerdict;
        } else {
          // NEVER silent. A missing endpoint once made solo mode look like it
          // verified photos while never calling the model at all.
          degraded = `server returned ${res.status}`;
          console.error(`[verify] photo verification unavailable (${degraded}) — answer-only.`);
        }
      } catch (err) {
        degraded = err instanceof Error ? err.message : 'network error';
        console.error(`[verify] photo verification unreachable (${degraded}) — answer-only.`);
      }

      const result: VerificationResult | null = verdict?.verification ?? null;

      // The deterministic answer check is authoritative either way — the same
      // rule the server applies (see DECISIONS.md D12).
      const answerCorrect = matchesAcceptedAnswer(answer, cp.acceptedAnswers);

      // With a verdict, trust the server's photo judgement. Without one we
      // cannot judge the photo at all, so we accept on the answer alone and
      // say so — a degraded pass that claims to be verified would be a lie.
      const landmarkOk = verdict
        ? verdict.verification.landmarkMatch && verdict.verification.requiredActionCompleted
        : true;
      const approved = answerCorrect && landmarkOk;

      setVerifying(false);

      if (!approved) {
        dispatch({ type: 'VERIFICATION_FAILED', checkpointIndex: state.activeIndex, now: Date.now() });
        setLastOutcome({
          outcome: 'rejected',
          message: !answerCorrect
            ? "That's not what we're looking for — take another look."
            : (result?.reason ?? 'The photo did not match the landmark or the required action.'),
          xpAwarded: 0,
          ...(result ? { verification: result } : {}),
          ...(degraded ? { degraded } : {}),
        });
        return;
      }

      const elapsedSeconds = Math.max(1, (Date.now() - (activeProgress.activatedAt ?? now)) / 1000);
      const isFinal = state.activeIndex === checkpoints.length - 1;

      const breakdown = scoreCheckpoint({
        baseXp: cp.baseXp,
        expectedCompletionSeconds: cp.expectedCompletionSeconds,
        actualSeconds: elapsedSeconds,
        completed: true,
        answerCorrect: true,
        hintUsed: activeProgress.hintUsed,
        incorrectAttempts: activeProgress.incorrectAttempts,
        isFinalCheckpoint: isFinal,
      });

      dispatch({
        type: 'VERIFICATION_PASSED',
        checkpointIndex: state.activeIndex,
        now: Date.now(),
        xpAwarded: breakdown.total,
        reveal: {
          checkpointId: cp.id,
          name: cp.name,
          historicalReveal: cp.historicalReveal,
          sources: cp.sources,
        },
      });

      setLastOutcome({
        outcome: 'approved',
        message: degraded ? 'Answer accepted — photo NOT verified.' : 'Verified.',
        xpAwarded: breakdown.total,
        breakdown,
        reveal: { name: cp.name, historicalReveal: cp.historicalReveal, sources: cp.sources },
        ...(result ? { verification: result } : {}),
        ...(degraded ? { degraded } : {}),
      });
    },
    [activeCheckpoint, activeProgress, checkpoints.length, instruction, state.activeIndex],
  );

  /** Dismiss the reveal and move to the next clue (or finish). */
  const advance = useCallback(() => {
    setLastOutcome(null);
    setInstruction(null);
    setHintText(null);
    dispatch({ type: 'ADVANCE', now: Date.now() });
  }, []);

  return {
    state,
    activeCheckpoint,
    activeProgress,
    instruction,
    hintText,
    lastOutcome,
    verifying,
    totalCheckpoints: checkpoints.length,
    start,
    arrive,
    openChallenge,
    requestHint,
    requestDeeperHint,
    submit,
    advance,
  };
}
