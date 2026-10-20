import { useSyncExternalStore } from 'react';

/** Tiny hash router: #/till, #/display?till=till-1 … Works offline and inside a desktop wrapper. */

function read() {
  return window.location.hash.replace(/^#/, '') || '/';
}

export function useRoute(): { path: string; query: URLSearchParams } {
  const raw = useSyncExternalStore(
    (cb) => {
      window.addEventListener('hashchange', cb);
      return () => window.removeEventListener('hashchange', cb);
    },
    read,
  );
  const [path, qs] = raw.split('?');
  return { path, query: new URLSearchParams(qs ?? '') };
}

export function go(to: string) {
  window.location.hash = to;
}
