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
import { getSession, signUp } from '../cloud/api';
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

function NewRestaurant() {
  const [step, setStep] = useState(1);
  const [name, setName] = useState('');
  const [town, setTown] = useState('');
  const [slug, setSlug] = useState('');
  const [slugOk, setSlugOk] = useState<boolean | null>(null);
  const [keepMenu, setKeepMenu] = useState(true);
  const [owner, setOwner] = useState('');
  const [pin, setPin] = useState('');
  const [pin2, setPin2] = useState('');
  const [email, setEmail] = useState('');
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
    if (password.length < 8) return setError('Choose a password of at least 8 characters.');
    try {
      setBusy('Creating your account…');
      const r = getSession() ? 'signed-in' : await signUp(email, password);
      if (r === 'confirm') {
        setError('Please confirm your email: open the link we sent, then come back and choose "Connect this device".');
        return;
      }
      const res = startFresh({ ownerPin: pin, keepMenu, ownerName: owner, restaurantName: name, town });
      if (!res.ok) throw new Error(res.error);
      await createAndUpload({ name: name.trim(), slug, town: town.trim() }, getState().settings.baseCurrency, setBusy);
      toast(`Welcome to TechPlug POS, ${owner.trim().split(' ')[0]}!`);
      go('/');
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy('');
    }
  };

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

