/**
 * TechPlug owner console (#/console): downloads, website visits, sign-ups, restaurants and their trials.
 * Only for TechPlug admins (platform_admins in the online account).
 */
import { useCallback, useEffect, useState } from 'react';
import { LuDownload, LuEye, LuMonitorSmartphone, LuStore, LuUserPlus, LuActivity, LuWallet, LuRefreshCw, LuLogOut } from 'react-icons/lu';
import { getSession, rpc, signIn, signOut } from '../cloud/api';
import { getLink } from '../cloud/sync';

interface Overview {
  visits: number; downloads: number; firstOpens: number; signups: number; restaurants: number; activeWeek: number; paying: number; monthlyIncome: number;
  perDay: { day: string; downloads: number; signups: number }[]; countries: Record<string, number>;
}
interface Row {
  id: string; name: string; slug: string; town: string | null; plan: string; trial_ends_at: string; created_at: string; last_seen_at: string | null;
  owner_email: string | null; devices: number; orders: number; web_page: boolean; qr_menu: boolean; online_orders: boolean; online_orders_count: number;
  group_id?: string | null; group_name?: string | null; branches?: number;
}
interface Release { tag_name: string; published_at: string; assets: { name: string; download_count: number }[] }

const PLANS = ['trial', 'restaurant', 'group', 'free', 'closed'];
const PLAN_LABEL: Record<string, string> = { trial: 'Free trial', restaurant: 'Restaurant $15', group: 'Group $35', free: 'Free (given)', closed: 'Closed' };

export default function Console() {
  const [signedIn, setSignedIn] = useState(!!getSession());
  useEffect(() => {
    document.title = 'TechPlug console';
  }, []);
  return <div className="console">{signedIn ? <Dashboard onOut={() => setSignedIn(false)} /> : <ConsoleSignIn onIn={() => setSignedIn(true)} />}</div>;
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
      <p className="muted">Sign in with your TechPlug admin email.</p>
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
  const [gh, setGh] = useState<{ total: number; latest: string; perRelease: { tag: string; n: number }[] } | null>(null);
  const [error, setError] = useState('');
  const [q, setQ] = useState('');
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const [o, r] = await Promise.all([rpc<Overview>('console_overview', { p_days: days }), rpc<Row[]>('console_restaurants', {})]);
      setOv(o);
      setRows(r);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setError(/not allowed/i.test(msg) ? 'not-admin' : /console_restaurants|function/i.test(msg) ? 'needs-sql' : msg);
    } finally {
      setLoading(false);
    }
    // Windows installer downloads, from the GitHub release (public numbers)
    fetch('https://api.github.com/repos/Matongos/restaurant-pos/releases')
      .then((r) => (r.ok ? r.json() : []))
      .then((rel: Release[]) => {
        const perRelease = rel.map((x) => ({ tag: x.tag_name, n: x.assets.filter((a) => a.name.endsWith('.exe')).reduce((s, a) => s + a.download_count, 0) }));
        setGh({ total: perRelease.reduce((s, x) => s + x.n, 0), latest: rel[0]?.tag_name ?? '', perRelease });
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
  const head = (
    <header className="console-head">
      <div>
        <h1>TechPlug console</h1>
        <span className="muted">Signed in as {email}</span>
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
        {!getLink() && (
          <button
            className="btn ghost"
            onClick={async () => {
              await signOut();
              onOut();
            }}
          >
            <LuLogOut aria-hidden="true" /> Sign out
          </button>
        )}
      </div>
    </header>
  );

  if (error === 'not-admin')
    return (
      <>
        {head}
        <div className="card console-msg">
          <b>This email is not a TechPlug admin yet.</b>
          <p>In Supabase → SQL Editor, run (with your email):</p>
          <code>insert into platform_admins (user_id) select id from auth.users where email = '{email}';</code>
        </div>
      </>
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
      <div className="console-tiles">
        <Tile Icon={LuDownload} label="Windows app downloads" value={gh?.total ?? '…'} sub={gh ? `all time · ${gh.latest}` : 'from GitHub'} />
        <Tile Icon={LuDownload} label="Download clicks" value={ov?.downloads ?? '…'} sub={`on the website · ${days} days`} />
        <Tile Icon={LuEye} label="Website visits" value={ov?.visits ?? '…'} sub={`${days} days`} />
        <Tile Icon={LuMonitorSmartphone} label="App opened first time" value={ov?.firstOpens ?? '…'} sub={`new devices · ${days} days`} />
        <Tile Icon={LuUserPlus} label="Sign-ups" value={ov?.signups ?? '…'} sub={`new restaurants · ${days} days`} />
        <Tile Icon={LuStore} label="Restaurants" value={ov?.restaurants ?? '…'} sub="open accounts" />
        <Tile Icon={LuActivity} label="Active this week" value={ov?.activeWeek ?? '…'} sub="used a till in 7 days" />
        <Tile Icon={LuWallet} label="Paying · monthly" value={ov ? `${ov.paying} · $${ov.monthlyIncome}` : '…'} sub="restaurants · income per month" />
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
            <span><i className="cb-d" /> download clicks</span>
            <span><i className="cb-s" /> sign-ups</span>
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
                return (
                  <tr key={r.id}>
                    <td>
                      <b>{r.name}</b>
                      {r.group_id && r.group_id !== r.id && <div className="muted small">Branch of {r.group_name}</div>}
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
                      {r.plan === 'closed' && <div className="small bad">tills paused</div>}
                    </td>
                    <td className={`small ${ago(r.last_seen_at) === 'online now' ? 'good' : ''}`}>{ago(r.last_seen_at)}</td>
                    <td>{r.devices}</td>
                    <td>{r.orders}</td>
                    <td className="small">
                      {[r.web_page && 'page', r.qr_menu && 'QR', r.online_orders && `orders (${r.online_orders_count})`].filter(Boolean).join(' · ') || '—'}
                    </td>
                    <td>
                      <button className="btn small" onClick={() => void setPlan(r, 'trial', Math.max(left, 0) + 30)}>
                        +30 days
                      </button>
                    </td>
                  </tr>
                );
              })}
              {list.length === 0 && (
                <tr>
                  <td colSpan={8} className="muted">
                    No restaurants yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
      <p className="muted small">
        Website visits and download clicks are counted from the product website; "first opened" counts each new device that opens the app. Support: restaurants
        contact you by phone or WhatsApp — their owner email is listed above.
      </p>
    </>
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
