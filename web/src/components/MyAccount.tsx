/**
 * "My account" (from the name, top right): who you are, your PIN, and the restaurant's online account —
 * its email, web address and sync state, with change password / change email for the owner.
 */
import { useState } from 'react';
import { LuCircleUserRound, LuEye, LuEyeOff, LuKeyRound, LuMail, LuStore } from 'react-icons/lu';
import { Dialog, toast } from './ui';
import { changeEmail, changePassword, getSession } from '../cloud/api';
import { setLinkEmail, useSyncStatus } from '../cloud/sync';
import { changeMyPin, updateStaff, useCurrentUser } from '../store/store';
import { can, ROLE_LABEL } from '../domain/rules';
import { go } from '../router';
import { WEB_PREFIX } from './CloudAccount';
import { SUPPORT_WHATSAPP } from '../cloudConfig';

export default function MyAccount({ onClose }: { onClose: () => void }) {
  const user = useCurrentUser();
  if (!user) return null;
  return (
    <Dialog title="My account" onClose={onClose} width={640} className="acct-dialog">
      <You />
      <OnlineAccount onClose={onClose} />
    </Dialog>
  );
}

/* ------------------------------------------------------------------ you */

function You() {
  const user = useCurrentUser()!;
  const mayRename = can(user.role, 'staff');
  const [renaming, setRenaming] = useState(false);
  const [name, setName] = useState(user.name);
  const [pinOpen, setPinOpen] = useState(false);
  const [error, setError] = useState('');
  const saveName = () => {
    const r = updateStaff(user.id, { name }, user.id);
    if (!r.ok) return setError(r.error);
    setError('');
    setRenaming(false);
    toast('Your name is changed');
  };
  return (
    <section className="acct-card" aria-labelledby="acct-you">
      <div className="acct-head">
        <span className="acct-avatar" aria-hidden="true">{user.name.slice(0, 1).toUpperCase()}</span>
        <div className="grow">
          <h3 id="acct-you">{user.name}</h3>
          <div className="muted">
            {ROLE_LABEL[user.role]}
            {user.phone ? ` · ${user.phone}` : ''}
          </div>
        </div>
        {mayRename && !renaming && (
          <button className="btn small" onClick={() => setRenaming(true)}>
            Change name
          </button>
        )}
      </div>
      {renaming && (
        <div className="acct-form">
          <label className="field">
            Your name
            <input value={name} onChange={(e) => setName(e.target.value)} autoFocus />
          </label>
          <div className="row wrap">
            <button className="btn" onClick={() => { setRenaming(false); setName(user.name); setError(''); }}>
              Cancel
            </button>
            <button className="btn primary" onClick={saveName}>
              Save name
            </button>
          </div>
        </div>
      )}
      <div className="acct-row">
        <LuKeyRound aria-hidden="true" />
        <div className="grow">
          <b>PIN</b>
          <div className="muted">You log in to the till with your 4-digit PIN.</div>
        </div>
        {!pinOpen && (
          <button className="btn small" onClick={() => setPinOpen(true)}>
            Change my PIN
          </button>
        )}
      </div>
      {pinOpen && <PinForm onDone={() => setPinOpen(false)} />}
      {error && <div className="error">{error}</div>}
    </section>
  );
}

function PinForm({ onDone }: { onDone: () => void }) {
  const user = useCurrentUser()!;
  const [current, setCurrent] = useState('');
  const [pin, setPin] = useState('');
  const [again, setAgain] = useState('');
  const [show, setShow] = useState(false);
  const [error, setError] = useState('');
  const clean = (v: string) => v.replace(/\D/g, '').slice(0, 4);
  const save = () => {
    if (current.length < 4) return setError('Type your current PIN');
    if (pin.length < 4) return setError('Type a new 4-digit PIN');
    if (pin !== again) return setError("The two new PINs don't match");
    const r = changeMyPin(user.id, current, pin);
    if (!r.ok) return setError(r.error);
    toast('Your PIN is changed — use the new one next time you log in');
    onDone();
  };
  const type = show ? 'text' : 'password';
  return (
    <div className="acct-form">
      <div className="acct-grid3">
        <label className="field">
          Current PIN
          <input type={type} inputMode="numeric" autoComplete="current-password" value={current} onChange={(e) => setCurrent(clean(e.target.value))} autoFocus />
        </label>
        <label className="field">
          New PIN
          <input type={type} inputMode="numeric" autoComplete="new-password" value={pin} onChange={(e) => setPin(clean(e.target.value))} />
        </label>
        <label className="field">
          New PIN again
          <input type={type} inputMode="numeric" autoComplete="new-password" value={again} onChange={(e) => setAgain(clean(e.target.value))} />
        </label>
      </div>
      {error && <div className="error">{error}</div>}
      <div className="row wrap">
        <button type="button" className="btn ghost" onClick={() => setShow((x) => !x)}>
          {show ? <LuEyeOff aria-hidden="true" /> : <LuEye aria-hidden="true" />} {show ? 'Hide' : 'Show'}
        </button>
        <span className="grow" />
        <button className="btn" onClick={onDone}>
          Cancel
        </button>
        <button className="btn primary" onClick={save}>
          Change PIN
        </button>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ online account */

function OnlineAccount({ onClose }: { onClose: () => void }) {
  const user = useCurrentUser()!;
  const st = useSyncStatus();
  const owner = user.role === 'super_admin';
  const seesEmail = owner || user.role === 'manager';
  const l = st.link;
  if (!l)
    return (
      <section className="acct-card" aria-labelledby="acct-online">
        <h3 id="acct-online">
          <LuStore aria-hidden="true" /> Online account
        </h3>
        <p className="muted">This till is not connected to an online account, so it keeps everything on this device only.</p>
        {owner && (
          <button className="btn primary" onClick={() => { onClose(); go('/settings?tab=online'); }}>
            Set up the online account
          </button>
        )}
      </section>
    );
  const state =
    st.state === 'offline' ? 'No internet — saving on this device' : st.state === 'error' || st.state === 'signed-out' ? 'Not syncing — sign in again in Settings → Online account' : 'Connected and up to date';
  return (
    <section className="acct-card" aria-labelledby="acct-online">
      <h3 id="acct-online">
        <LuStore aria-hidden="true" /> {l.restaurantName}
      </h3>
      <dl className="acct-facts">
        {seesEmail && (
          <>
            <dt>Account email</dt>
            <dd className="acct-email">{l.email}</dd>
          </>
        )}
        <dt>Web address</dt>
        <dd>
          {WEB_PREFIX}
          {l.slug}
        </dd>
        <dt>This device</dt>
        <dd>{state}</dd>
      </dl>
      {owner ? <AccountSecurity /> : <p className="hint">Only the owner can change the account's email or password.</p>}
    </section>
  );
}

/** Change password / change email for the restaurant's online account (owner). Also used in Settings → Online account. */
export function AccountSecurity() {
  const [open, setOpen] = useState<'' | 'password' | 'email'>('');
  const signedIn = !!getSession();
  if (!signedIn) return <p className="hint">Sign in again under Settings → Online account to change the email or password.</p>;
  return (
    <div className="acct-security">
      <div className="acct-row">
        <LuKeyRound aria-hidden="true" />
        <div className="grow">
          <b>Password</b>
          <div className="muted">Used to connect new tills, phones and tablets to your restaurant.</div>
        </div>
        {open !== 'password' && (
          <button className="btn small" onClick={() => setOpen('password')}>
            Change password
          </button>
        )}
      </div>
      {open === 'password' && <PasswordForm onDone={() => setOpen('')} />}
      <div className="acct-row">
        <LuMail aria-hidden="true" />
        <div className="grow">
          <b>Email</b>
          <div className="muted">The email you sign in with. Use one you check — it gets password reset links.</div>
        </div>
        {open !== 'email' && (
          <button className="btn small" onClick={() => setOpen('email')}>
            Change email
          </button>
        )}
      </div>
      {open === 'email' && <EmailForm onDone={() => setOpen('')} />}
      <p className="hint">
        Forgot the password? {SUPPORT_WHATSAPP ? <a href={`https://wa.me/${SUPPORT_WHATSAPP}`} target="_blank" rel="noreferrer">Message TechPlug on WhatsApp</a> : 'Contact TechPlug'} and we will reset it for you.
      </p>
    </div>
  );
}

function PasswordForm({ onDone }: { onDone: () => void }) {
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [again, setAgain] = useState('');
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const save = async () => {
    if (!current) return setError('Type your current password');
    if (next.length < 8) return setError('Choose a new password of at least 8 characters');
    if (next !== again) return setError("The two new passwords don't match");
    setBusy(true);
    setError('');
    try {
      await changePassword(current, next);
      toast('Password changed. Use the new one when you connect a device.');
      onDone();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };
  const type = show ? 'text' : 'password';
  return (
    <div className="acct-form">
      <label className="field">
        Current password
        <input type={type} autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} autoFocus />
      </label>
      <div className="form-grid">
        <label className="field">
          New password
          <input type={type} autoComplete="new-password" value={next} onChange={(e) => setNext(e.target.value)} />
        </label>
        <label className="field">
          New password again
          <input type={type} autoComplete="new-password" value={again} onChange={(e) => setAgain(e.target.value)} />
        </label>
      </div>
      {error && <div className="error">{error}</div>}
      <div className="row wrap">
        <button type="button" className="btn ghost" onClick={() => setShow((x) => !x)}>
          {show ? <LuEyeOff aria-hidden="true" /> : <LuEye aria-hidden="true" />} {show ? 'Hide' : 'Show'}
        </button>
        <span className="grow" />
        <button className="btn" onClick={onDone} disabled={busy}>
          Cancel
        </button>
        <button className="btn primary" onClick={save} disabled={busy}>
          {busy ? 'Changing…' : 'Change password'}
        </button>
      </div>
    </div>
  );
}

function EmailForm({ onDone }: { onDone: () => void }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const save = async () => {
    setBusy(true);
    setError('');
    try {
      const r = await changeEmail(email, password);
      if (r === 'changed') {
        setLinkEmail(getSession()?.email ?? email.trim().toLowerCase());
        toast('Email changed. Sign in with the new email from now on.');
      } else toast('Open the link we emailed to the new address to finish the change.');
      onDone();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="acct-form">
      <div className="form-grid">
        <label className="field">
          New email
          <input type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} autoFocus />
        </label>
        <label className="field">
          Your password
          <input type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />
        </label>
      </div>
      {error && <div className="error">{error}</div>}
      <div className="row wrap">
        <span className="grow" />
        <button className="btn" onClick={onDone} disabled={busy}>
          Cancel
        </button>
        <button className="btn primary" onClick={save} disabled={busy}>
          {busy ? 'Changing…' : 'Change email'}
        </button>
      </div>
    </div>
  );
}

export { LuCircleUserRound as AccountIcon };
