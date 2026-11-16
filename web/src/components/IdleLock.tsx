import { useEffect } from 'react';
import { logout, useCurrentUser } from '../store/store';
import { toast } from './ui';

/** Owner and manager screens lock themselves after this long with nobody touching the till. */
export const IDLE_LOCK_MINUTES = 10;

/**
 * An owner or manager who walks away from the till is logged out after a while, so nobody else can
 * open Settings, Books or Start fresh with their login. Cashiers and the kitchen are not affected.
 */
export default function IdleLock() {
  const user = useCurrentUser();
  const boss = user?.role === 'super_admin' || user?.role === 'manager';
  useEffect(() => {
    if (!boss) return;
    let last = Date.now();
    const touch = () => {
      last = Date.now();
    };
    const evs = ['pointerdown', 'keydown', 'wheel', 'touchstart'] as const;
    evs.forEach((e) => window.addEventListener(e, touch, { passive: true }));
    const t = setInterval(() => {
      if (Date.now() - last > IDLE_LOCK_MINUTES * 60_000) {
        logout();
        toast(`Logged out after ${IDLE_LOCK_MINUTES} minutes without use. Enter your PIN to continue.`);
      }
    }, 20_000);
    return () => {
      evs.forEach((e) => window.removeEventListener(e, touch));
      clearInterval(t);
    };
  }, [boss, user?.id]);
  return null;
}
