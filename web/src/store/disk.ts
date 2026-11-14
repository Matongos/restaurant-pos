/**
 * Where the restaurant's data is kept on the device: IndexedDB (room for years of sales).
 * Older versions used localStorage, which holds only about 5 MB — a busy restaurant fills that in weeks —
 * so on first start the data is moved across.
 *
 * Writes are queued: at most one write at a time, and the newest data always wins, so a burst of
 * changes costs one or two writes. Other windows of the app (customer screen, kitchen) are told
 * after each write and read the new data.
 */

const DB = 'restaurant-pos';
const STORE = 'kv';
const ID = 'state';
const channelName = 'restaurant-pos.state';
const me = Math.random().toString(36).slice(2);

let dbp: Promise<IDBDatabase | null> | null = null;
function db(): Promise<IDBDatabase | null> {
  if (!dbp)
    dbp = new Promise((resolve) => {
      try {
        const req = indexedDB.open(DB, 1);
        req.onupgradeneeded = () => req.result.createObjectStore(STORE);
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => resolve(null);
        req.onblocked = () => resolve(null);
      } catch {
        resolve(null);
      }
    });
  return dbp;
}

export async function readDisk(): Promise<unknown | undefined> {
  const d = await db();
  if (!d) return undefined;
  return new Promise((resolve) => {
    try {
      const req = d.transaction(STORE, 'readonly').objectStore(STORE).get(ID);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(undefined);
    } catch {
      resolve(undefined);
    }
  });
}

async function writeNow(value: unknown): Promise<boolean> {
  const d = await db();
  if (!d) return false;
  return new Promise((resolve) => {
    try {
      const tx = d.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).put(value, ID);
      tx.oncomplete = () => resolve(true);
      tx.onerror = () => resolve(false);
      tx.onabort = () => resolve(false);
    } catch {
      resolve(false);
    }
  });
}

let pending: (() => unknown) | null = null;
let writing: Promise<void> | null = null;
let onFail: ((value: unknown) => void) | null = null;

/** Save soon. `get` is called when the write starts, so the newest data is written. */
export function saveDisk(get: () => unknown, fallback: (value: unknown) => void) {
  pending = get;
  onFail = fallback;
  if (!writing) writing = drain();
}

async function drain() {
  while (pending) {
    const get = pending;
    pending = null;
    const value = get();
    const ok = await writeNow(value);
    if (!ok) onFail?.(value);
    else announce();
  }
  writing = null;
}

/** Wait until everything asked for is saved. */
export async function flushDisk(): Promise<void> {
  while (writing) await writing;
}

let channel: BroadcastChannel | null = null;
try {
  channel = typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel(channelName) : null;
} catch {
  channel = null;
}
function announce() {
  channel?.postMessage({ from: me });
}
/** Another window saved new data. */
export function onOtherWindowSaved(cb: () => void) {
  channel?.addEventListener('message', (e) => {
    if ((e.data as { from?: string })?.from !== me) cb();
  });
}
