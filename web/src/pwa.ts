// Installable app: registers the offline service worker, keeps the "Install" prompt for later,
// and checks now and then whether a newer version has been published.
import { useEffect, useState } from 'react';

type InstallEvent = Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }> };
let deferred: InstallEvent | null = null;
const listeners = new Set<() => void>();
const notify = () => listeners.forEach((f) => f());

/** True inside the Windows desktop app (Tauri). */
export const inDesktopApp = () => typeof window !== 'undefined' && ('__TAURI_INTERNALS__' in window || '__TAURI__' in window);
/** True when opened from the home screen / as an installed app. */
export const isInstalled = () =>
  inDesktopApp() || window.matchMedia?.('(display-mode: standalone)').matches || (navigator as Navigator & { standalone?: boolean }).standalone === true;
export const isIOS = () => /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

export function setupPWA() {
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferred = e as InstallEvent;
    notify();
  });
  window.addEventListener('appinstalled', () => {
    deferred = null;
    notify();
  });
  const local = ['localhost', '127.0.0.1'].includes(location.hostname);
  // Not on a developer's own computer (unless asked with ?sw=1), and only over https.
  if (!('serviceWorker' in navigator) || (local ? !/[?&]sw=1/.test(location.search) : location.protocol !== 'https:')) return;
  window.addEventListener('load', () => {
    navigator.serviceWorker
      .register('/sw.js')
      .then(() => navigator.serviceWorker.ready)
      .then((reg) => {
        // Save what this first visit already loaded (scripts, styles, fonts).
        const urls = performance
          .getEntriesByType('resource')
          .map((r) => r.name)
          .filter((u) => u.startsWith(location.origin) || /fonts\.(googleapis|gstatic)\.com/.test(u));
        reg.active?.postMessage({ type: 'cache-urls', urls: [...new Set([location.origin + '/', ...urls])] });
      })
      .catch(() => {});
  });
  startUpdateCheck();
}

// ---- new version available?
let updateReady = false;
const currentScript = () => document.querySelector<HTMLScriptElement>('script[type="module"][src*="/assets/"]')?.getAttribute('src') ?? '';
function startUpdateCheck() {
  const mine = currentScript();
  if (!mine) return; // development
  const check = async () => {
    if (updateReady || !navigator.onLine) return;
    try {
      const html = await (await fetch('/?v=' + Date.now(), { cache: 'no-store' })).text();
      const m = html.match(/<script[^>]+type="module"[^>]+src="([^"]+)"/);
      if (m && m[1] !== mine) {
        updateReady = true;
        notify();
      }
    } catch {
      /* offline */
    }
  };
  setInterval(check, 20 * 60 * 1000);
  window.addEventListener('online', check);
  setTimeout(check, 60 * 1000);
}

export function useAppStatus() {
  const [, force] = useState(0);
  useEffect(() => {
    const f = () => force((n) => n + 1);
    listeners.add(f);
    return () => {
      listeners.delete(f);
    };
  }, []);
  return {
    canInstall: !!deferred && !isInstalled(),
    iosHint: isIOS() && !isInstalled(),
    installed: isInstalled(),
    updateReady,
    install: async () => {
      if (!deferred) return false;
      await deferred.prompt();
      const r = await deferred.userChoice;
      deferred = null;
      notify();
      return r.outcome === 'accepted';
    },
  };
}
