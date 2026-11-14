import { InstallCard } from '../components/AppInstall';
import { useEffect, useState } from 'react';
import { getState, login, useStore } from '../store/store';
import { LuDelete } from 'react-icons/lu';
import { BrandMark, Dialog } from '../components/ui';
import { getLink, syncNow, syncStatusNow, unlink, useSyncStatus } from '../cloud/sync';
import { signIn } from '../cloud/api';
import { go } from '../router';

export default function Login() {
  const [pin, setPin] = useState('');
  const [error, setError] = useState('');
  const [switching, setSwitching] = useState(false);
  const settings = useStore((s) => s.settings);

  const press = (d: string) => {
    setError('');
    setPin((p) => (p.length < 4 ? p + d : p));
  };

  useEffect(() => {
    if (pin.length === 4) {
      const u = login(pin);
      if (!u) {
        setError('Wrong PIN');
        setPin('');
      }
    }
  }, [pin]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement | null)?.closest?.('input, textarea, .dialog')) return; // typing in a form, not the PIN
      if (/^\d$/.test(e.key)) press(e.key);
      if (e.key === 'Backspace') setPin((p) => p.slice(0, -1));
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  return (
    <div className="app solo">
      <div className="login">
        <div className="card">
          <div className="login-brand">
            <BrandMark withName={false} />
            <div className="name">{settings.restaurantName}</div>
            <div className="muted">{settings.tagline}</div>
          </div>
          <h2 style={{ marginTop: 24, fontSize: 18 }}>Enter your PIN</h2>
          <div className="pin-dots">
            {[0, 1, 2, 3].map((i) => (
              <span key={i} className={i < pin.length ? 'on' : ''} />
            ))}
          </div>
          <div className="error">{error}</div>
          <div className="keypad">
            {['1', '2', '3', '4', '5', '6', '7', '8', '9'].map((d) => (
              <button key={d} onClick={() => press(d)}>
                {d}
              </button>
            ))}
            <button onClick={() => setPin('')} aria-label="Clear">
              C
            </button>
            <button onClick={() => press('0')}>0</button>
            <button onClick={() => setPin((p) => p.slice(0, -1))} aria-label="Delete last digit">
              <LuDelete aria-hidden="true" />
            </button>
          </div>
          {!getLink() && <div className="hint">
            Demo PINs — Owner 1234 · Manager 2222 · Cashier 1111 · Kitchen 3333 · Attendant 4444
          </div>}
          {!getLink() && (
            <div className="setup-links">
              <a className="btn primary" href="#/setup">
                New restaurant? Set it up
              </a>
              <a className="btn" href="#/setup?connect=1">
                Connect to my restaurant
              </a>
            </div>
          )}
          {getLink() && (
            <button className="link-btn switch-link" onClick={() => setSwitching(true)}>
              Switch restaurant
            </button>
          )}
          {switching && <SwitchRestaurant onClose={() => setSwitching(false)} />}
          <InstallCard />
        </div>
      </div>
    </div>
  );
}

/**
 * Move this till to another restaurant (or a new one). Only the owner: their PIN or the account password.
 * Unsent sales are sent first; the till then signs out and offers "Connect to my restaurant".
 */
function SwitchRestaurant({ onClose }: { onClose: () => void }) {
  const sync = useSyncStatus();
  const link = sync.link;
  const [how, setHow] = useState<'pin' | 'password'>('pin');
  const [pin, setPin] = useState('');
  const [password, setPassword] = useState('');
  const [ok, setOk] = useState(false);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const check = async () => {
    setError('');
    if (how === 'pin') {
      const owner = getState().staff.find((s) => s.role === 'super_admin' && s.active && !s.deletedAt && s.pin === pin);
      if (!owner) return setError("That is not the owner's PIN.");
      setOk(true);
    } else {
      try {
        setBusy('Checking…');
        await signIn(link!.email, password);
        setOk(true);
      } catch {
        setError('Wrong password.');
      } finally {
        setBusy('');
      }
    }
  };
  const doSwitch = async () => {
    setError('');
    try {
      if (sync.pending) {
        setBusy('Sending the last sales…');
        await syncNow();
      }
      if (syncStatusNow().pending) return setError('Some sales have not been sent yet (no internet?). Try again when the till is online, so nothing is lost.');
      setBusy('Signing out…');
      await unlink();
      onClose();
      go('/setup?connect=1');
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy('');
    }
  };
  return (
    <Dialog title="Switch restaurant" onClose={onClose} width={480}>
      {!ok ? (
        <>
          <p className="muted" style={{ marginTop: 0 }}>
            This till belongs to <b>{link?.restaurantName}</b>. Only the owner can move it to another restaurant.
          </p>
          <div className="seg">
            <button className={how === 'pin' ? 'on' : ''} onClick={() => setHow('pin')}>
              Owner's PIN
            </button>
            <button className={how === 'password' ? 'on' : ''} onClick={() => setHow('password')}>
              Account password
            </button>
          </div>
          {how === 'pin' ? (
            <label className="field">
              Owner's PIN
              <input type="password" inputMode="numeric" maxLength={4} value={pin} onChange={(e) => setPin(e.target.value.replace(/\D/g, '').slice(0, 4))} autoFocus />
            </label>
          ) : (
            <label className="field">
              Password of {link?.email}
              <input type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} autoFocus />
            </label>
          )}
          {error && <div className="error">{error}</div>}
          <div className="row wrap" style={{ marginTop: 12, justifyContent: 'flex-end' }}>
            <button className="btn" onClick={onClose}>
              Cancel
            </button>
            <button className="btn primary" onClick={check} disabled={!!busy}>
              {busy || 'Continue'}
            </button>
          </div>
        </>
      ) : (
        <>
          <p style={{ marginTop: 0 }}>
            The till stops using <b>{link?.restaurantName}</b>. Its sales are kept safely online. Next you sign in to the other restaurant, and its menu, staff and sales replace what is on this till.
          </p>
          {sync.pending > 0 && <p className="warn">{sync.pending} changes are still waiting to be sent — they are sent first.</p>}
          {error && <div className="error">{error}</div>}
          <div className="row wrap" style={{ marginTop: 12, justifyContent: 'flex-end' }}>
            <button className="btn" onClick={onClose} disabled={!!busy}>
              Keep this restaurant
            </button>
            <button className="btn primary" onClick={doSwitch} disabled={!!busy}>
              {busy || 'Switch restaurant'}
            </button>
          </div>
        </>
      )}
    </Dialog>
  );
}
