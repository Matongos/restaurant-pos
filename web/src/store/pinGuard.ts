/**
 * Stops someone trying every PIN on a till: after 5 wrong PINs in a row the pad locks for 30 seconds,
 * and each further wrong PIN doubles the wait (up to 15 minutes). A right PIN resets it.
 * Kept on the device, so reloading the page does not reset it.
 */
const KEY = 'restaurant-pos.pin-guard';
const FREE_TRIES = 5;
const FIRST_LOCK_MS = 30_000;
const MAX_LOCK_MS = 15 * 60_000;

interface Guard { fails: number; until: number }
let memory: Guard = { fails: 0, until: 0 };
function read(): Guard {
  try {
    const g = JSON.parse(localStorage.getItem(KEY) || 'null');
    return g && typeof g.fails === 'number' ? g : { fails: 0, until: 0 };
  } catch {
    return memory;
  }
}
function write(g: Guard) {
  memory = g;
  try {
    localStorage.setItem(KEY, JSON.stringify(g));
  } catch {
    /* ignore */
  }
}

/** Milliseconds until PINs can be tried again (0 = now). */
export function pinLockedFor(now = Date.now()): number {
  return Math.max(0, read().until - now);
}

/** A wrong PIN was typed. Returns the new lock time in ms (0 if not locked). */
export function pinFailed(now = Date.now()): number {
  const g = read();
  const fails = g.fails + 1;
  const extra = fails - FREE_TRIES;
  const lock = extra >= 0 ? Math.min(MAX_LOCK_MS, FIRST_LOCK_MS * 2 ** extra) : 0;
  write({ fails, until: lock ? now + lock : 0 });
  return lock;
}

/** The right PIN was typed. */
export function pinOk() {
  write({ fails: 0, until: 0 });
}

export function waitText(ms: number): string {
  const s = Math.ceil(ms / 1000);
  return s >= 90 ? `${Math.ceil(s / 60)} minutes` : `${s} seconds`;
}
