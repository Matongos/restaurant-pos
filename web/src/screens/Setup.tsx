/**
 * First start on a new device (#/setup):
 *  - New restaurant: name, web address, owner's name and PIN, email and password → an empty restaurant
 *    (no demo staff or sales; the sample menu only if wanted) that goes straight online.
 *  - Connect this device: sign in with the restaurant's email and download its data.
 */
import { useState, type ReactNode } from 'react';
import { LuArrowLeft, LuStore, LuLink } from 'react-icons/lu';
import { toast } from '../components/ui';
import { ChooseRestaurant, SignIn, SlugField, createAndUpload } from '../components/CloudAccount';
import { getSession, signIn, signUp } from '../cloud/api';
import { useSyncStatus } from '../cloud/sync';
import { go } from '../router';
import { getState, startFresh } from '../store/store';

export default function Setup({ connect }: { connect: boolean }) {
  const sync = useSyncStatus();
  if (sync.link)
    return (
      <Shell>
        <h2>This device is connected to {sync.link.restaurantName}</h2>
        <p className="muted">Staff sign in with their PINs.</p>
        <button className="btn primary" onClick={() => go('/')}>
          Go to sign in
        </button>
      </Shell>
    );
  return connect ? <Connect /> : <NewRestaurant />;
}

function Shell({ children }: { children: ReactNode }) {
  return (
    <div className="app solo">
      <div className="setup">
        <div className="card">
          <div className="setup-top">
            <button className="btn ghost" onClick={() => go('/')}>
              <LuArrowLeft aria-hidden="true" /> Back
            </button>
            <span className="setup-brand">
              <img src="/icons/icon-192.png" alt="" width={32} height={32} /> TechPlug POS
            </span>
          </div>
          {children}
        </div>
      </div>
    </div>
  );
}

function Connect() {
  const [signedIn, setSignedIn] = useState(!!getSession());
  return (
    <Shell>
      <h2>
        <LuLink aria-hidden="true" /> Connect this device to your restaurant
      </h2>
      <p className="muted">Sign in with the email and password used when the restaurant was set up. This device then gets the restaurant's menu, staff and sales.</p>
      {signedIn ? <ChooseRestaurant onSignOut={() => setSignedIn(false)} /> : <SignIn onSignedIn={() => setSignedIn(true)} />}
      {signedIn && <AfterConnect />}
    </Shell>
  );
}

function AfterConnect() {
  const sync = useSyncStatus();
  if (!sync.link) return null;
  return (
    <button className="btn primary" style={{ marginTop: 16 }} onClick={() => go('/')}>
      Done — staff sign in with their PINs
    </button>
  );
}

/** A set-up waiting for the owner to confirm their email (kept so a reload or the email link does not lose it). */
const PENDING_KEY = 'restaurant-pos.setup-pending';
const PIN_KEY = 'restaurant-pos.setup-pin'; // this tab only
interface Pending { name: string; town: string; slug: string; keepMenu: boolean; owner: string; email: string }
function readPending(): Pending | null {
  try {
    return JSON.parse(localStorage.getItem(PENDING_KEY) || 'null');
  } catch {
    return null;
  }
}
export const hasPendingSetup = () => !!readPending();

function NewRestaurant() {
  const pending = readPending();
  const [step, setStep] = useState(pending ? (getSession() ? 3 : 4) : 1);
  const [name, setName] = useState(pending?.name ?? '');
  const [town, setTown] = useState(pending?.town ?? '');
  const [slug, setSlug] = useState(pending?.slug ?? '');
  const [slugOk, setSlugOk] = useState<boolean | null>(pending ? true : null);
  const [keepMenu, setKeepMenu] = useState(pending?.keepMenu ?? true);
  const [owner, setOwner] = useState(pending?.owner ?? '');
  const [pin, setPin] = useState(() => {
    try {
      return sessionStorage.getItem(PIN_KEY) ?? '';
    } catch {
      return '';
    }
  });
  const [pin2, setPin2] = useState(pin);
  const [email, setEmail] = useState(pending?.email ?? '');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState('');

  const next = () => {
    setError('');
    if (step === 1) {
      if (name.trim().length < 2) return setError('Type the restaurant name.');
      if (slug.length < 3 || slugOk === false) return setError('Choose a free web address.');
    }
    if (step === 2) {
      if (!owner.trim()) return setError('Type your name.');
      if (!/^\d{4}$/.test(pin)) return setError('Your PIN must be 4 digits.');
      if (/^(\d)\1{3}$/.test(pin) || pin === '1234') return setError('Choose a PIN that is harder to guess.');
      if (pin !== pin2) return setError('The two PINs are different.');
    }
    setStep(step + 1);
  };

  const finish = async () => {
    setError('');
    if (!/^\S+@\S+\.\S+$/.test(email.trim())) return setError('Type your email address.');
    if (!getSession() && password.length < 8) return setError('Choose a password of at least 8 characters.');
    if (!/^\d{4}$/.test(pin) || pin !== pin2) return setError('Type your 4-digit PIN twice.');
    try {
      setBusy('Creating your account…');
      const r = getSession() ? 'signed-in' : await signUp(email, password);
      if (r === 'confirm') {
        // Email confirmation is on: keep everything until the owner has opened the link.
        try {
          localStorage.setItem(PENDING_KEY, JSON.stringify({ name, town, slug, keepMenu, owner, email: email.trim() } satisfies Pending));
          sessionStorage.setItem(PIN_KEY, pin);
        } catch {
          /* ignore */
        }
        setStep(4);
        return;
      }
      const res = startFresh({ ownerPin: pin, keepMenu, ownerName: owner, restaurantName: name, town });
      if (!res.ok) throw new Error(res.error);
      await createAndUpload({ name: name.trim(), slug, town: town.trim() }, getState().settings.baseCurrency, setBusy);
      try {
        localStorage.removeItem(PENDING_KEY);
        sessionStorage.removeItem(PIN_KEY);
      } catch {
        /* ignore */
      }
      toast(`Welcome to TechPlug POS, ${owner.trim().split(' ')[0]}!`);
      go('/');
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy('');
    }
  };

  /** After opening the email link (on this or another device): sign in here and create the restaurant. */
  const continueAfterEmail = async () => {
    setError('');
    if (!/^\d{4}$/.test(pin) || pin !== pin2) return setError('Type your 4-digit PIN twice.');
    try {
      setBusy('Checking…');
      if (!getSession()) await signIn(email, password);
    } catch (e) {
      setBusy('');
      return setError(e instanceof Error ? e.message : String(e));
    }
    setBusy('');
    await finish();
  };

  if (step === 4)
    return (
      <Shell>
        <div className="cloud-form">
          <h2>Check your email</h2>
          <p>
            We sent a link to <b>{email}</b>. Open it — on your phone is fine — to confirm the address. Then come back here and press <b>Continue</b>.
          </p>
          <p className="muted small">No email after a few minutes? Look in Spam or Promotions.</p>
          {!getSession() && (
            <label className="field">
              Your password
              <input type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />
            </label>
          )}
          {!pin && (
            <div className="form-grid">
              <label className="field">
                Your 4-digit PIN
                <input inputMode="numeric" maxLength={4} type="password" value={pin} onChange={(e) => setPin(e.target.value.replace(/\D/g, ''))} />
              </label>
              <label className="field">
                Type it again
                <input inputMode="numeric" maxLength={4} type="password" value={pin2} onChange={(e) => setPin2(e.target.value.replace(/\D/g, ''))} />
              </label>
            </div>
          )}
          {error && <div className="error-text">{error}</div>}
          <div className="row wrap setup-nav">
            <button
              className="btn"
              onClick={() => {
                try {
                  localStorage.removeItem(PENDING_KEY);
                } catch {
                  /* ignore */
                }
                setStep(3);
              }}
              disabled={!!busy}
            >
              Use another email
            </button>
            <button className="btn primary" onClick={continueAfterEmail} disabled={!!busy}>
              {busy || 'Continue'}
            </button>
          </div>
        </div>
      </Shell>
    );

  return (
    <Shell>
      <ol className="setup-steps">
        {['Restaurant', 'You', 'Account'].map((l, i) => (
          <li key={l} className={i + 1 === step ? 'on' : i + 1 < step ? 'done' : ''}>
            {i + 1}. {l}
          </li>
        ))}
      </ol>
      {step === 1 && (
        <div className="cloud-form">
          <h2>
            <LuStore aria-hidden="true" /> Your restaurant
          </h2>
          <div className="form-grid">
            <label className="field">
              Restaurant name
              <input value={name} onChange={(e) => setName(e.target.value)} autoFocus />
            </label>
            <label className="field">
              Town or city
              <input value={town} onChange={(e) => setTown(e.target.value)} placeholder="e.g. Harare" />
            </label>
          </div>
          <SlugField name={name} slug={slug} setSlug={setSlug} ok={slugOk} setOk={setSlugOk} />
          <div className="toggle">
            <span>
              Start with a sample menu
              <span className="sub">Sadza, rice, chips and drinks to edit into your own. Off = empty menu.</span>
            </span>
            <button className={`switch ${keepMenu ? 'on' : ''}`} role="switch" aria-checked={keepMenu} aria-label="Start with a sample menu" onClick={() => setKeepMenu(!keepMenu)}>
              <span />
            </button>
          </div>
        </div>
      )}
      {step === 2 && (
        <div className="cloud-form">
          <h2>You, the owner</h2>
          <label className="field">
            Your name
            <input value={owner} onChange={(e) => setOwner(e.target.value)} autoFocus />
          </label>
          <div className="form-grid">
            <label className="field">
              Choose your 4-digit PIN
              <input inputMode="numeric" maxLength={4} type="password" value={pin} onChange={(e) => setPin(e.target.value.replace(/\D/g, ''))} />
            </label>
            <label className="field">
              Type it again
              <input inputMode="numeric" maxLength={4} type="password" value={pin2} onChange={(e) => setPin2(e.target.value.replace(/\D/g, ''))} />
            </label>
          </div>
          <p className="hint">You sign in to the till with this PIN. Add your cashiers, kitchen and waiters (each with their own PIN) later under Staff.</p>
        </div>
      )}
      {step === 3 && (
        <div className="cloud-form">
          <h2>Your online account</h2>
          <p className="muted">Keeps a safe copy of everything and connects your other tills, phones and tablets. Free for 30 days.</p>
          <div className="form-grid">
            <label className="field">
              Email
              <input type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} autoFocus />
            </label>
            <label className="field">
              Choose a password
              <input type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} />
            </label>
          </div>
        </div>
      )}
      {error && <div className="error-text">{error}</div>}
      <div className="row wrap setup-nav">
        {step > 1 && (
          <button className="btn" onClick={() => setStep(step - 1)} disabled={!!busy}>
            Back
          </button>
        )}
        {step < 3 ? (
          <button className="btn primary" onClick={next}>
            Next
          </button>
        ) : (
          <button className="btn primary" onClick={finish} disabled={!!busy}>
            {busy || 'Create my restaurant'}
          </button>
        )}
      </div>
    </Shell>
  );
}

