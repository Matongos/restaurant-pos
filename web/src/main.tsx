import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import './styles.css';
import { setupPWA } from './pwa';
import { takeSessionFromLink } from './cloud/api';
import { startSync } from './cloud/sync';

setupPWA();
// Coming back from an email link (confirm address / new password): keep the sign-in, clean the address.
const linkType = takeSessionFromLink();
if (linkType) sessionStorage.setItem('restaurant-pos.link-type', linkType);
startSync();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
