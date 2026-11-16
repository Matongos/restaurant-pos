import { useEffect, useState } from 'react';
import { LuCircleAlert, LuCircleCheck, LuCopy, LuGlobe, LuMessageCircle, LuRefreshCw } from 'react-icons/lu';
import { BUILD, buildDate, desktopVersion, latestBuild, platformName } from '../version';
import { whatsappLink } from '../cloud/platform';
import { PUBLIC_SITE } from '../cloudConfig';
import { Dialog, toast } from './ui';

export type UpdateCheck = 'checking' | 'latest' | 'update' | 'offline';

/** Is this device on the newest version? Checks once when shown, and again on request. */
export function useUpdateCheck() {
  const [check, setCheck] = useState<UpdateCheck>('checking');
  const [latest, setLatest] = useState<string | null>(null);
  const [desktop, setDesktop] = useState<string | null>(null);
  const run = async () => {
    setCheck('checking');
    const l = await latestBuild();
    setLatest(l);
    setCheck(!l ? 'offline' : l === BUILD || BUILD === 'dev' ? 'latest' : 'update');
  };
  useEffect(() => {
    desktopVersion().then(setDesktop);
    void run();
  }, []);
  return { check, latest, desktop, run };
}

export function UpdateStatus({ check, latest, run }: { check: UpdateCheck; latest: string | null; run: () => void }) {
  return (
    <div className={`ver-status ${check}`}>
      {check === 'checking' && 'Checking for updates…'}
      {check === 'latest' && (
        <>
          <LuCircleCheck aria-hidden="true" /> This is the newest version.
        </>
      )}
      {check === 'update' && (
        <>
          <LuCircleAlert aria-hidden="true" /> A newer version is out ({latest}). Reload to get it — your data stays.
          <button className="btn small primary" onClick={() => location.reload()}>
            Reload now
          </button>
        </>
      )}
      {check === 'offline' && 'Cannot check now (no internet). The app updates itself next time it is online.'}
      {check !== 'checking' && check !== 'update' && (
        <button className="btn small" onClick={run}>
          <LuRefreshCw aria-hidden="true" /> Check again
        </button>
      )}
    </div>
  );
}

/** "About TechPlug POS": name, version, update check, support and legal links (like any desktop program's About). */
export default function AboutDialog({ onClose }: { onClose: () => void }) {
  const { check, latest, desktop, run } = useUpdateCheck();
  const details = `TechPlug POS version ${BUILD}${desktop ? ` · Windows app ${desktop}` : ''} · ${platformName(desktop)}`;
  const wa = whatsappLink(`Hello TechPlug, I need help. ${details}`);
  return (
    <Dialog title="About TechPlug POS" onClose={onClose} width={560}>
      <div className="about">
        <img className="about-logo" src="/icons/icon-192.png" alt="" />
        <div>
          <h2>TechPlug Restaurant POS</h2>
          <div className="about-ver">
            Version <b className="mono-sm">{BUILD}</b> · {buildDate()}
          </div>
          {desktop && (
            <div className="about-ver">
              Windows app <b>{desktop}</b>
            </div>
          )}
          <div className="muted small">{platformName(desktop)}</div>
        </div>
      </div>
      <UpdateStatus check={check} latest={latest} run={() => void run()} />
      <p className="muted" style={{ fontSize: 14 }}>
        Till, kitchen screen, tables, stock and profit for restaurants. Works without internet and keeps every till in step when online.
      </p>
      <div className="about-links">
        <button
          className="btn small"
          onClick={() =>
            navigator.clipboard?.writeText(details).then(
              () => toast('Version details copied'),
              () => toast(details),
            )
          }
        >
          <LuCopy aria-hidden="true" /> Copy version details
        </button>
        {wa && (
          <a className="btn small" href={wa} target="_blank" rel="noopener">
            <LuMessageCircle aria-hidden="true" /> Get help on WhatsApp
          </a>
        )}
        <a className="btn small" href={`${PUBLIC_SITE}/site/`} target="_blank" rel="noopener">
          <LuGlobe aria-hidden="true" /> Website
        </a>
      </div>
      <div className="about-foot muted small">
        © {new Date().getFullYear()} TechPlug · Made in Zimbabwe ·{' '}
        <a href={`${PUBLIC_SITE}/site/privacy.html`} target="_blank" rel="noopener">
          Privacy
        </a>{' '}
        ·{' '}
        <a href={`${PUBLIC_SITE}/site/terms.html`} target="_blank" rel="noopener">
          Terms
        </a>
      </div>
    </Dialog>
  );
}
