/**
 * Which version of TechPlug POS this device runs, and whether a newer one is out.
 * The web app's version is stamped at build time (vite.config.ts); the Windows app has its own number.
 */
declare const __APP_BUILD__: string;

export const BUILD: string = typeof __APP_BUILD__ !== 'undefined' ? __APP_BUILD__ : 'dev';

/** "2026.11.16-c869432" → "16 Nov 2026". */
export function buildDate(build = BUILD): string {
  const m = build.match(/^(\d{4})\.(\d{2})\.(\d{2})/);
  if (!m) return build;
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
}

/** Windows app version (e.g. "1.1.1"), or null in a browser / installed web app. */
export async function desktopVersion(): Promise<string | null> {
  const t = (window as unknown as { __TAURI_INTERNALS__?: { invoke: (c: string, a?: object) => Promise<unknown> } }).__TAURI_INTERNALS__;
  if (!t?.invoke) return null;
  try {
    return String(await t.invoke('plugin:app|version'));
  } catch {
    return 'older than 1.1';
  }
}

/** The newest published version, or null when it cannot be checked (offline). */
export async function latestBuild(): Promise<string | null> {
  try {
    const r = await fetch(`/version.json?t=${Date.now()}`, { cache: 'no-store' });
    if (!r.ok) return null;
    return ((await r.json()) as { build?: string }).build ?? null;
  } catch {
    return null;
  }
}

/** Phone, tablet, Windows app, browser … for support and the owner console. */
export function platformName(desktop: string | null): string {
  if (desktop) return 'Windows app';
  const ua = navigator.userAgent;
  const installed = matchMedia('(display-mode: standalone)').matches;
  const os = /Android/i.test(ua) ? 'Android' : /iPhone|iPad/i.test(ua) ? 'iPhone/iPad' : /Windows/i.test(ua) ? 'Windows' : /Mac/i.test(ua) ? 'Mac' : /Linux/i.test(ua) ? 'Linux' : 'Device';
  const browser = /Edg\//.test(ua) ? 'Edge' : /Chrome\//.test(ua) ? 'Chrome' : /Safari\//.test(ua) ? 'Safari' : /Firefox\//.test(ua) ? 'Firefox' : 'browser';
  return `${os} · ${installed ? 'installed app' : browser}`;
}
