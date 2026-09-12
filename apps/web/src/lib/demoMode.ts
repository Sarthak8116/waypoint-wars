'use client';

/**
 * One switch that makes the whole app demonstrable when the world is against
 * you.
 *
 * GPS fails indoors, venue wifi blocks Overpass, Gemini rate-limits, the room
 * server cold-starts. None of that should be able to sink a three-minute
 * demo, so Demo Mode is a first-class latched setting rather than a per-screen
 * toggle a presenter has to remember to flip on each page.
 *
 * It is latched, not inferred: `?demo=1` turns it on and it STAYS on across
 * navigations until explicitly turned off. A presenter should set it once
 * before walking on stage.
 */

const KEY = 'ww:demo-mode';

/** Read once per call; safe during SSR (returns false, then hydrates). */
export function isDemoMode(): boolean {
  if (typeof window === 'undefined') return false;

  // A URL flag wins and latches, so a single link puts the app in demo mode.
  if (new URLSearchParams(window.location.search).get('demo') === '1') {
    try {
      window.localStorage.setItem(KEY, '1');
    } catch {
      // Private browsing. The URL flag still holds for this page.
    }
    return true;
  }

  try {
    return window.localStorage.getItem(KEY) === '1';
  } catch {
    return false;
  }
}

export function setDemoMode(on: boolean): void {
  if (typeof window === 'undefined') return;
  try {
    if (on) window.localStorage.setItem(KEY, '1');
    else window.localStorage.removeItem(KEY);
  } catch {
    // Nothing to do — the caller's in-memory state still reflects the choice.
  }
}
