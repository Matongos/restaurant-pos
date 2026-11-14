/**
 * TechPlug's own details that every till shows: WhatsApp number and how to pay the subscription.
 * Set in the owner console (platform_settings, database step 4); kept on the device for when it is offline.
 */
import { useSyncExternalStore } from 'react';
import { select } from './api';
import { SUPPORT_WHATSAPP } from '../cloudConfig';

export interface Platform {
  /** International format without +, e.g. 263771234567. */
  whatsapp?: string;
  /** How restaurants pay: EcoCash merchant code, bank account, cash at the office… (shown in Settings → Plan & payments). */
  payInstructions?: string;
  /** Prices shown to owners. */
  priceRestaurant?: number;
  priceGroup?: number;
}

const KEY = 'restaurant-pos.platform';
let data: Platform = (() => {
  try {
    return JSON.parse(localStorage.getItem(KEY) || '{}') as Platform;
  } catch {
    return {};
  }
})();
let loadedAt = 0;
const listeners = new Set<() => void>();

export async function refreshPlatform(force = false): Promise<Platform> {
  if (!force && Date.now() - loadedAt < 10 * 60_000) return data;
  loadedAt = Date.now();
  try {
    const rows = await select<{ data: Platform }[]>('platform_settings', 'select=data&id=eq.1');
    if (rows[0]) {
      data = rows[0].data ?? {};
      try {
        localStorage.setItem(KEY, JSON.stringify(data));
      } catch {
        /* ignore */
      }
      listeners.forEach((l) => l());
    }
  } catch {
    /* database step 4 not run yet, or offline: keep what we have */
  }
  return data;
}

export function usePlatform(): Platform {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => data,
  );
}

/** TechPlug's WhatsApp number: from the console, else the one built into the app. */
export const supportWhatsapp = (p: Platform = data) => (p.whatsapp || SUPPORT_WHATSAPP || '').replace(/\D/g, '');

export function whatsappLink(text: string, p: Platform = data): string | null {
  const n = supportWhatsapp(p);
  return n ? `https://wa.me/${n}?text=${encodeURIComponent(text)}` : null;
}
