/**
 * Every connected device tells the online account which version it runs (about every 30 minutes and
 * right after an update), so the owner (Settings → Online account) and TechPlug (owner console) can see
 * who is up to date. Stored as a 'device' record; tills ignore these records.
 */
import { BUILD, desktopVersion, platformName } from '../version';
import { currentUser, getTillNo } from '../store/store';
import { rpc, select } from './api';
import { deviceId, getLink, isSyncLeader, onSyncTick } from './sync';

export interface DeviceInfo {
  build: string;
  desktop: string | null;
  platform: string;
  tillNo: number;
  lastUser?: string;
  at: string;
}

const KEY = 'restaurant-pos.device-report';
const EVERY = 30 * 60_000;

export function startDeviceReport() {
  onSyncTick(async () => {
    const link = getLink();
    if (!link || !isSyncLeader()) return;
    let last: { build?: string; at?: number } = {};
    try {
      last = JSON.parse(localStorage.getItem(KEY) || '{}');
    } catch {
      /* first time */
    }
    if (last.build === BUILD && Date.now() - (last.at ?? 0) < EVERY) return;
    const desktop = await desktopVersion();
    const data: DeviceInfo = { build: BUILD, desktop, platform: platformName(desktop), tillNo: getTillNo(), lastUser: currentUser()?.name, at: new Date().toISOString() };
    await rpc('push_records', { rid: link.restaurantId, items: [{ kind: 'device', id: deviceId(), data }], device: deviceId() });
    try {
      localStorage.setItem(KEY, JSON.stringify({ build: BUILD, at: Date.now() }));
    } catch {
      /* private window */
    }
  });
}

export interface DeviceRow {
  id: string;
  data: DeviceInfo;
  updated_at: string;
}

/** The restaurant's devices and their versions (owner view). */
export function listDevices(): Promise<DeviceRow[]> {
  const link = getLink();
  if (!link) return Promise.resolve([]);
  return select<DeviceRow[]>('records', `select=id,data,updated_at&restaurant_id=eq.${link.restaurantId}&kind=eq.device&deleted=is.false&order=updated_at.desc`);
}
