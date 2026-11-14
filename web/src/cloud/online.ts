/**
 * The restaurant's customer-facing side, run from the till:
 * - its details in the online account (plan, trial, web page / QR menu / online orders switches);
 * - publishing today's menu (with what is sold out) for the web page and QR menu;
 * - online orders: new ones arrive here, staff accept or decline, and the customer's status page
 *   follows the order as the kitchen marks it ready and the counter takes payment;
 * - counting app opens and installs for the owner console.
 */
import { useSyncExternalStore } from 'react';
import type { AppState } from '../domain/types';
import { isSellable } from '../domain/rules';
import { outOfStockIds, stockLevels } from '../domain/stock';
import { acceptOnlineOrder, setSalesLock, getState, useStore } from '../store/store';
import { insertQuiet, patch, rpc, select } from './api';
import { inDesktopApp, isInstalled } from '../pwa';
import { refreshPlatform } from './platform';
import { deviceId, getLink, isSyncLeader, onSyncTick } from './sync';

/* ------------------------------------------------------------------ restaurant details */

export interface RestaurantInfo {
  name: string;
  slug: string;
  plan: 'trial' | 'restaurant' | 'group' | 'free' | 'closed';
  trial_ends_at: string;
  web_page: boolean;
  qr_menu: boolean;
  online_orders: boolean;
  public_info: PublicInfo;
  /** The main restaurant of this one's group (branches). Missing until database step 3 is run. */
  group_id?: string | null;
  /** A paid plan runs to here (database step 4). */
  paid_until?: string | null;
}
export interface PublicInfo {
  phone?: string;
  whatsapp?: string;
  address?: string;
  hours?: string;
  about?: string;
  tableOrders?: boolean;
}

export interface RemoteOnlineOrder {
  id: string;
  number: number;
  customer_name: string;
  phone: string;
  mode: 'pickup' | 'delivery' | 'table';
  table_name: string | null;
  address: string | null;
  lines: { itemId: string; name: string; qty: number; unitPrice: number; extras?: string[]; without?: string[]; note?: string }[];
  total: number;
  status: 'new' | 'accepted' | 'declined' | 'ready' | 'out' | 'collected' | 'cancelled';
  ready_minutes: number | null;
  created_at: string;
}

interface OnlineState {
  info: RestaurantInfo | null;
  orders: RemoteOnlineOrder[];
  checkedAt: number;
}
const INFO_KEY = 'restaurant-pos.restaurant-info';
let st: OnlineState = { info: readInfo(), orders: [], checkedAt: 0 };
function readInfo(): RestaurantInfo | null {
  try {
    return JSON.parse(localStorage.getItem(INFO_KEY) || 'null');
  } catch {
    return null;
  }
}
const listeners = new Set<() => void>();
function update(p: Partial<OnlineState>) {
  st = { ...st, ...p };
  if (p.info !== undefined) {
    try {
      localStorage.setItem(INFO_KEY, JSON.stringify(p.info));
    } catch {
      /* ignore */
    }
  }
  listeners.forEach((l) => l());
}
function addListener(cb: () => void) {
  listeners.add(cb);
}
export function useOnline(): OnlineState {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => st,
  );
}

const INFO_FIELDS = 'name,slug,plan,trial_ends_at,web_page,qr_menu,online_orders,public_info';
let infoAt = 0;
export async function refreshInfo(force = false): Promise<RestaurantInfo | null> {
  const link = getLink();
  if (!link) return null;
  if (!force && Date.now() - infoAt < 5 * 60_000 && st.info) return st.info;
  let rows: RestaurantInfo[];
  // Newer columns come with database steps 3 (group_id) and 4 (paid_until); ask for less if they are not there yet.
  rows = [];
  for (const extra of [',group_id,paid_until', ',group_id', '']) {
    try {
      rows = await select<RestaurantInfo[]>('restaurants', `select=${INFO_FIELDS}${extra}&id=eq.${link.restaurantId}`);
      break;
    } catch (e) {
      if (!extra || !/group_id|paid_until|column/i.test(e instanceof Error ? e.message : '')) throw e;
    }
  }
  infoAt = Date.now();
  if (rows[0]) update({ info: { ...rows[0], public_info: rows[0].public_info ?? {} } });
  return rows[0] ?? null;
}

/** Owner switches the web page / QR menu / online orders on or off, or changes the public details. */
export async function saveRestaurantInfo(p: Partial<Pick<RestaurantInfo, 'web_page' | 'qr_menu' | 'online_orders' | 'public_info' | 'name'>>): Promise<void> {
  const link = getLink();
  if (!link) throw new Error('Connect this device to your online account first.');
  const rows = await patch<RestaurantInfo>('restaurants', `id=eq.${link.restaurantId}&select=${INFO_FIELDS}`, p);
  if (!rows[0]) throw new Error('Only the owner can change this.');
  update({ info: { ...rows[0], public_info: rows[0].public_info ?? {} } });
  await publishMenu(true);
}

/** Days left of the free trial (negative when over), or null when not on a trial. */
/** Days after the trial ends before the till pauses (time to arrange payment). */
export const GRACE_DAYS = 3;
/** Why selling is paused on this restaurant's tills, or null. */
export function lockReason(info: RestaurantInfo | null): string | null {
  if (!info) return null;
  if (info.plan === 'closed') return 'This restaurant’s account is closed, so new sales are paused. Contact TechPlug to reopen it.';
  if (info.plan === 'trial' && Date.parse(info.trial_ends_at) + GRACE_DAYS * 86_400_000 < Date.now())
    return 'The free trial has ended, so new sales are paused. Your sales, reports and books are all kept. Contact TechPlug to choose a plan.';
  if ((info.plan === 'restaurant' || info.plan === 'group') && info.paid_until && Date.parse(info.paid_until) + GRACE_DAYS * 86_400_000 < Date.now())
    return 'The subscription is overdue, so new sales are paused. Your sales, reports and books are all kept. Pay TechPlug to carry on (Settings → Plan & payments).';
  return null;
}

export function trialDaysLeft(info: RestaurantInfo | null): number | null {
  if (!info || info.plan !== 'trial') return null;
  return Math.ceil((Date.parse(info.trial_ends_at) - Date.now()) / 86_400_000);
}

/* ------------------------------------------------------------------ the public menu */

/** Today's menu as customers see it: only safe fields, and whether each meal can be sold right now. */
export function publicMenuFrom(s: AppState) {
  const out = outOfStockIds(stockLevels(s));
  const sym = s.currencies.find((c) => c.code === s.settings.baseCurrency)?.symbol ?? '$';
  return {
    tagline: s.settings.tagline,
    logo: s.settings.logo,
    brandColor: s.settings.brandColor,
    symbol: sym,
    tables: (s.settings.tables ?? []).map((t) => t.name),
    categories: [...s.categories].sort((a, b) => a.sort - b.sort).map((c) => ({ id: c.id, name: c.name, sort: c.sort })),
    items: s.menu
      .filter((m) => m.price > 0 || m.available)
      .map((m) => ({
        id: m.id,
        name: m.name,
        price: m.price,
        categoryId: m.categoryId,
        emoji: m.emoji,
        photo: m.photo,
        available: isSellable(m, s, out),
        addOnIds: m.addOnIds ?? [],
        sort: m.sort,
      })),
    addOns: s.addOns.map((a) => ({ id: a.id, name: a.name, price: a.price, available: a.available })),
    delivery: s.settings.onlineDelivery?.on ? { on: true, fee: s.settings.onlineDelivery.fee || 0, area: s.settings.onlineDelivery.area || '' } : { on: false },
  };
}

const PUBLISHED_KEY = 'restaurant-pos.public-menu';
let lastPublished: string | null = (() => {
  try {
    return localStorage.getItem(PUBLISHED_KEY);
  } catch {
    return null;
  }
})();
async function publishMenu(force = false) {
  const link = getLink();
  if (!link) return;
  const data = publicMenuFrom(getState());
  const json = JSON.stringify(data);
  const key = `${link.restaurantId}:${json.length}:${hash(json)}`;
  if (!force && key === lastPublished) return;
  await rpc('push_records', { rid: link.restaurantId, items: [{ kind: 'public', id: 'menu', data }], device: deviceId() });
  lastPublished = key;
  try {
    localStorage.setItem(PUBLISHED_KEY, key);
  } catch {
    /* ignore */
  }
}
function hash(s: string): string {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}

/* ------------------------------------------------------------------ online orders */

const seen = new Set<string>();
let alertHandler: ((o: RemoteOnlineOrder) => void) | null = null;
export function onNewOnlineOrder(h: ((o: RemoteOnlineOrder) => void) | null) {
  alertHandler = h;
}

async function pollOrders() {
  const link = getLink();
  if (!link || !st.info?.online_orders) {
    if (st.orders.length) update({ orders: [] });
    return;
  }
  const since = new Date(Date.now() - 36 * 3600_000).toISOString();
  const rows = await select<RemoteOnlineOrder[]>(
    'online_orders',
    `select=id,number,customer_name,phone,mode,table_name,address,lines,total,status,ready_minutes,created_at&restaurant_id=eq.${link.restaurantId}&status=in.(new,accepted,ready,out)&created_at=gt.${encodeURIComponent(since)}&order=created_at.asc`,
  );
  const first = st.checkedAt === 0;
  for (const r of rows) {
    if (r.status === 'new' && !seen.has(r.id)) {
      seen.add(r.id);
      if (!first || Date.now() - Date.parse(r.created_at) < 120_000) alertHandler?.(r);
    }
  }
  update({ orders: rows, checkedAt: Date.now() });
  await followLocalOrders(rows);
}

/** Tell the customer's status page what happened at the till: ready, collected (paid) or cancelled. */
async function followLocalOrders(remote: RemoteOnlineOrder[]) {
  const byId = new Map(remote.map((r) => [r.id, r]));
  for (const o of getState().orders) {
    if (!o.online) continue;
    const r = byId.get(o.online.id);
    if (!r) continue;
    let next: RemoteOnlineOrder['status'] | null = null;
    if (o.status === 'cancelled') next = 'cancelled';
    else if (o.table?.status === 'paid') next = 'collected';
    else if (o.online.outAt && (r.status === 'accepted' || r.status === 'ready')) next = 'out';
    else if ((o.status === 'ready' || o.status === 'served') && r.status === 'accepted') next = 'ready';
    if (next && next !== r.status) {
      try {
        await patch('online_orders', `id=eq.${r.id}`, { status: next });
      } catch {
        // 'out' needs database step 3; the customer still sees "ready" until then.
        if (next === 'out' && r.status === 'accepted') await patch('online_orders', `id=eq.${r.id}`, { status: 'ready' }).catch(() => {});
      }
    }
  }
}

export async function acceptRemote(r: RemoteOnlineOrder, minutes: number, cashierId: string): Promise<void> {
  // Only one till can accept it: the change only happens while it is still new.
  const won = await patch<RemoteOnlineOrder>('online_orders', `id=eq.${r.id}&status=eq.new`, { status: 'accepted', ready_minutes: minutes });
  if (!won.length) {
    await pollOrders();
    throw new Error('Another till already took this order, or the customer cancelled it.');
  }
  const res = acceptOnlineOrder({
    online: {
      id: r.id,
      number: r.number,
      name: r.customer_name,
      phone: r.phone,
      mode: r.mode,
      table: r.table_name ?? undefined,
      readyMinutes: minutes,
      ...(r.mode === 'delivery'
        ? { address: r.address ?? '', deliveryFee: Math.max(0, Math.round((Number(r.total) - r.lines.reduce((a, l) => a + l.qty * l.unitPrice, 0)) * 100) / 100) }
        : {}),
    },
    lines: r.lines,
    cashierId,
  });
  if (!res.ok) throw new Error(res.error);
  update({ orders: st.orders.map((o) => (o.id === r.id ? { ...o, status: 'accepted', ready_minutes: minutes } : o)) });
}

export async function declineRemote(r: RemoteOnlineOrder): Promise<void> {
  await patch('online_orders', `id=eq.${r.id}&status=eq.new`, { status: 'declined' });
  update({ orders: st.orders.filter((o) => o.id !== r.id) });
}

/** The online orders shown on this till: new ones to accept, and accepted ones not yet collected. */
export function useOnlineOrders() {
  const s = useOnline();
  const local = useStore((x) => x.orders);
  const news = s.orders.filter((o) => o.status === 'new');
  const open = local.filter((o) => o.online && o.table?.round === 1 && o.status !== 'cancelled' && o.table.status !== 'paid');
  return { news, open, on: !!s.info?.online_orders };
}

/* ------------------------------------------------------------------ app opens and installs (owner console) */

function platform(): string {
  const ua = navigator.userAgent;
  if (inDesktopApp()) return 'windows-app';
  if (isInstalled()) return /Android/i.test(ua) ? 'android-app' : /iPhone|iPad|iPod/i.test(ua) ? 'ios-app' : 'installed';
  if (/Android/i.test(ua)) return 'android';
  if (/iPhone|iPad|iPod/i.test(ua)) return 'ios';
  if (/Windows/i.test(ua)) return 'windows';
  if (/Mac/i.test(ua)) return 'mac';
  return 'other';
}

export function logEvent(kind: 'first_open' | 'web_install' | 'site_visit' | 'download_click', source?: string) {
  void insertQuiet('app_events', { kind, platform: platform(), source: source?.slice(0, 40) ?? null }).catch(() => undefined);
}

export function startOnline() {
  if (typeof window === 'undefined') return;
  if (/^#\/(r|o|console)\//.test(location.hash) || location.hash === '#/console') return;
  try {
    if (!localStorage.getItem('restaurant-pos.first-open')) {
      localStorage.setItem('restaurant-pos.first-open', new Date().toISOString());
      logEvent('first_open', platform());
    }
  } catch {
    /* ignore */
  }
  window.addEventListener('appinstalled', () => logEvent('web_install'));
  // Pause selling when the trial is over or the account closed (every window, also offline, from the saved info).
  const checkLock = () => setSalesLock(getLink() ? lockReason(st.info) : null);
  checkLock();
  setInterval(checkLock, 60_000);
  addListener(checkLock);
  onSyncTick(async () => {
    if (!isSyncLeader()) {
      // Other windows: pick up the leader's newer restaurant info (plan, trial) from the device.
      try {
        const saved = JSON.parse(localStorage.getItem(INFO_KEY) || 'null');
        if (saved && JSON.stringify(saved) !== JSON.stringify(st.info)) update({ info: saved });
      } catch {
        /* ignore */
      }
      return;
    }
    await refreshInfo(!!lockReason(st.info));
    void refreshPlatform();
    await publishMenu();
    await pollOrders();
  });
}
