import { useState } from 'react';
import { LuDownload, LuRefreshCw, LuShare, LuX } from 'react-icons/lu';
import { useAppStatus } from '../pwa';

/** On the login screen: "Install TechPlug POS on this device" (or how to on iPhone/iPad). */
export function InstallCard() {
  const { canInstall, iosHint, install } = useAppStatus();
  const [hidden, setHidden] = useState(() => {
    try {
      return localStorage.getItem('restaurant-pos.install-hidden') === '1';
    } catch {
      return false;
    }
  });
  if (hidden || (!canInstall && !iosHint)) return null;
  const hide = () => {
    setHidden(true);
    try {
      localStorage.setItem('restaurant-pos.install-hidden', '1');
    } catch {
      /* private mode */
    }
  };
  return (
    <div className="install-card">
      <img src="/icons/icon-192.png" alt="" />
      <div className="grow">
        <b>Install TechPlug POS</b>
        {canInstall ? <small>Opens like an app and works without internet.</small> : (
          <small>
            Tap <LuShare aria-label="Share" style={{ verticalAlign: '-2px' }} /> then <b>Add to Home Screen</b>.
          </small>
        )}
      </div>
      {canInstall && (
        <button className="btn primary" onClick={install}>
          <LuDownload aria-hidden="true" />
          Install
        </button>
      )}
      <button className="btn icon-only" onClick={hide} aria-label="Not now">
        <LuX aria-hidden="true" />
      </button>
    </div>
  );
}

/** Small bar when a newer version has been published. Reloading keeps all data (it is stored on the device). */
export function UpdateBar() {
  const { updateReady } = useAppStatus();
  if (!updateReady) return null;
  return (
    <div className="update-bar" role="status">
      <LuRefreshCw aria-hidden="true" />
      <span>A new version of TechPlug POS is ready.</span>
      <button className="btn" onClick={() => location.reload()}>
        Reload
      </button>
    </div>
  );
}
