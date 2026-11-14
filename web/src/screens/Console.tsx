/**
 * TechPlug owner console (#/console): downloads, website visits, sign-ups, restaurants, plans and payments.
 * Only for TechPlug admins (platform_admins), and only with two-step login: password plus a 6-digit code
 * from an authenticator app (database step 4 makes the server insist on it). Signs out after 30 idle minutes.
 */
import { useCallback, useEffect, useState } from 'react';
import {
  LuDownload, LuEye, LuMonitorSmartphone, LuStore, LuUserPlus, LuActivity, LuWallet, LuRefreshCw, LuLogOut, LuShieldCheck, LuTrash2,
  LuHistory, LuBanknote, LuTriangleAlert, LuSettings,
} from 'react-icons/lu';
import { enrollTotp, getSession, myFactors, removeFactor, rpc, select, sessionLevel, signIn, signOut, verifyTotp, type Factor } from '../cloud/api';
import { getLink } from '../cloud/sync';
import { Dialog } from '../components/ui';
import QR from '../components/QR';

interface Overview {
  visits: number; downloads: number; firstOpens: number; signups: number; restaurants: number; activeWeek: number; paying: number; monthlyIncome: number;
  paidThisMonth?: number; overdue?: number;
  perDay: { day: string; downloads: number; signups: number }[]; countries: Record<string, number>;
}
interface Row {
  id: string; name: string; slug: string; town: string | null; plan: string; trial_ends_at: string; created_at: string; last_seen_at: string | null;
  owner_email: string | null; devices: number; orders: number; web_page: boolean; qr_menu: boolean; online_orders: boolean; online_orders_count: number;
  group_id?: string | null; group_name?: string | null; branches?: number; paid_until?: string | null; last_payment?: string | null;
}
interface Payment { id: string; amount: number; currency: string; method: string; reference: string | null; plan: string; months: number; paid_until: string | null; note: string | null; created_at: string }
interface LogRow { id: number; at: string; action: string; restaurant: string | null; detail: Record<string, unknown> }
interface Release { tag_name: string; published_at: string; assets: { name: string; download_count: number }[] }

const PLANS = ['trial', 'restaurant', 'group', 'free', 'closed'];
const PLAN_LABEL: Record<string, string> = { trial: 'Free trial', restaurant: 'Restaurant $15', group: 'Group $35', free: 'Free (given)', closed: 'Closed' };
const METHODS: [string, string][] = [['cash', 'Cash'], ['ecocash', 'EcoCash'], ['onemoney', 'OneMoney'], ['innbucks', 'InnBucks'], ['bank', 'Bank transfer'], ['card', 'Card'], ['other', 'Other']];
const IDLE_MS = 30 * 60_000;
const dmy = (iso: string) => new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });

export default function Console() {
  const [signedIn, setSignedIn] = useState(!!getSession());
  useEffect(() => {
    document.title = 'TechPlug console';
  }, []);
  // Sign out after 30 minutes without use.
  useEffect(() => {
    if (!signedIn) return;
    let last = Date.now();
    const touch = () => (last = Date.now());
    const evs = ['mousemove', 'keydown', 'pointerdown', 'scroll'];
    evs.forEach((e) => window.addEventListener(e, touch, { passive: true }));
    const t = setInterval(async () => {
      if (Date.now() - last > IDLE_MS) {
        await signOut();
        setSignedIn(false);
      }
    }, 30_000);
    return () => {
      evs.forEach((e) => window.removeEventListener(e, touch));
      clearInterval(t);
    };
  }, [signedIn]);

  if (getLink())
    return (
      <div className="console">
        <div className="card console-msg">
          <b>This device is a restaurant till.</b>
          <p>Open the console on another device or in another browser, so the till stays signed in to its restaurant.</p>
        </div>
      </div>
    );
  return <div className="console">{signedIn ? <Gate onOut={() => setSignedIn(false)} /> : <ConsoleSignIn onIn={() => setSignedIn(true)} />}</div>;
}

function ConsoleSignIn({ onIn }: { onIn: () => void }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  return (
    <form
      className="console-signin card"
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        setError('');
        try {
          await signIn(email, password);
          onIn();
        } catch (err) {
          setError(err instanceof Error ? err.message : String(err));
        } finally {
          setBusy(false);
        }
      }}
    >
      <h1>TechPlug console</h1>
      <p className="muted">Sign in with your TechPlug admin email. You will also need the code from your authenticator app.</p>
      <label className="field">
        Email
        <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" />
      </label>
      <label className="field">
        Password
        <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" />
      </label>
      {error && <div className="error-text">{error}</div>}
      <button className="btn primary" disabled={busy}>
        {busy ? 'Signing in…' : 'Sign in'}
      </button>
    </form>
  );
}

/* ------------------------------------------------------------------ two-step login */

type GateState = { kind: 'checking' } | { kind: 'not-admin' } | { kind: 'code'; factor: Factor } | { kind: 'enroll' } | { kind: 'open' } | { kind: 'error'; msg: string };

function Gate({ onOut }: { onOut: () => void }) {
  const [st, setSt] = useState<GateState>({ kind: 'checking' });
  const check = useCallback(async () => {
    try {
      const s = await rpc<{ admin: boolean; aal2: boolean }>('admin_status', {});
      if (!s.admin) return setSt({ kind: 'not-admin' });
      if (s.aal2 || sessionLevel() === 'aal2') return setSt({ kind: 'open' });
      const f = (await myFactors()).find((x) => x.status === 'verified');
      setSt(f ? { kind: 'code', factor: f } : { kind: 'enroll' });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      // Database step 4 not run yet: no two-step check on the server; the console works as before.
      if (/admin_status|function|schema cache/i.test(msg)) setSt({ kind: 'open' });
      else setSt({ kind: 'error', msg });
    }
  }, []);
  useEffect(() => {
    void check();
  }, [check]);
  const out = async () => {
    await signOut();
    onOut();
  };
  if (st.kind === 'checking') return <div className="card console-msg">Checking…</div>;
  if (st.kind === 'error') return <div className="card console-msg error-text">{st.msg}</div>;
  if (st.kind === 'not-admin')
    return (
      <div className="card console-msg">
        <b>This email is not a TechPlug admin.</b>
        <p>In Supabase → SQL Editor, run (with your email):</p>
        <code>insert into platform_admins (user_id) select id from auth.users where email = '{getSession()?.email}';</code>
        <button className="btn" style={{ marginTop: 12 }} onClick={out}>
          Sign out
        </button>
      </div>
    );
  if (st.kind === 'code') return <CodeStep factor={st.factor} onDone={check} onOut={out} />;
  if (st.kind === 'enroll') return <EnrollStep onDone={check} onOut={out} />;
  return <Dashboard onOut={out} />;
}

function CodeStep({ factor, onDone, onOut }: { factor: Factor; onDone: () => void; onOut: () => void }) {
  const [code, setCode] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  return (
    <form
      className="console-signin card"
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        setError('');
        try {
          await verifyTotp(factor.id, code);
          onDone();
        } catch (err) {
          setError(err instanceof Error ? err.message : String(err));
        } finally {
          setBusy(false);
        }
      }}
    >
      <h1>
        <LuShieldCheck aria-hidden="true" /> Your code
      </h1>
      <p className="muted">Open your authenticator app (Google Authenticator, Microsoft Authenticator…) and type the 6 numbers for TechPlug.</p>
      <label className="field">
        6-digit code
        <input inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))} autoFocus />
      </label>
      {error && <div className="error-text">{error}</div>}
      <button className="btn primary" disabled={busy || code.length !== 6}>
        {busy ? 'Checking…' : 'Open the console'}
      </button>
      <button type="button" className="btn ghost" onClick={onOut}>
        Sign out
      </button>
    </form>
  );
}

function EnrollStep({ onDone, onOut }: { onDone: () => void; onOut: () => void }) {
  const [f, setF] = useState<{ id: string; qr: string; secret: string; uri: string } | null>(null);
  const [code, setCode] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        // Clear half-finished set-ups from earlier tries, then start a new one.
        for (const old of (await myFactors()).filter((x) => x.status === 'unverified')) await removeFactor(old.id).catch(() => undefined);
        const n = await enrollTotp();
        if (alive) setF(n);
      } catch (e) {
        if (alive) setError(e instanceof Error ? e.message : String(e));
      }
    })();
    return () => {
      alive = false;
    };
  }, []);
  return (
    <form
      className="console-signin card console-enroll"
      onSubmit={async (e) => {
        e.preventDefault();
        if (!f) return;
        setBusy(true);
        setError('');
        try {
          await verifyTotp(f.id, code);
          onDone();
        } catch (err) {
          setError(err instanceof Error ? err.message : String(err));
        } finally {
          setBusy(false);
        }
      }}
    >
      <h1>
        <LuShieldCheck aria-hidden="true" /> Set up two-step login
      </h1>
      <p className="muted">The console holds every restaurant's details, so it needs more than a password. This takes one minute, once.</p>
      <ol className="enroll-steps">
        <li>On your phone, install <b>Google Authenticator</b> or <b>Microsoft Authenticator</b> (free).</li>
        <li>In the app, tap <b>+</b> and scan this code:</li>
      </ol>
      {f ? (
        <>
          <div className="enroll-qr">
            {/* Drawn here from the otpauth:// link (Supabase's own picture does not show in every browser). */}
            <QR text={f.uri || `otpauth://totp/TechPlug%20POS:${encodeURIComponent(getSession()?.email ?? 'admin')}?secret=${f.secret}&issuer=TechPlug%20POS`} size={184} label="QR code to scan with your authenticator app" />
          </div>
          <p className="small muted">
            Can't scan? Type this key instead: <code className="enroll-secret">{f.secret}</code>
          </p>
        </>
      ) : (
        !error && <p className="muted">Preparing…</p>
      )}
      <ol className="enroll-steps" start={3}>
        <li>Type the 6 numbers the app shows for TechPlug:</li>
      </ol>
      <label className="field">
        6-digit code
        <input inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))} />
      </label>
      {error && <div className="error-text">{error}</div>}
      <button className="btn primary" disabled={busy || !f || code.length !== 6}>
        {busy ? 'Checking…' : 'Turn on two-step login'}
      </button>
      <button type="button" className="btn ghost" onClick={onOut}>
        Sign out
      </button>
    </form>
  );
}

/* ------------------------------------------------------------------ dashboard */

function ago(iso: string | null): string {
  if (!iso) return 'never';
  const m = Math.round((Date.now() - Date.parse(iso)) / 60000);
  if (m < 3) return 'online now';
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 48) return `${h} h ago`;
  return `${Math.round(h / 24)} days ago`;
}

function Dashboard({ onOut }: { onOut: () => void }) {
  const [days, setDays] = useState(30);
  const [ov, setOv] = useState<Overview | null>(null);
  const [rows, setRows] = useState<Row[]>([]);
  const [gh, setGh] = useState<{ total: number; latest: string } | null>(null);
  const [error, setError] = useState('');
  const [q, setQ] = useState('');
  const [loading, setLoading] = useState(false);
  const [paying, setPaying] = useState<Row | null>(null);
  const [history, setHistory] = useState<Row | null>(null);
  const [deleting, setDeleting] = useState<Row | null>(null);
  const [settings, setSettings] = useState(false);
  const [log, setLog] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const [o, r] = await Promise.all([rpc<Overview>('console_overview', { p_days: days }), rpc<Row[]>('console_restaurants', {})]);
      setOv(o);
      setRows(r);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setError(/not allowed/i.test(msg) ? 'Not allowed. Sign out and in again with your code.' : /console_restaurants|function/i.test(msg) ? 'needs-sql' : msg);
    } finally {
      setLoading(false);
    }
    fetch('https://api.github.com/repos/Matongos/restaurant-pos/releases')
      .then((r) => (r.ok ? r.json() : []))
      .then((rel: Release[]) => {
        const total = rel.reduce((s, x) => s + x.assets.filter((a) => a.name.endsWith('.exe')).reduce((t, a) => t + a.download_count, 0), 0);
        setGh({ total, latest: rel[0]?.tag_name ?? '' });
      })
      .catch(() => undefined);
  }, [days]);
  useEffect(() => {
    void load();
  }, [load]);

  const setPlan = async (r: Row, plan: string, trialDays?: number) => {
    try {
      await rpc('admin_set_plan', { p_restaurant: r.id, p_plan: plan, p_trial_days: trialDays ?? null });
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const email = getSession()?.email;
  const hasPayments = !!ov && ov.paidThisMonth !== undefined;
  const head = (
    <header className="console-head">
      <div>
        <h1>TechPlug console</h1>
        <span className="muted">
          Signed in as {email}
          {sessionLevel() === 'aal2' && (
            <>
              {' '}
              · <LuShieldCheck aria-hidden="true" /> two-step login
            </>
          )}
        </span>
      </div>
      <div className="row wrap">
        <div className="seg small">
          {[7, 30, 90].map((d) => (
            <button key={d} className={days === d ? 'on' : ''} onClick={() => setDays(d)}>
              {d} days
            </button>
          ))}
        </div>
        <button className="btn" onClick={() => void load()} disabled={loading}>
          <LuRefreshCw aria-hidden="true" /> Refresh
        </button>
        {hasPayments && (
          <>
            <button className="btn" onClick={() => setSettings(true)}>
              <LuSettings aria-hidden="true" /> TechPlug details
            </button>
            <button className="btn" onClick={() => setLog(true)}>
              <LuHistory aria-hidden="true" /> Log
            </button>
          </>
        )}
        <button className="btn ghost" onClick={onOut}>
          <LuLogOut aria-hidden="true" /> Sign out
        </button>
      </div>
    </header>
  );

  if (error === 'needs-sql')
    return (
      <>
        {head}
        <div className="card console-msg">
          <b>One more database step is needed.</b>
          <p>
            In Supabase → SQL Editor, paste and run <code>supabase/migrations/0002_console_and_online.sql</code> from the repository.
          </p>
        </div>
      </>
    );

  const list = rows.filter((r) => !q || `${r.name} ${r.slug} ${r.town ?? ''} ${r.owner_email ?? ''}`.toLowerCase().includes(q.toLowerCase()));
  const maxDay = Math.max(1, ...(ov?.perDay ?? []).map((d) => Math.max(d.downloads, d.signups)));

  return (
    <>
      {head}
      {error && <div className="error-text">{error}</div>}
      {!hasPayments && ov && (
        <div className="card console-msg warn-box">
          <LuTriangleAlert aria-hidden="true" /> Run database step 4 (<code>0004_payments_security.sql</code>) to record payments and require two-step login for this console.
        </div>
      )}
      <div className="console-tiles">
        <Tile Icon={LuDownload} label="Windows app downloads" value={gh?.total ?? '…'} sub={gh ? `all time · ${gh.latest}` : 'from GitHub'} />
        <Tile Icon={LuDownload} label="Download clicks" value={ov?.downloads ?? '…'} sub={`on the website · ${days} days`} />
        <Tile Icon={LuEye} label="Website visits" value={ov?.visits ?? '…'} sub={`${days} days`} />
        <Tile Icon={LuMonitorSmartphone} label="App opened first time" value={ov?.firstOpens ?? '…'} sub={`new devices · ${days} days`} />
        <Tile Icon={LuUserPlus} label="Sign-ups" value={ov?.signups ?? '…'} sub={`new restaurants · ${days} days`} />
        <Tile Icon={LuStore} label="Restaurants" value={ov?.restaurants ?? '…'} sub="open accounts" />
        <Tile Icon={LuActivity} label="Active this week" value={ov?.activeWeek ?? '…'} sub="used a till in 7 days" />
        {hasPayments ? (
          <Tile Icon={LuWallet} label="Received this month" value={`$${Number(ov!.paidThisMonth).toFixed(0)}`} sub={`${ov!.paying} paying · ${ov!.overdue ?? 0} overdue`} />
        ) : (
          <Tile Icon={LuWallet} label="Paying · monthly" value={ov ? `${ov.paying} · $${ov.monthlyIncome}` : '…'} sub="restaurants · income per month" />
        )}
      </div>

      {ov && ov.perDay.length > 0 && (
        <div className="card console-chart">
          <b>Per day</b>
          <div className="console-bars">
            {ov.perDay.map((d) => (
              <div key={d.day} className="cb" title={`${d.day}: ${d.downloads} downloads, ${d.signups} sign-ups`}>
                <span className="cb-d" style={{ height: `${(d.downloads / maxDay) * 100}%` }} />
                <span className="cb-s" style={{ height: `${(d.signups / maxDay) * 100}%` }} />
              </div>
            ))}
          </div>
          <div className="console-legend">
            <span>
              <i className="cb-d" /> download clicks
            </span>
            <span>
              <i className="cb-s" /> sign-ups
            </span>
          </div>
        </div>
      )}

      <div className="card console-table">
        <div className="row wrap" style={{ justifyContent: 'space-between' }}>
          <b>Restaurants ({rows.length})</b>
          <input className="console-search" placeholder="Search name, town, email" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>Restaurant</th>
                <th>Owner</th>
                <th>Plan</th>
                <th>Last seen</th>
                <th>Devices</th>
                <th>Sales</th>
                <th>Online</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {list.map((r) => {
                const left = Math.ceil((Date.parse(r.trial_ends_at) - Date.now()) / 86400000);
                const paidLeft = r.paid_until ? Math.ceil((Date.parse(r.paid_until) - Date.now()) / 86400000) : null;
                const branch = !!r.group_id && r.group_id !== r.id;
                return (
                  <tr key={r.id}>
                    <td>
                      <b>{r.name}</b>
                      {branch && <div className="muted small">Branch of {r.group_name}</div>}
                      {r.group_id === r.id && !!r.branches && <div className="muted small">Main · {r.branches} branches in all</div>}
                      <div className="muted small">
                        {r.slug} · {r.town ?? '—'} · joined {new Date(r.created_at).toLocaleDateString()}
                      </div>
                    </td>
                    <td className="small">{r.owner_email ?? '—'}</td>
                    <td>
                      <select value={r.plan} onChange={(e) => void setPlan(r, e.target.value)} aria-label={`Plan for ${r.name}`}>
                        {PLANS.map((p) => (
                          <option key={p} value={p}>
                            {PLAN_LABEL[p]}
                          </option>
                        ))}
                      </select>
                      {r.plan === 'trial' && <div className={`small ${left < 0 ? 'bad' : left <= 7 ? 'warn' : 'muted'}`}>{left < 0 ? `ended ${-left} days ago${left < -3 ? ' · tills paused' : ''}` : `${left} days left`}</div>}
                      {(r.plan === 'restaurant' || r.plan === 'group') && paidLeft !== null && (
                        <div className={`small ${paidLeft < 0 ? 'bad' : paidLeft <= 7 ? 'warn' : 'muted'}`}>
                          {paidLeft < 0 ? `overdue ${-paidLeft} days${paidLeft < -3 ? ' · tills paused' : ''}` : `paid to ${dmy(r.paid_until!)}`}
                        </div>
                      )}
                      {r.plan === 'closed' && <div className="small bad">tills paused</div>}
                    </td>
                    <td className={`small ${ago(r.last_seen_at) === 'online now' ? 'good' : ''}`}>{ago(r.last_seen_at)}</td>
                    <td>{r.devices}</td>
                    <td>{r.orders}</td>
                    <td className="small">{[r.web_page && 'page', r.qr_menu && 'QR', r.online_orders && `orders (${r.online_orders_count})`].filter(Boolean).join(' · ') || '—'}</td>
                    <td>
                      <div className="console-actions">
                        {hasPayments && !branch && (
                          <button className="btn small primary" onClick={() => setPaying(r)}>
                            <LuBanknote aria-hidden="true" /> Payment
                          </button>
                        )}
                        {hasPayments && !branch && r.last_payment && (
                          <button className="btn small" onClick={() => setHistory(r)}>
                            History
                          </button>
                        )}
                        {r.plan === 'trial' && (
                          <button className="btn small" onClick={() => void setPlan(r, 'trial', Math.max(left, 0) + 30)}>
                            +30 days
                          </button>
                        )}
                        {hasPayments && (
                          <button className="btn small ghost danger-text" aria-label={`Delete ${r.name}`} onClick={() => setDeleting(r)}>
                            <LuTrash2 aria-hidden="true" />
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
              {list.length === 0 && (
                <tr>
                  <td colSpan={8} className="muted">
                    {loading && !ov ? 'Loading…' : 'No restaurants yet.'}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
      <p className="muted small">
        Record a payment when the money has arrived (cash, EcoCash, bank). It switches the plan on for the restaurant and all its branches and moves its paid-until date;
        the tills carry on by themselves. Three days after the paid time ends, the tills pause until the next payment.
      </p>
      {paying && <PaymentDialog r={paying} onClose={() => setPaying(null)} onSaved={() => void load()} />}
      {history && <HistoryDialog r={history} onClose={() => setHistory(null)} />}
      {deleting && <DeleteDialog r={deleting} onClose={() => setDeleting(null)} onDone={() => void load()} />}
      {settings && <PlatformDialog onClose={() => setSettings(false)} />}
      {log && <LogDialog rows={rows} onClose={() => setLog(false)} />}
    </>
  );
}

function PaymentDialog({ r, onClose, onSaved }: { r: Row; onClose: () => void; onSaved: () => void }) {
  const [plan, setPlan] = useState(r.plan === 'group' || (r.branches ?? 0) > 1 ? 'group' : 'restaurant');
  const [months, setMonths] = useState(1);
  const [amount, setAmount] = useState(String((plan === 'group' ? 35 : 15) * 1));
  const [method, setMethod] = useState('ecocash');
  const [reference, setReference] = useState('');
  const [note, setNote] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const price = (p: string, m: number) => String((p === 'group' ? 35 : p === 'restaurant' ? 15 : 0) * m);
  const save = async () => {
    setError('');
    const a = Number(amount);
    if (!(a >= 0)) return setError('Type the amount received.');
    setBusy(true);
    try {
      const until = await rpc<string | null>('record_payment', {
        p_restaurant: r.id, p_amount: a, p_method: method, p_plan: plan, p_months: plan === 'free' ? 0 : months, p_reference: reference || null, p_currency: 'USD', p_note: note || null,
      });
      onSaved();
      onClose();
      alertSaved(until);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog
      title={`Payment from ${r.name}`}
      onClose={onClose}
      width={560}
      footer={
        <>
          <button className="btn" onClick={onClose}>
            Cancel
          </button>
          <button className="btn primary" onClick={save} disabled={busy}>
            {busy ? 'Saving…' : 'Record payment'}
          </button>
        </>
      }
    >
      <p className="muted" style={{ marginTop: 0 }}>
        Record it once the money has arrived. {r.paid_until ? `Paid now until ${dmy(r.paid_until)}; this adds to it.` : 'The paid time starts today.'}
      </p>
      <div className="form-grid">
        <label className="field">
          Plan
          <select
            value={plan}
            onChange={(e) => {
              setPlan(e.target.value);
              setAmount(price(e.target.value, months));
            }}
          >
            <option value="restaurant">Restaurant — $15/month</option>
            <option value="group">Group — $35/month (up to 5 branches)</option>
            <option value="free">Free (given, no end date)</option>
          </select>
        </label>
        {plan !== 'free' && (
          <label className="field">
            Months paid
            <select
              value={months}
              onChange={(e) => {
                setMonths(Number(e.target.value));
                setAmount(price(plan, Number(e.target.value)));
              }}
            >
              {[1, 2, 3, 6, 12].map((m) => (
                <option key={m} value={m}>
                  {m} month{m === 1 ? '' : 's'}
                </option>
              ))}
            </select>
          </label>
        )}
        <label className="field">
          Amount received (USD)
          <input inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value.replace(/[^\d.]/g, ''))} />
        </label>
        <label className="field">
          Paid by
          <select value={method} onChange={(e) => setMethod(e.target.value)}>
            {METHODS.map(([k, l]) => (
              <option key={k} value={k}>
                {l}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          Reference (optional)
          <input value={reference} onChange={(e) => setReference(e.target.value)} placeholder="e.g. EcoCash confirmation code" maxLength={80} />
        </label>
        <label className="field">
          Note (optional)
          <input value={note} onChange={(e) => setNote(e.target.value)} maxLength={200} />
        </label>
      </div>
      {error && <div className="error-text">{error}</div>}
    </Dialog>
  );
}

function alertSaved(until: string | null) {
  const el = document.createElement('div');
  el.className = 'toast';
  el.textContent = until ? `Payment recorded — paid until ${dmy(until)}` : 'Payment recorded';
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 3500);
}

function HistoryDialog({ r, onClose }: { r: Row; onClose: () => void }) {
  const [list, setList] = useState<Payment[] | null>(null);
  useEffect(() => {
    select<Payment[]>('payments', `select=*&restaurant_id=eq.${r.group_id || r.id}&order=created_at.desc`)
      .then(setList)
      .catch(() => setList([]));
  }, [r]);
  return (
    <Dialog title={`Payments — ${r.name}`} onClose={onClose} width={620}>
      {!list ? (
        <p className="muted">Loading…</p>
      ) : list.length === 0 ? (
        <p className="muted">No payments yet.</p>
      ) : (
        <div className="table-scroll">
          <table className="console-mini">
            <thead>
              <tr>
                <th>Date</th>
                <th>Amount</th>
                <th>By</th>
                <th>Plan</th>
                <th>Paid until</th>
                <th>Reference</th>
              </tr>
            </thead>
            <tbody>
              {list.map((p) => (
                <tr key={p.id}>
                  <td>{dmy(p.created_at)}</td>
                  <td>${Number(p.amount).toFixed(2)}</td>
                  <td>{METHODS.find(([k]) => k === p.method)?.[1] ?? p.method}</td>
                  <td>
                    {p.plan}
                    {p.months ? ` · ${p.months} mo` : ''}
                  </td>
                  <td>{p.paid_until ? dmy(p.paid_until) : '—'}</td>
                  <td className="small">{[p.reference, p.note].filter(Boolean).join(' · ') || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Dialog>
  );
}

function DeleteDialog({ r, onClose, onDone }: { r: Row; onClose: () => void; onDone: () => void }) {
  const [typed, setTyped] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const go = async () => {
    setBusy(true);
    setError('');
    try {
      await rpc('admin_delete_restaurant', { p_restaurant: r.id, p_confirm_name: typed });
      onDone();
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog
      title={`Delete ${r.name}?`}
      onClose={onClose}
      width={520}
      footer={
        <>
          <button className="btn" onClick={onClose}>
            Keep it
          </button>
          <button className="btn danger" disabled={busy || typed.trim() !== r.name} onClick={go}>
            {busy ? 'Deleting…' : 'Delete for good'}
          </button>
        </>
      }
    >
      <p style={{ marginTop: 0 }}>
        This removes the restaurant's menu, sales, staff, books, online orders and payments from the online account. <b>It cannot be undone.</b> To stop a restaurant
        that has not paid, set its plan to <b>Closed</b> instead.
      </p>
      <label className="field">
        Type the name to confirm: <b>{r.name}</b>
        <input value={typed} onChange={(e) => setTyped(e.target.value)} autoComplete="off" />
      </label>
      {error && <div className="error-text">{error}</div>}
    </Dialog>
  );
}

interface PlatformData { whatsapp?: string; payInstructions?: string; priceRestaurant?: number; priceGroup?: number }
function PlatformDialog({ onClose }: { onClose: () => void }) {
  const [d, setD] = useState<PlatformData | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    select<{ data: PlatformData }[]>('platform_settings', 'select=data&id=eq.1')
      .then((r) => setD(r[0]?.data ?? {}))
      .catch((e) => setError(e instanceof Error ? e.message : String(e)));
  }, []);
  const save = async () => {
    if (!d) return;
    setBusy(true);
    setError('');
    try {
      await rpc('admin_set_platform', { p_data: { ...d, whatsapp: (d.whatsapp ?? '').replace(/\D/g, '') } });
      onClose();
      alertSaved(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog
      title="TechPlug details shown in the app"
      onClose={onClose}
      width={600}
      footer={
        <>
          <button className="btn" onClick={onClose}>
            Cancel
          </button>
          <button className="btn primary" onClick={save} disabled={busy || !d}>
            {busy ? 'Saving…' : 'Save'}
          </button>
        </>
      }
    >
      {!d ? (
        <p className="muted">{error || 'Loading…'}</p>
      ) : (
        <>
          <label className="field">
            TechPlug WhatsApp number (international, e.g. 263771234567)
            <input inputMode="tel" value={d.whatsapp ?? ''} onChange={(e) => setD({ ...d, whatsapp: e.target.value })} />
          </label>
          <label className="field">
            How to pay (shown to owners in Settings → Plan & payments)
            <textarea
              rows={5}
              value={d.payInstructions ?? ''}
              onChange={(e) => setD({ ...d, payInstructions: e.target.value })}
              placeholder={'EcoCash: merchant code 123456 (TechPlug)\nBank: CBZ, account 0123456789, TechPlug (Pvt) Ltd\nCash: TechPlug office, 12 Samora Machel Ave, Harare'}
            />
          </label>
          <div className="form-grid">
            <label className="field">
              Restaurant plan, $ a month
              <input inputMode="decimal" value={d.priceRestaurant ?? 15} onChange={(e) => setD({ ...d, priceRestaurant: Number(e.target.value) || 0 })} />
            </label>
            <label className="field">
              Group plan, $ a month
              <input inputMode="decimal" value={d.priceGroup ?? 35} onChange={(e) => setD({ ...d, priceGroup: Number(e.target.value) || 0 })} />
            </label>
          </div>
          <p className="muted small">Every till picks these up within about 10 minutes — no update needed.</p>
          {error && <div className="error-text">{error}</div>}
        </>
      )}
    </Dialog>
  );
}

function LogDialog({ rows, onClose }: { rows: Row[]; onClose: () => void }) {
  const [list, setList] = useState<LogRow[] | null>(null);
  useEffect(() => {
    select<LogRow[]>('admin_log', 'select=*&order=at.desc&limit=60')
      .then(setList)
      .catch(() => setList([]));
  }, []);
  const name = (id: string | null) => rows.find((r) => r.id === id)?.name ?? (id ? 'deleted restaurant' : '');
  const say = (l: LogRow) => {
    const d = l.detail as Record<string, string | number | null>;
    if (l.action === 'payment') return `Payment $${d.amount} by ${d.method} — ${d.plan}, ${d.months} mo${d.reference ? ` (ref ${d.reference})` : ''}`;
    if (l.action === 'set_plan') return `Plan set to ${d.plan}${d.trial_days ? `, trial ${d.trial_days} days` : ''}`;
    if (l.action === 'delete_restaurant') return `Deleted ${d.name} (${d.slug})`;
    if (l.action === 'platform_settings') return 'TechPlug details changed';
    return l.action;
  };
  return (
    <Dialog title="What admins changed" onClose={onClose} width={640}>
      {!list ? (
        <p className="muted">Loading…</p>
      ) : list.length === 0 ? (
        <p className="muted">Nothing yet.</p>
      ) : (
        <ul className="console-log">
          {list.map((l) => (
            <li key={l.id}>
              <span className="muted small">{new Date(l.at).toLocaleString()}</span>
              <span>
                <b>{name(l.restaurant)}</b> {say(l)}
              </span>
            </li>
          ))}
        </ul>
      )}
    </Dialog>
  );
}

function Tile({ Icon, label, value, sub }: { Icon: typeof LuStore; label: string; value: string | number; sub: string }) {
  return (
    <div className="card console-tile">
      <Icon aria-hidden="true" />
      <span className="lbl">{label}</span>
      <b>{value}</b>
      <span className="muted small">{sub}</span>
    </div>
  );
}
