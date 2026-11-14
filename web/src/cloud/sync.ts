/**
 * Keeps this device and the restaurant's online account in step.
 *
 * - Every sale, menu change, stock move… is saved on the device first (the till never waits).
 * - Changed items are put in an outbox and sent a moment later (or as soon as the internet is back).
 * - Every few seconds the device fetches what other devices changed since it last looked.
 * - One item = one record online (orders by id, menu items by id, …). Newest version wins; a change
 *   still waiting in this device's outbox is kept over an older one from the internet.
 * - Only one window of the app on a device does the syncing (the others share its saved data).
 */
import { useSyncExternalStore } from 'react';
import type { AppState } from '../domain/types';
import { applyRemote, emptyState, freeTillNo, getState, setTillNo, onLocalChange, replaceAll } from '../store/store';
import { CloudError, getSession, myRestaurants, rpc, select, signOut } from './api';

const LINK_KEY = 'restaurant-pos.cloud';
const OUTBOX_KEY = 'restaurant-pos.outbox';
const DEVICE_KEY = 'restaurant-pos.device';
const POLL_MS = 8000;

/** The app's lists that go online, one record per item. */
const COLLECTIONS = [
  'staff', 'currencies', 'paymentMethods', 'orderTypes', 'categories', 'components', 'menu', 'addOns', 'orders',
  'customers', 'credit', 'stockItems', 'stockMoves', 'purchases', 'expenses', 'cancellations', 'staffLog',
] as const;
type Collection = (typeof COLLECTIONS)[number];
/** Single settings objects, stored as one record each. */
const SINGLES = ['settings', 'dayCounter'] as const;
type Single = (typeof SINGLES)[number];

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Item = any;
const keyOf = (kind: Collection, item: Item): string => (kind === 'currencies' ? item.code : item.id);
const isCollection = (k: string): k is Collection => (COLLECTIONS as readonly string[]).includes(k);
const isSingle = (k: string): k is Single => (SINGLES as readonly string[]).includes(k);

export interface CloudLink {
  restaurantId: string;
  restaurantName: string;
  slug: string;
  email: string;
  role: string;
  /** Server time of the newest change fetched so far. */
  cursor: string | null;
  /** Sales history on this device starts here; older sales stay online (null = everything is here). */
  historyFrom?: string | null;
}

/** Sales history a newly connected device downloads: the last 6 months (older stays online, loadable later). */
export const HISTORY_DAYS = 183;
/** Lists that only grow with time; a new device downloads just their recent part. */
const HISTORY_KINDS = ['orders', 'cancellations', 'staffLog'] as const;

export interface SyncStatus {
  link: CloudLink | null;
  state: 'off' | 'idle' | 'syncing' | 'offline' | 'error' | 'signed-out';
  pending: number;
  lastSync: string | null;
  error: string;
}

/* ------------------------------------------------------------------ saved bits */

function read<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}
function write(key: string, value: unknown) {
  try {
    if (value == null) localStorage.removeItem(key);
    else localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* storage full or blocked */
  }
}

export function deviceId(): string {
  let id = read<string | null>(DEVICE_KEY, null);
  if (!id) {
    id = 'dev-' + (crypto.randomUUID?.() ?? Math.random().toString(36).slice(2) + Date.now().toString(36));
    write(DEVICE_KEY, id);
  }
  return id;
}

let link: CloudLink | null = read<CloudLink | null>(LINK_KEY, null);
/** kind \u0001 id → change counter (so a change made while sending is not lost). */
const outbox = new Map<string, number>((read<string[]>(OUTBOX_KEY, [])).map((k) => [k, 0]));
let counter = 1;
const saveOutbox = () => write(OUTBOX_KEY, [...outbox.keys()]);

/* ------------------------------------------------------------------ status for the screens */

let status: SyncStatus = { link, state: link ? 'idle' : 'off', pending: outbox.size, lastSync: read<string | null>(LINK_KEY + '.last', null), error: '' };
const listeners = new Set<() => void>();
function setStatus(patch: Partial<SyncStatus>) {
  status = { ...status, link, pending: outbox.size, ...patch };
  listeners.forEach((l) => l());
}
/** The sync state right now (outside React). */
export const syncStatusNow = (): SyncStatus => status;

export function useSyncStatus(): SyncStatus {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => status,
  );
}
export const getLink = () => link;
export const isSyncLeader = () => leader;

/* ------------------------------------------------------------------ noticing local changes */

const K = (kind: string, id: string) => `${kind}\u0001${id}`;
function mark(kind: string, id: string) {
  outbox.set(K(kind, id), counter++);
}

/** Compare two versions of the data and put every changed or removed item in the outbox. */
function diff(prev: AppState, next: AppState) {
  for (const kind of COLLECTIONS) {
    const a = prev[kind] as Item[];
    const b = next[kind] as Item[];
    if (a === b) continue;
    const before = new Map<string, Item>();
    for (const it of a) if (!it.example) before.set(keyOf(kind, it), it);
    for (const it of b) {
      if (it.example) continue;
      const id = keyOf(kind, it);
      if (before.get(id) !== it) mark(kind, id);
      before.delete(id);
    }
    for (const id of before.keys()) mark(kind, id); // removed
  }
  for (const kind of SINGLES) if (prev[kind] !== next[kind]) mark(kind, 'main');
}

function markEverything(st: AppState) {
  for (const kind of COLLECTIONS) for (const it of st[kind] as Item[]) if (!it.example) mark(kind, keyOf(kind, it));
  for (const kind of SINGLES) mark(kind, 'main');
  saveOutbox();
}

function currentItem(st: AppState, kind: string, id: string): Item | undefined {
  if (isSingle(kind)) return st[kind];
  if (isCollection(kind)) return (st[kind] as Item[]).find((it) => !it.example && keyOf(kind, it) === id);
  return undefined;
}

/* ------------------------------------------------------------------ sending */

async function push(): Promise<void> {
  if (!link || outbox.size === 0) return;
  const st = getState();
  const taken = [...outbox.entries()];
  // Send in parcels of about 700 KB so one big menu photo or a long history doesn't fail the lot.
  let parcel: { kind: string; id: string; data?: Item; deleted?: boolean }[] = [];
  let size = 0;
  const sent: [string, number][] = [];
  const flush = async () => {
    if (!parcel.length) return;
    await rpc('push_records', { rid: link!.restaurantId, items: parcel, device: deviceId() });
    for (const [k, v] of sent) if (outbox.get(k) === v) outbox.delete(k);
    sent.length = 0;
    saveOutbox();
    setStatus({});
    parcel = [];
    size = 0;
  };
  for (const [key, version] of taken) {
    const [kind, id] = key.split('\u0001');
    const data = currentItem(st, kind, id);
    const rec = data === undefined ? { kind, id, deleted: true } : { kind, id, data };
    const n = JSON.stringify(rec).length;
    if (size + n > 700_000) await flush();
    parcel.push(rec);
    sent.push([key, version]);
    size += n;
  }
  await flush();
}

/* ------------------------------------------------------------------ fetching */

interface Row {
  kind: string;
  id: string;
  data: Item;
  deleted: boolean;
  device_id: string | null;
  updated_at: string;
}

function applyRows(rows: Row[], st: AppState, skipOwn: boolean): AppState {
  const me = deviceId();
  let next = st;
  const byKind = new Map<string, Row[]>();
  for (const r of rows) {
    if (skipOwn && r.device_id === me) continue; // our own change coming back
    if (outbox.has(K(r.kind, r.id))) continue; // a newer change from here is waiting to go out
    if (!byKind.has(r.kind)) byKind.set(r.kind, []);
    byKind.get(r.kind)!.push(r);
  }
  for (const [kind, list] of byKind) {
    if (isSingle(kind)) {
      const last = list[list.length - 1];
      if (!last.deleted) next = { ...next, [kind]: kind === 'settings' ? { ...next.settings, ...last.data } : last.data };
    } else if (isCollection(kind)) {
      const arr = (next[kind] as Item[]).slice();
      const index = new Map<string, number>();
      arr.forEach((it, i) => !it.example && index.set(keyOf(kind, it), i));
      const removed = new Set<number>();
      for (const r of list) {
        const i = index.get(r.id);
        if (r.deleted) {
          if (i !== undefined) removed.add(i);
        } else if (i !== undefined) {
          arr[i] = r.data;
          removed.delete(i);
        } else {
          index.set(r.id, arr.length);
          arr.push(r.data);
        }
      }
      next = { ...next, [kind]: removed.size ? arr.filter((_, i) => !removed.has(i)) : arr };
    }
    // other kinds (e.g. the published public menu) are not part of the till's data
  }
  return next;
}

async function fetchRows(since: string | null, onPage: (rows: Row[]) => void, filter = '', before?: string): Promise<string | null> {
  let from = since ?? '1970-01-01T00:00:00Z';
  let newest = since;
  for (;;) {
    const rows = await select<Row[]>(
      'records',
      `select=kind,id,data,deleted,device_id,updated_at&restaurant_id=eq.${link!.restaurantId}&updated_at=gt.${encodeURIComponent(from)}${before ? `&updated_at=lt.${encodeURIComponent(before)}` : ''}${filter}&order=updated_at.asc&limit=500`,
    );
    if (rows.length) {
      onPage(rows);
      from = rows[rows.length - 1].updated_at;
      if (!newest || from > newest) newest = from;
    }
    if (rows.length < 500) return newest;
  }
}

/** After the account's email changes: show the new one everywhere. */
export function setLinkEmail(email: string) {
  if (!link) return;
  link = { ...link, email };
  write(LINK_KEY, link);
  setStatus({});
}

async function pull(): Promise<void> {
  if (!link) return;
  // Look a little further back than the last change seen, in case a slow device saved something
  // with a slightly earlier time just after we looked. Seeing a change twice is harmless.
  const since = link.cursor ? new Date(Date.parse(link.cursor) - 15000).toISOString() : null;
  const newest = await fetchRows(since, (rows) => applyRemote((st) => applyRows(rows, st, true)));
  if (newest && newest !== link.cursor && (!link.cursor || newest > link.cursor)) {
    link = { ...link, cursor: newest };
    write(LINK_KEY, link);
  }
}

/* ------------------------------------------------------------------ the loop */

/** Extra jobs run after every successful sync (online orders, public menu, restaurant details). */
const tickJobs: (() => Promise<void>)[] = [];
export function onSyncTick(job: () => Promise<void>) {
  tickJobs.push(job);
}
let lastPushAt = 0;

let leader = false;
let running = false;
let again = false;
let timer: ReturnType<typeof setTimeout> | undefined;
let soon: ReturnType<typeof setTimeout> | undefined;

export async function syncNow(): Promise<void> {
  if (!leader || !link) return;
  if (running) {
    again = true;
    return;
  }
  if (!getSession()) {
    setStatus({ state: 'signed-out', error: 'Sign in again to keep this device in step.' });
    return;
  }
  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    setStatus({ state: 'offline' });
    schedule();
    return;
  }
  running = true;
  setStatus({ state: 'syncing' });
  try {
    const before = outbox.size;
    await push();
    if (before) lastPushAt = Date.now();
    // Tell the online account this restaurant is open (the QR menu and online orders depend on it).
    if (Date.now() - lastPushAt > 60_000) {
      await rpc('push_records', { rid: link.restaurantId, items: [], device: deviceId() });
      lastPushAt = Date.now();
    }
    await pull();
    for (const job of tickJobs) {
      try {
        await job();
      } catch (e) {
        console.warn('sync job failed', e);
      }
    }
    const now = new Date().toISOString();
    write(LINK_KEY + '.last', now);
    setStatus({ state: 'idle', lastSync: now, error: '' });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (e instanceof CloudError && e.status === 0) setStatus({ state: 'offline', error: '' });
    else if (!getSession()) setStatus({ state: 'signed-out', error: 'Sign in again to keep this device in step.' });
    else setStatus({ state: 'error', error: msg });
  } finally {
    running = false;
    if (again) {
      again = false;
      void syncNow();
    } else schedule();
  }
}

function schedule() {
  clearTimeout(timer);
  timer = setTimeout(() => void syncNow(), POLL_MS);
}

function soonSync() {
  clearTimeout(soon);
  soon = setTimeout(() => void syncNow(), 1200);
}

function becomeLeader() {
  leader = true;
  onLocalChange((prev, next) => {
    if (!link) return;
    diff(prev, next);
    saveOutbox();
    setStatus({});
    soonSync();
  });
  window.addEventListener('online', () => void syncNow());
  document.addEventListener('visibilitychange', () => document.visibilityState === 'visible' && void syncNow());
  void syncNow();
}

/** Start syncing (call once when the app opens). The customer display window never syncs. */
export function startSync() {
  if (typeof window === 'undefined') return;
  if (/^#\/(display|r\/|o\/|console)/.test(location.hash)) return;
  const locks = (navigator as Navigator & { locks?: { request: (n: string, cb: () => Promise<void>) => Promise<void> } }).locks;
  if (locks?.request) void locks.request('techplug-pos-sync', () => new Promise<void>(() => becomeLeader()));
  else becomeLeader();
}

/* ------------------------------------------------------------------ joining and leaving */

function saveLink(l: CloudLink | null) {
  link = l;
  write(LINK_KEY, l);
  setStatus({ state: l ? 'idle' : 'off', error: '' });
}

/** First device of a new restaurant: everything on this device goes up to the online account. */
export async function linkAndUpload(l: Omit<CloudLink, 'cursor'>, onProgress?: (left: number) => void): Promise<void> {
  saveLink({ ...l, cursor: null });
  markEverything(getState());
  setStatus({});
  const total = outbox.size;
  // send now (not waiting for the loop) so the person sees it finish
  for (let tries = 0; outbox.size && tries < 3; tries++) {
    onProgress?.(outbox.size);
    await push();
  }
  onProgress?.(0);
  if (outbox.size) throw new CloudError(`${outbox.size} of ${total} items could not be sent. They will be sent automatically.`);
  void syncNow();
}

/** Another device joins: this device's data is replaced by the restaurant's. */
export async function linkAndDownload(l: Omit<CloudLink, 'cursor'>, onProgress?: (n: number) => void): Promise<number> {
  const tempLink: CloudLink = { ...l, cursor: null };
  link = tempLink; // needed by fetchRows
  let st = emptyState();
  let n = 0;
  try {
    const page = (rows: Row[]) => {
      st = applyRows(rows, st, false);
      n += rows.length;
      onProgress?.(n);
    };
    // Everything except the growing history first (menu, staff, customers, change, stock…).
    const kinds = `(${HISTORY_KINDS.join(',')})`;
    const newest1 = await fetchRows(null, page, `&kind=not.in.${kinds}`);
    if (n === 0) throw new CloudError('This restaurant has no data online yet. Connect the first device (the one with your menu and sales) first.');
    // Then recent history — and older sales too if stock levels still need them (no stock take since then).
    const historyFrom = historyStart(st);
    const newest2 = await fetchRows(historyFrom, page, `&kind=in.${kinds}`);
    const newest = [newest1, newest2].filter(Boolean).sort().pop() ?? null;
    outbox.clear();
    saveOutbox();
    replaceAll(st);
    setTillNo(freeTillNo(st));
    saveLink({ ...l, cursor: newest, historyFrom });
    void syncNow();
    return n;
  } catch (e) {
    link = read<CloudLink | null>(LINK_KEY, null);
    throw e;
  }
}

/**
 * Where a new device's sales history starts: 6 months back, or earlier if a tracked stock item has not been
 * counted since then (its level is worked out from every sale since the last count).
 */
function historyStart(st: AppState): string | null {
  let from = Date.now() - HISTORY_DAYS * 864e5;
  const lastCount = new Map<string, number>();
  for (const m of st.stockMoves) if (m.kind === 'count') lastCount.set(m.stockItemId, Math.max(lastCount.get(m.stockItemId) ?? 0, Date.parse(m.at)));
  for (const item of st.stockItems) {
    if (!item.track) continue;
    const c = lastCount.get(item.id);
    if (c === undefined) return null; // never counted: every sale matters
    from = Math.min(from, c);
  }
  return new Date(from).toISOString();
}

/** Download the sales older than this device's history (kept online), for reports over longer periods. */
export async function loadOlderHistory(onProgress?: (n: number) => void): Promise<number> {
  if (!link?.historyFrom) return 0;
  const before = link.historyFrom;
  let n = 0;
  await fetchRows(null, (rows) => {
    applyRemote((st) => applyRows(rows, st, false));
    n += rows.length;
    onProgress?.(n);
  }, `&kind=in.(${HISTORY_KINDS.join(',')})`, before);
  link = { ...link, historyFrom: null };
  write(LINK_KEY, link);
  setStatus({});
  return n;
}

/** What a new branch can start with: the menu and how this restaurant sells (no sales, customers or stock counts). */
const SETUP_KINDS = ['categories', 'components', 'menu', 'addOns', 'currencies', 'paymentMethods', 'orderTypes', 'stockItems'] as const;

/** Give a new branch this restaurant's menu, prices, payment methods and settings, and the owner (same PIN). */
export async function copySetupTo(rid: string, branchName: string, ownerId: string | null): Promise<number> {
  const st = getState();
  const items: { kind: string; id: string; data: Item }[] = [];
  for (const kind of SETUP_KINDS) for (const it of st[kind] as Item[]) if (!it.example) items.push({ kind, id: keyOf(kind, it), data: it });
  const owner = st.staff.find((s) => s.id === ownerId);
  if (owner) items.push({ kind: 'staff', id: owner.id, data: owner });
  items.push({ kind: 'settings', id: 'main', data: { ...st.settings, branchId: rid, restaurantName: branchName, trainingMode: false, showExampleHistory: false } });
  items.push({ kind: 'dayCounter', id: 'main', data: { date: st.dayCounter.date, lastSlip: 0 } });
  let parcel: typeof items = [];
  let size = 0;
  for (const it of items) {
    const n = JSON.stringify(it).length;
    if (size + n > 700_000 && parcel.length) {
      await rpc('push_records', { rid, items: parcel, device: 'branch-copy' });
      parcel = [];
      size = 0;
    }
    parcel.push(it);
    size += n;
  }
  if (parcel.length) await rpc('push_records', { rid, items: parcel, device: 'branch-copy' });
  return items.length;
}

/** Is there anything online for this restaurant already? */
export async function restaurantHasData(restaurantId: string): Promise<boolean> {
  const rows = await select<unknown[]>('records', `select=id&restaurant_id=eq.${restaurantId}&limit=1`);
  return rows.length > 0;
}

/** Stop syncing on this device. Its data stays on the device. */
export async function unlink(): Promise<void> {
  await signOut();
  outbox.clear();
  saveOutbox();
  saveLink(null);
}

export { myRestaurants };
