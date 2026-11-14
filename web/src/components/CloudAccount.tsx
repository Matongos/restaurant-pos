/** Settings → Online account: create the restaurant's account, connect more devices, see sync. */
import { useEffect, useState } from 'react';
import { LuCloud, LuCloudOff, LuRefreshCw, LuCircleCheck, LuTriangleAlert, LuStore } from 'react-icons/lu';
import { useStore } from '../store/store';
import { PUBLIC_SITE } from '../cloudConfig';
import { createRestaurant, getSession, sendPasswordReset, setNewPassword, signIn, signOut, signUp, slugAvailable, slugFrom, type Membership } from '../cloud/api';
import { linkAndDownload, linkAndUpload, loadOlderHistory, myRestaurants, restaurantHasData, syncNow, unlink, useSyncStatus } from '../cloud/sync';
import { Dialog, toast } from './ui';
import { AccountSecurity } from './MyAccount';

const PENDING_KEY = 'restaurant-pos.signup-pending';
type Pending = { name: string; slug: string; town: string };
const readPending = (): Pending | null => {
  try {
    return JSON.parse(localStorage.getItem(PENDING_KEY) || 'null');
  } catch {
    return null;
  }
};
const writePending = (p: Pending | null) => {
  try {
    if (p) localStorage.setItem(PENDING_KEY, JSON.stringify(p));
    else localStorage.removeItem(PENDING_KEY);
  } catch {
    /* ignore */
  }
};

/** How a restaurant's web address is shown: pos.techplug.co.zw/<web address>. */
export const WEB_PREFIX = PUBLIC_SITE.replace(/^https?:\/\//, '') + '/';

export default function CloudAccount() {
  const status = useSyncStatus();
  const [, refresh] = useState(0);
  const again = () => refresh((n) => n + 1);
  if (status.link) return <Linked />;
  if (getSession()) return <ChooseRestaurant onSignOut={again} />;
  return <Start onSignedIn={again} />;
}

/* ------------------------------------------------------------------ not signed in */

function Start({ onSignedIn }: { onSignedIn: () => void }) {
  const [mode, setMode] = useState<'new' | 'existing'>(readPending() ? 'existing' : 'new');
  return (
    <>
      <div className="cloud-intro">
        <LuCloud aria-hidden="true" />
        <div>
          <b>Put your restaurant online</b>
          <p className="muted">
            A free online account keeps a safe copy of your sales, menu and books, and keeps every till, phone and tablet of your
            restaurant in step. The till keeps working without internet and catches up when it's back.
          </p>
        </div>
      </div>
      <div className="seg" role="tablist">
        <button className={mode === 'new' ? 'on' : ''} onClick={() => setMode('new')} role="tab" aria-selected={mode === 'new'}>
          New account
        </button>
        <button className={mode === 'existing' ? 'on' : ''} onClick={() => setMode('existing')} role="tab" aria-selected={mode === 'existing'}>
          I already have an account
        </button>
      </div>
      {mode === 'new' ? <SignUp onSignedIn={onSignedIn} onConfirm={() => setMode('existing')} /> : <SignIn onSignedIn={onSignedIn} />}
    </>
  );
}

const RESERVED_PATHS = ['setup', 'console', 'site', 'assets', 'icons', 'online', 'posters', 'display', 'kitchen', 'orders', 'settings'];

export function SlugField({ name, slug, setSlug, ok, setOk }: { name: string; slug: string; setSlug: (s: string) => void; ok: boolean | null; setOk: (b: boolean | null) => void }) {
  const [touched, setTouched] = useState(false);
  useEffect(() => {
    if (!touched) setSlug(slugFrom(name));
  }, [name, touched, setSlug]);
  useEffect(() => {
    setOk(null);
    if (slug.length < 3) return;
    // Words the app's own addresses use (pos.techplug.co.zw/setup, /console…) can't be a restaurant's.
    if (RESERVED_PATHS.includes(slug)) return setOk(false);
    const t = setTimeout(() => {
      slugAvailable(slug)
        .then(setOk)
        .catch(() => setOk(null));
    }, 500);
    return () => clearTimeout(t);
  }, [slug, setOk]);
  return (
    <label className="field">
      Your web address
      <div className="slug-input">
        <span>{WEB_PREFIX}</span>
        <input
          value={slug}
          onChange={(e) => {
            setTouched(true);
            setSlug(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '').slice(0, 40));
          }}
          aria-describedby="slug-help"
        />
      </div>
      <span id="slug-help" className={`slug-state ${ok === false ? 'bad' : ok ? 'good' : ''}`}>
        {slug.length < 3 ? 'At least 3 letters' : ok === false ? 'Taken — try another' : ok ? 'Available' : 'Checking…'}
      </span>
    </label>
  );
}

function SignUp({ onSignedIn, onConfirm }: { onSignedIn: () => void; onConfirm: () => void }) {
  const settings = useStore((s) => s.settings);
  const [name, setName] = useState(settings.restaurantName);
  const [slug, setSlug] = useState(slugFrom(settings.restaurantName));
  const [slugOk, setSlugOk] = useState<boolean | null>(null);
  const [town, setTown] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [sent, setSent] = useState('');

  const problem =
    name.trim().length < 2 ? 'Enter the restaurant name.' :
    slug.length < 3 || slugOk === false ? 'Choose a free web address.' :
    !/^\S+@\S+\.\S+$/.test(email.trim()) ? 'Enter your email address.' :
    password.length < 8 ? 'Choose a password of at least 8 characters.' : '';

  const submit = async () => {
    if (problem) return setError(problem);
    setError('');
    setBusy('Creating your account…');
    try {
      const pending = { name: name.trim(), slug, town: town.trim() };
      const r = await signUp(email, password);
      if (r === 'confirm') {
        writePending(pending);
        setSent(email.trim());
        return;
      }
      await createAndUpload(pending, settings.baseCurrency, setBusy);
      onSignedIn();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy('');
    }
  };

  if (sent)
    return (
      <div className="cloud-sent">
        <b>Check your email</b>
        <p>
          We sent a link to <b>{sent}</b>. Open it to confirm your address, then come back here, choose <b>I already have an account</b> and
          sign in. Your restaurant is set up straight after.
        </p>
        <button className="btn primary" onClick={onConfirm}>
          I've confirmed — sign in
        </button>
      </div>
    );

  return (
    <div className="cloud-form">
      <div className="form-grid">
        <label className="field">
          Restaurant name
          <input value={name} onChange={(e) => setName(e.target.value)} />
        </label>
        <label className="field">
          Town or city
          <input value={town} onChange={(e) => setTown(e.target.value)} placeholder="e.g. Harare" />
        </label>
      </div>
      <SlugField name={name} slug={slug} setSlug={setSlug} ok={slugOk} setOk={setSlugOk} />
      <div className="form-grid">
        <label className="field">
          Your email
          <input type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} />
        </label>
        <label className="field">
          Choose a password
          <input type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} />
        </label>
      </div>
      <p className="hint">
        This device's menu, staff, sales and books become the restaurant's online data. Free for 30 days. Staff keep using their PINs; the email and
        password are only for connecting devices.
      </p>
      {error && <div className="error-text">{error}</div>}
      <button className="btn primary" onClick={submit} disabled={!!busy}>
        {busy || 'Create account'}
      </button>
    </div>
  );
}

export function SignIn({ onSignedIn }: { onSignedIn: () => void }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const submit = async () => {
    setError('');
    setBusy(true);
    try {
      await signIn(email, password);
      onSignedIn();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };
  const forgot = async () => {
    if (!/^\S+@\S+\.\S+$/.test(email.trim())) return setError('Type your email above first.');
    try {
      await sendPasswordReset(email);
      toast('We emailed you a link to choose a new password');
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };
  return (
    <form
      className="cloud-form"
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
    >
      <div className="form-grid">
        <label className="field">
          Email
          <input type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} />
        </label>
        <label className="field">
          Password
          <input type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />
        </label>
      </div>
      {error && <div className="error-text">{error}</div>}
      <div className="row wrap">
        <button className="btn primary" type="submit" disabled={busy}>
          {busy ? 'Signing in…' : 'Sign in'}
        </button>
        <button className="btn ghost" type="button" onClick={forgot}>
          Forgot password?
        </button>
      </div>
    </form>
  );
}

export async function createAndUpload(p: Pending, currency: string, say: (s: string) => void) {
  say('Creating your restaurant…');
  const id = await createRestaurant(p.name, p.slug, p.town, currency || 'USD');
  writePending(null);
  say('Sending your data…');
  await linkAndUpload({ restaurantId: id, restaurantName: p.name, slug: p.slug, email: getSession()?.email ?? '', role: 'owner' }, (n) =>
    say(n ? `Sending your data… ${n} left` : 'Finishing…'),
  );
  toast('Your restaurant is online');
}

/* ------------------------------------------------------------------ signed in, pick the restaurant */

export function ChooseRestaurant({ onSignOut }: { onSignOut: () => void }) {
  const settings = useStore((s) => s.settings);
  const [list, setList] = useState<Membership[] | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState('');
  const [confirm, setConfirm] = useState<Membership | null>(null);
  const pending = readPending();
  const email = getSession()?.email;

  useEffect(() => {
    myRestaurants()
      .then(setList)
      .catch((e) => setError(e instanceof Error ? e.message : String(e)));
  }, []);

  const run = async (fn: () => Promise<void>) => {
    setError('');
    try {
      await fn();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy('');
    }
  };

  const use = (m: Membership) =>
    run(async () => {
      setBusy('Checking…');
      const base = { restaurantId: m.restaurant_id, restaurantName: m.restaurants?.name ?? '', slug: m.restaurants?.slug ?? '', email: email ?? '', role: m.role };
      if (await restaurantHasData(m.restaurant_id)) {
        if (confirm?.restaurant_id !== m.restaurant_id) {
          setConfirm(m);
          return;
        }
        setBusy('Downloading…');
        const n = await linkAndDownload(base, (k) => setBusy(`Downloading… ${k}`));
        toast(`Connected — ${n} items downloaded`);
      } else {
        setBusy('Sending your data…');
        await linkAndUpload(base, (k) => setBusy(k ? `Sending your data… ${k} left` : 'Finishing…'));
        toast('Your restaurant is online');
      }
    });

  const [form, setForm] = useState<Pending>(pending ?? { name: settings.restaurantName, slug: slugFrom(settings.restaurantName), town: '' });
  const [slugOk, setSlugOk] = useState<boolean | null>(null);

  if (!list && !error) return <p className="muted">Loading your restaurants…</p>;

  return (
    <>
      <p>
        Signed in as <b>{email}</b>.{' '}
        <button
          className="link-btn"
          onClick={async () => {
            await signOut();
            onSignOut();
          }}
        >
          Sign out
        </button>
      </p>
      {error && <div className="error-text">{error}</div>}
      {list && list.length > 0 && (
        <>
          <h3 className="cloud-h">Use this device for</h3>
          <div className="cloud-list">
            {list.map((m) => (
              <div key={m.restaurant_id} className="cloud-item">
                <LuStore aria-hidden="true" />
                <div className="grow">
                  <b>{m.restaurants?.name}</b>
                  <div className="muted">
                    {WEB_PREFIX}{m.restaurants?.slug} · {m.role}
                  </div>
                </div>
                <button className="btn primary" disabled={!!busy} onClick={() => use(m)}>
                  {busy && confirm?.restaurant_id !== m.restaurant_id ? busy : 'Connect'}
                </button>
              </div>
            ))}
          </div>
          {confirm && (
            <div className="cloud-warn" role="alert">
              <LuTriangleAlert aria-hidden="true" />
              <div className="grow">
                <b>Replace this device's data with {confirm.restaurants?.name}'s?</b>
                <p>The menu, staff, sales and books on this device are swapped for the restaurant's online data. Staff then sign in with their own PINs.</p>
                <div className="row wrap">
                  <button className="btn" onClick={() => setConfirm(null)} disabled={!!busy}>
                    Cancel
                  </button>
                  <button className="btn primary" onClick={() => use(confirm)} disabled={!!busy}>
                    {busy || 'Yes, download'}
                  </button>
                </div>
              </div>
            </div>
          )}
        </>
      )}
      {list && list.length === 0 && (
        <div className="cloud-form">
          <h3 className="cloud-h">Set up your restaurant</h3>
          <div className="form-grid">
            <label className="field">
              Restaurant name
              <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
            </label>
            <label className="field">
              Town or city
              <input value={form.town} onChange={(e) => setForm({ ...form, town: e.target.value })} />
            </label>
          </div>
          <SlugField name={form.name} slug={form.slug} setSlug={(s) => setForm((f) => ({ ...f, slug: s }))} ok={slugOk} setOk={setSlugOk} />
          <button
            className="btn primary"
            disabled={!!busy || form.name.trim().length < 2 || form.slug.length < 3 || slugOk === false}
            onClick={() => run(() => createAndUpload({ ...form, name: form.name.trim(), town: form.town.trim() }, settings.baseCurrency, setBusy))}
          >
            {busy || 'Create restaurant and send this device’s data'}
          </button>
        </div>
      )}
    </>
  );
}

/* ------------------------------------------------------------------ connected */

function ago(iso: string | null): string {
  if (!iso) return 'not yet';
  const s = Math.round((Date.now() - Date.parse(iso)) / 1000);
  if (s < 10) return 'just now';
  if (s < 60) return `${s} seconds ago`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m} minute${m === 1 ? '' : 's'} ago`;
  return new Date(iso).toLocaleString();
}

/** This device has the last months of sales; older ones stay online and can be brought here for reports. */
function OlderHistory({ from }: { from: string }) {
  const [busy, setBusy] = useState('');
  const load = async () => {
    setBusy('Loading…');
    try {
      const n = await loadOlderHistory((k) => setBusy(`Loading… ${k}`));
      toast(n ? `Older sales loaded (${n})` : 'There were no older sales');
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy('');
    }
  };
  return (
    <div className="cloud-history">
      <div className="grow">
        <b>Sales on this device start {new Date(from).toLocaleDateString(undefined, { day: 'numeric', month: 'long', year: 'numeric' })}</b>
        <div className="muted">Older sales are kept safely online. Load them here if you need reports for longer ago.</div>
      </div>
      <button className="btn" onClick={load} disabled={!!busy}>
        {busy || 'Load older sales'}
      </button>
    </div>
  );
}

function Linked() {
  const st = useSyncStatus();
  const [sure, setSure] = useState(false);
  const [, tick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => tick((x) => x + 1), 5000);
    return () => clearInterval(t);
  }, []);
  const l = st.link!;
  const bad = st.state === 'error' || st.state === 'signed-out';
  return (
    <>
      <div className="cloud-intro">
        <LuStore aria-hidden="true" />
        <div>
          <b>{l.restaurantName}</b>
          <div className="muted">
            {WEB_PREFIX}{l.slug} · signed in as {l.email}
          </div>
        </div>
      </div>
      <div className={`cloud-state ${bad ? 'bad' : st.state === 'offline' ? 'off' : 'good'}`} role="status">
        {bad ? <LuTriangleAlert aria-hidden="true" /> : st.state === 'offline' ? <LuCloudOff aria-hidden="true" /> : <LuCircleCheck aria-hidden="true" />}
        <div className="grow">
          <b>
            {st.state === 'syncing'
              ? 'Syncing…'
              : st.state === 'offline'
                ? 'No internet — saving on this device'
                : bad
                  ? 'Not syncing'
                  : st.pending
                    ? `${st.pending} change${st.pending === 1 ? '' : 's'} waiting to send`
                    : 'Up to date'}
          </b>
          <div className="muted">
            {bad ? st.error : st.state === 'offline' && st.pending ? `${st.pending} changes will be sent when the internet is back.` : `Last synced ${ago(st.lastSync)}`}
          </div>
        </div>
        <button className="btn" onClick={() => void syncNow()} disabled={st.state === 'syncing'}>
          <LuRefreshCw aria-hidden="true" /> Sync now
        </button>
      </div>
      {st.state === 'signed-out' && <SignIn onSignedIn={() => void syncNow()} />}
      {(
        <div className="acct-card">
          <h3>Account</h3>
          <dl className="acct-facts">
            <dt>Email</dt>
            <dd className="acct-email">{l.email}</dd>
            <dt>Web address</dt>
            <dd>
              {WEB_PREFIX}
              {l.slug}
            </dd>
          </dl>
          <AccountSecurity />
        </div>
      )}
      {l.historyFrom && <OlderHistory from={l.historyFrom} />}
      <p className="hint">
        To add another till, phone or tablet: open TechPlug POS on it, go to Settings → Online account, and sign in with the same email.
      </p>
      {!sure ? (
        <button className="btn ghost danger-text" onClick={() => setSure(true)}>
          Disconnect this device
        </button>
      ) : (
        <div className="row wrap">
          <b>{st.pending ? `${st.pending} changes have not been sent yet. ` : ''}Stop syncing on this device?</b>
          <button className="btn" onClick={() => setSure(false)}>
            Keep syncing
          </button>
          <button
            className="btn primary"
            onClick={async () => {
              await unlink();
              toast('This device is no longer connected');
            }}
          >
            Disconnect
          </button>
        </div>
      )}
    </>
  );
}

/* ------------------------------------------------------------------ back from an email link */

export function LinkNotice() {
  const [type, setType] = useState(() => {
    try {
      return sessionStorage.getItem('restaurant-pos.link-type');
    } catch {
      return null;
    }
  });
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  if (!type) return null;
  const close = () => {
    try {
      sessionStorage.removeItem('restaurant-pos.link-type');
    } catch {
      /* ignore */
    }
    setType(null);
  };
  const failed = type.startsWith('error:');
  return (
    <Dialog title={failed ? 'That link did not work' : type === 'recovery' ? 'Choose a new password' : 'Email confirmed'} onClose={close} width={460}>
      {failed ? (
        <p>{type.slice(6)}. Links work once and for a limited time — ask for a new one from Settings → Online account.</p>
      ) : type === 'recovery' ? (
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            if (password.length < 8) return setError('At least 8 characters.');
            try {
              await setNewPassword(password);
              toast('Password changed');
              close();
            } catch (err) {
              setError(err instanceof Error ? err.message : String(err));
            }
          }}
        >
          <label className="field">
            New password
            <input type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} autoFocus />
          </label>
          {error && <div className="error-text">{error}</div>}
          <button className="btn primary" type="submit">
            Save password
          </button>
        </form>
      ) : (
        <>
          <p>
            Thank you — your email is confirmed. Sign in with the owner PIN and open <b>Settings → Online account</b> to finish setting up your
            restaurant.
          </p>
          <button className="btn primary" onClick={close}>
            OK
          </button>
        </>
      )}
    </Dialog>
  );
}
