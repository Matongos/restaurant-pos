import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import './styles.css';
import { isInstalled, setupPWA } from './pwa';
import { PUBLIC_SITE } from './cloudConfig';
import { takeSessionFromLink } from './cloud/api';
import { startSync } from './cloud/sync';
import { startOnline } from './cloud/online';
import { initStore } from './store/store';
import { startPrinter } from './print/printer';

// First-time visitors to pos.techplug.co.zw see the product website. Devices that already use the app
// (tills, the Windows app, the installed app, anyone who opened the app once) go straight to it.
const toWebsite = (() => {
  try {
    if (location.hostname !== new URL(PUBLIC_SITE).hostname || location.pathname !== '/' || location.hash || isInstalled()) return false;
    return !['restaurant-pos.state.v1', 'restaurant-pos.cloud', 'restaurant-pos.app-opened'].some((k) => localStorage.getItem(k));
  } catch {
    return false;
  }
})();

if (toWebsite) location.replace('/site/');
else {
  try {
    localStorage.setItem('restaurant-pos.app-opened', '1');
  } catch {
    /* private window */
  }
  // Short public links: pos.techplug.co.zw/<web address>?t=T4 → the restaurant page, /console → the owner console.
  // (Vercel serves index.html for these; the app itself uses #/ routes.)
  {
    const seg = location.pathname.replace(/^\/+|\/+$/g, '');
    if (seg === 'console') history.replaceState(null, '', '/#/console');
    else if (/^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$/.test(seg) && !location.hash) history.replaceState(null, '', `/#/r/${seg}${location.search}`);
  }
  setupPWA();
  void initStore().then(start);
}

function start() {
  // Coming back from an email link (confirm address / new password): keep the sign-in, clean the address.
  const linkType = takeSessionFromLink();
  if (linkType) sessionStorage.setItem('restaurant-pos.link-type', linkType);
  startOnline();
  startSync();
  startPrinter();

  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
}
