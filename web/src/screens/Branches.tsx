/**
 * Branches (#/branches, owner): every branch's sales today and this week in one place, and adding a branch.
 * The Group plan ($35 a month) has up to 5 branches; the trial lets an owner try it.
 */
import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { LuBuilding2, LuPlus, LuRefreshCw } from 'react-icons/lu';
import { TopBar, toast } from '../components/ui';
import { SlugField, WEB_PREFIX } from '../components/CloudAccount';
import { createBranch, groupSummary, type BranchSummary } from '../cloud/api';
import { copySetupTo, useSyncStatus } from '../cloud/sync';
import { refreshInfo, useOnline } from '../cloud/online';
import { useCurrentUser, useStore } from '../store/store';
import { fmt } from '../domain/money';
import { go } from '../router';

const MAX = 5;
const sales = (n: number) => `${n} sale${n === 1 ? '' : 's'}`;

export default function BranchesScreen() {
  const sync = useSyncStatus();
  const user = useCurrentUser();
  const info = useOnline().info;
  const currencies = useStore((s) => s.currencies);
  const base = useStore((s) => s.settings.baseCurrency);
  const cur = currencies.find((c) => c.code === base);
  const [rows, setRows] = useState<BranchSummary[] | null>(null);
  const [error, setError] = useState('');
  const [adding, setAdding] = useState(false);

  const load = useCallback(async () => {
    setError('');
    try {
      setRows(await groupSummary());
    } catch (e) {
      const m = e instanceof Error ? e.message : String(e);
      setError(/group_summary|function|schema cache/i.test(m) ? 'One more database step is needed: run supabase/migrations/0003_branches_delivery_trial.sql in Supabase (SQL Editor).' : m);
    }
  }, []);
  useEffect(() => {
    if (sync.link) void load();
  }, [sync.link, load]);

  if (!sync.link)
    return (
      <Page>
        <div className="card branch-empty">
          <LuBuilding2 aria-hidden="true" />
          <h2>Branches need the online account</h2>
          <p className="muted">Connect this till to your online account first. Then you can add branches and see all their sales here.</p>
          <button className="btn primary" onClick={() => go('/settings?tab=online')}>
            Set up the online account
          </button>
        </div>
      </Page>
    );

  const plan = info?.plan;
  const groupPlan = plan === 'group' || plan === 'trial' || plan === 'free';
  const mainId = info?.group_id || sync.link.restaurantId;
  const count = rows?.length ?? 0;
  const online = (r: BranchSummary) => !!r.last_seen_at && Date.now() - Date.parse(r.last_seen_at) < 3 * 60_000;
  const total = (k: 'sales_today' | 'sales_week' | 'orders_today' | 'orders_week') => (rows ?? []).reduce((s, r) => s + Number(r[k]), 0);

  return (
    <Page>
      <div className="branch-head">
        <div>
          <h2>All branches</h2>
          <p className="muted">Sales without training orders. Updated when you open this page or press Refresh.</p>
        </div>
        <div className="row wrap">
          <button className="btn" onClick={() => void load()}>
            <LuRefreshCw aria-hidden="true" /> Refresh
          </button>
          {groupPlan && count < MAX && !adding && user?.role === 'super_admin' && (
            <button className="btn primary" onClick={() => setAdding(true)}>
              <LuPlus aria-hidden="true" /> Add a branch
            </button>
          )}
        </div>
      </div>
      {error && <div className="card error branch-msg">{error}</div>}
      {adding && (
        <AddBranch
          mainId={mainId}
          onDone={(added) => {
            setAdding(false);
            if (added) {
              void load();
              void refreshInfo(true);
            }
          }}
        />
      )}
      {rows && (
        <>
          <div className="branch-totals">
            <div className="card">
              <span className="muted">Today, all branches</span>
              <b>{fmt(total('sales_today'), cur)}</b>
              <span className="muted">{sales(total('orders_today'))}</span>
            </div>
            <div className="card">
              <span className="muted">Last 7 days</span>
              <b>{fmt(total('sales_week'), cur)}</b>
              <span className="muted">{sales(total('orders_week'))}</span>
            </div>
          </div>
          <div className="card branch-table">
            <table>
              <thead>
                <tr>
                  <th scope="col">Branch</th>
                  <th scope="col">Till</th>
                  <th scope="col" className="num">Today</th>
                  <th scope="col" className="num">Last 7 days</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id} className={r.id === sync.link!.restaurantId ? 'here' : ''}>
                    <td>
                      <b>{r.name}</b>
                      {r.is_main && <span className="pill">Main</span>}
                      {r.id === sync.link!.restaurantId && <span className="pill soft">This till</span>}
                      <div className="muted small">
                        {[r.town, `${WEB_PREFIX}${r.slug}`].filter(Boolean).join(' · ')}
                      </div>
                    </td>
                    <td>
                      <span className={`dot ${online(r) ? 'on' : ''}`} aria-hidden="true" /> {online(r) ? 'Online' : r.last_seen_at ? `Last seen ${new Date(r.last_seen_at).toLocaleString()}` : 'No till yet'}
                    </td>
                    <td className="num">
                      <b>{fmt(Number(r.sales_today), cur)}</b>
                      <div className="muted small">{sales(Number(r.orders_today))}</div>
                    </td>
                    <td className="num">
                      <b>{fmt(Number(r.sales_week), cur)}</b>
                      <div className="muted small">{sales(Number(r.orders_week))}</div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="hint">
            {groupPlan
              ? `${count} of ${MAX} branches. To set up a branch's till: open TechPlug POS there, choose “Connect to my restaurant”, sign in with this email and pick the branch.`
              : 'Branches come with the Group plan: $35 a month for up to 5 branches, each with its own tills, menu, staff and web page. Ask TechPlug to switch your plan.'}
          </p>
        </>
      )}
    </Page>
  );
}

function Page({ children }: { children: ReactNode }) {
  return (
    <div className="app">
      <TopBar title="Branches" />
      <div className="page">
        <div className="page-narrow branch-page">{children}</div>
      </div>
    </div>
  );
}

function AddBranch({ mainId, onDone }: { mainId: string; onDone: (added: boolean) => void }) {
  const user = useCurrentUser();
  const [name, setName] = useState('');
  const [town, setTown] = useState('');
  const [slug, setSlug] = useState('');
  const [ok, setOk] = useState<boolean | null>(null);
  const [copy, setCopy] = useState(true);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const save = async () => {
    setError('');
    if (name.trim().length < 2) return setError('Type the branch name.');
    if (slug.length < 3 || ok === false) return setError('Choose a free web address.');
    try {
      setBusy('Adding the branch…');
      const rid = await createBranch(mainId, name, slug, town);
      if (copy) {
        setBusy('Copying the menu…');
        await copySetupTo(rid, name.trim(), user?.id ?? null);
      }
      toast(`${name.trim()} added`);
      onDone(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy('');
    }
  };
  return (
    <div className="card branch-add">
      <h3>New branch</h3>
      <div className="form-grid">
        <label className="field">
          Branch name
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Mama Rudo — Avondale" autoFocus />
        </label>
        <label className="field">
          Town or area
          <input value={town} onChange={(e) => setTown(e.target.value)} />
        </label>
      </div>
      <SlugField name={name} slug={slug} setSlug={setSlug} ok={ok} setOk={setOk} />
      <div className="toggle">
        <span>
          Start with this branch's menu
          <span className="sub">Meals, prices, add-ons, payment methods and stock items, and you as the owner with the same PIN. No sales or customers.</span>
        </span>
        <button className={`switch ${copy ? 'on' : ''}`} role="switch" aria-checked={copy} aria-label="Start with this branch's menu" onClick={() => setCopy(!copy)}>
          <span />
        </button>
      </div>
      {error && <div className="error">{error}</div>}
      <div className="row wrap">
        <span className="grow" />
        <button className="btn" onClick={() => onDone(false)} disabled={!!busy}>
          Cancel
        </button>
        <button className="btn primary" onClick={save} disabled={!!busy}>
          {busy || 'Add branch'}
        </button>
      </div>
    </div>
  );
}
