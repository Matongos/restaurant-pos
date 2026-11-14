import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import './styles.css';
import { setupPWA } from './pwa';
import { takeSessionFromLink } from './cloud/api';
import { startSync } from './cloud/sync';
import { startOnline } from './cloud/online';

// Short public links: pos.techplug.co.zw/<web address>?t=T4 → the restaurant page, /console → the owner console.
// (Vercel serves index.html for these; the app itself uses #/ routes.)
{
  const seg = location.pathname.replace(/^\/+|\/+$/g, '');
  if (seg === 'console') history.replaceState(null, '', '/#/console');
  else if (/^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$/.test(seg) && !location.hash) history.replaceState(null, '', `/#/r/${seg}${location.search}`);
}
setupPWA();
// Coming back from an email link (confirm address / new password): keep the sign-in, clean the address.
const linkType = takeSessionFromLink();
if (linkType) sessionStorage.setItem('restaurant-pos.link-type', linkType);
startOnline();
startSync();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
