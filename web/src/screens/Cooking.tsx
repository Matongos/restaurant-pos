import { useMemo, useState } from 'react';
import { LuChefHat, LuPlus, LuUndo2, LuTriangleAlert, LuCircleCheck } from 'react-icons/lu';
import { getState, recordClosing, recordCooking, undoCooking, upsertStockItem, useCurrentUser, useStockLevels, useStore } from '../store/store';
import { can, todayISO, uid } from '../domain/rules';
import { countUnit, fmtQty } from '../domain/stock';
import { cookEntries, readyItems, UNUSUAL, yieldDiff, yieldOf, yieldText } from '../domain/kitchen';
import type { StockItem } from '../domain/types';
import { Dialog, TopBar, toast } from '../components/ui';

type Tab = 'cook' | 'ready' | 'closing';

// "66 portions", "2 kg" (short units such as kg, g, l, ml stay as they are).
const plural = (n: number, unit: string) => `${n.toLocaleString('en-US', { maximumFractionDigits: 2 })} ${unit}${Math.abs(n) === 1 || /s$/.test(unit) || /^(kg|g|l|ml|lb|oz)$/i.test(unit) ? '' : 's'}`;
const time = (iso: string) => new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

/**
 * Stock → Today's cooking. The kitchen enters what it prepared (6 chickens → 66 portions); the owner names
 * the ready portions and what each is made from; at closing, what is left is counted. Nothing is fixed:
 * the system learns the usual yield from the real entries.
 */
export default function CookingScreen() {
  const asked = new URLSearchParams(location.hash.split('?')[1] ?? '').get('tab') as Tab | null;
  const [tab, setTab] = useState<Tab>(asked ?? 'cook');
  const user = useCurrentUser()!;
  const canSetup = can(user.role, 'menu_edit');
  const items = useStore((s) => s.stockItems);
  const ready = items.filter((i) => i.madeFrom);
  return (
    <div className="app">
      <TopBar title="Today's cooking" />
      <div className="page">
        <div className="page-narrow" style={{ maxWidth: 980 }}>
          <div className="tabs">
            <button className={tab === 'cook' ? 'on' : ''} onClick={() => setTab('cook')}>
              Today's cooking
            </button>
            <button className={tab === 'ready' ? 'on' : ''} onClick={() => setTab('ready')}>
              Ready portions ({ready.length})
            </button>
            <button className={tab === 'closing' ? 'on' : ''} onClick={() => setTab('closing')}>
              Closing count
            </button>
          </div>
          {ready.length === 0 && tab !== 'ready' ? (
            <div className="card empty" style={{ padding: 24 }}>
              <LuChefHat aria-hidden="true" style={{ width: 36, height: 36, color: 'var(--brand)' }} />
              <p>
                <b>No ready portions yet.</b> First say what the kitchen makes, e.g. <i>Chicken portion</i> made from <i>Chicken</i>, <i>Beef piece</i> made from <i>Beef</i>.
              </p>
              {canSetup ? (
                <button className="btn primary" onClick={() => setTab('ready')}>
                  Set up ready portions
                </button>
              ) : (
                <p className="muted">Ask the owner or manager to set them up.</p>
              )}
            </div>
          ) : tab === 'cook' ? (
            <TodaysCooking />
          ) : tab === 'ready' ? (
            <ReadyPortions canSetup={canSetup} />
          ) : (
            <Closing />
          )}
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ today's cooking */

function TodaysCooking() {
  const user = useCurrentUser()!;
  const st = useStore((s) => s);
  const levels = useStockLevels();
  const ready = readyItems(st);
  const [readyId, setReadyId] = useState(ready[0]?.id ?? '');
  const [used, setUsed] = useState('');
  const [made, setMade] = useState('');
  const [each, setEach] = useState('');
  const [error, setError] = useState('');
  const item = ready.find((i) => i.id === readyId) ?? ready[0];
  const raw = item ? st.stockItems.find((i) => i.id === item.madeFrom) : undefined;
  const rawLevel = raw ? levels.get(raw.id) : undefined;
  const usual = item ? yieldOf(st, item, { excludeToday: true }) : null;
  const usedN = Number(used) || 0;
  const madeN = (Number(made) || 0) * (each ? Number(each) || 0 : 1);
  const counts = item?.countMade !== false;
  const perRaw = usedN > 0 && madeN > 0 ? Math.round((madeN / usedN) * 100) / 100 : null;
  const diff = perRaw !== null ? yieldDiff(perRaw, usual?.perRaw ?? null) : null;
  const suggestion = usual?.perRaw && usedN > 0 ? Math.round(usual.perRaw * usedN) : null;
  const today = todayISO();
  const entries = cookEntries(st)
    .filter((m) => todayISO(new Date(m.at)) === today)
    .sort((a, b) => a.at.localeCompare(b.at));
  const staffName = (id: string) => st.staff.find((u) => u.id === id)?.name ?? '';
  const save = () => {
    if (!item) return;
    const r = recordCooking({ readyId: item.id, rawQty: usedN, made: counts ? madeN : undefined }, user.id);
    if (!r.ok) return setError(r.error);
    setError('');
    toast(counts ? `Saved: ${plural(usedN, countUnit(raw!))} → ${plural(madeN, countUnit(item))}` : `Saved: ${plural(usedN, countUnit(raw!))} used`);
    setUsed('');
    setMade('');
    setEach('');
  };
  // Raw stock that is still there, and roughly what it would give.
  const rawLeft = useMemo(() => {
    const out: { raw: StockItem; left: number; gives: string[] }[] = [];
    for (const r of st.stockItems.filter((i) => ready.some((x) => x.madeFrom === i.id))) {
      const lv = levels.get(r.id);
      if (!lv || lv.status === 'untracked' || lv.status === 'uncounted' || lv.onHand <= 0.0005) continue;
      const gives = ready
        .filter((x) => x.madeFrom === r.id && x.countMade !== false)
        .map((x) => ({ x, y: yieldOf(st, x).perRaw }))
        .filter((g) => g.y)
        .map((g) => `≈ ${Math.floor(lv.onHand * g.y!)} ${countUnit(g.x)}${Math.floor(lv.onHand * g.y!) === 1 ? '' : 's'}`);
      out.push({ raw: r, left: lv.onHand, gives });
    }
    return out;
  }, [st, levels, ready]);

  return (
    <>
      <NowCard />
      <div className="card cook-form">
        <h3>Add what was prepared</h3>
        <div className="cook-grid">
          <label className="field">
            Made
            <select value={item?.id ?? ''} onChange={(e) => setReadyId(e.target.value)}>
              {ready.map((i) => (
                <option key={i.id} value={i.id}>
                  {i.name}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            {raw ? `${raw.name} used (${countUnit(raw)})` : 'Used'}
            <input inputMode="decimal" value={used} onChange={(e) => setUsed(e.target.value.replace(/[^\d.]/g, ''))} placeholder="e.g. 6" />
            {rawLevel && rawLevel.status !== 'untracked' && rawLevel.status !== 'uncounted' && (
              <small className="muted">{fmtQty(Math.max(0, rawLevel.onHand), countUnit(raw!))} in stock</small>
            )}
          </label>
          {counts ? (
            <>
              <label className="field">
                How many {countUnit(item!)}s made
                <input inputMode="decimal" value={made} onChange={(e) => setMade(e.target.value.replace(/[^\d.]/g, ''))} placeholder={suggestion ? `usually about ${suggestion}` : 'e.g. 66'} />
              </label>
              <label className="field">
                × each (optional)
                <input inputMode="decimal" value={each} onChange={(e) => setEach(e.target.value.replace(/[^\d.]/g, ''))} placeholder="e.g. 2" />
                <small className="muted">15 plates × 2 pieces = 30</small>
              </label>
            </>
          ) : (
            <div className="muted" style={{ alignSelf: 'center', fontSize: 13 }}>
              Plates are not counted for {item?.name}: the system counts them from the sales.
            </div>
          )}
        </div>
        <div className="cook-calc">
          {counts && perRaw !== null && (
            <>
              <span>
                = <b>{madeN.toLocaleString('en-US', { maximumFractionDigits: 2 })}</b> {countUnit(item!)}s · {yieldText(item!, raw, perRaw)}
                {usual?.perRaw ? ` · usual ${usual.perRaw.toLocaleString('en-US', { maximumFractionDigits: 1 })}` : ''}
              </span>
              {diff === null ? (
                <span className="tag2 n">first time — the system will learn</span>
              ) : Math.abs(diff) <= UNUSUAL ? (
                <span className="tag2 g">normal</span>
              ) : (
                <span className={`tag2 ${diff < 0 ? 'r' : 'y'}`}>
                  {Math.round(Math.abs(diff) * 100)}% {diff < 0 ? 'fewer' : 'more'} than usual
                </span>
              )}
            </>
          )}
          <span className="sp" />
          {error && <span className="error-text">{error}</span>}
          <button className="btn primary" onClick={save} disabled={!item || !(usedN > 0) || (counts && !(madeN > 0))}>
            Save
          </button>
        </div>
        {counts && diff !== null && diff < -UNUSUAL && (
          <div className="warn-box" style={{ marginTop: 10 }}>
            <LuTriangleAlert aria-hidden="true" /> Fewer {countUnit(item!)}s than usual from the same {raw ? countUnit(raw) : 'amount'}: portions cut bigger, or something missing? You can still save it.
          </div>
        )}
      </div>

      <CutLeftovers />

      {rawLeft.length > 0 && (
        <div className="card cook-raw">
          <b>Raw stock still there</b>
          {rawLeft.map((r) => (
            <div key={r.raw.id}>
              {r.raw.name}: <b>{fmtQty(r.left, countUnit(r.raw))}</b>
              {r.gives.length > 0 && <span className="muted"> · {r.gives.join(' or ')}</span>}
            </div>
          ))}
        </div>
      )}

      <div className="section-title">Today so far</div>
      {entries.length === 0 ? (
        <div className="card empty">Nothing entered today yet.</div>
      ) : (
        <div style={{ overflowX: 'auto' }}>
          <table className="list">
            <thead>
              <tr>
                <th>Time</th>
                <th>Used</th>
                <th>Made</th>
                <th>Per unit</th>
                <th>By</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {entries.map((m) => {
                const it = st.stockItems.find((i) => i.id === m.stockItemId);
                const rw = st.stockItems.find((i) => i.id === m.rawId);
                const isCut = !!rw?.madeFrom;
                const pr = !isCut && m.qty > 0 && m.rawQty ? Math.round((m.qty / m.rawQty) * 100) / 100 : null;
                const u = it ? yieldOf(st, it, { excludeToday: true }).perRaw : null;
                const d = pr !== null ? yieldDiff(pr, u) : null;
                return (
                  <tr key={m.id}>
                    <td>{time(m.at)}</td>
                    <td>{rw ? plural(m.rawQty ?? 0, countUnit(rw)) + ' ' + rw.name : ''}</td>
                    <td>
                      <b>{it && it.countMade !== false ? `${plural(m.qty, countUnit(it))}` : <span className="muted">counted from sales</span>}</b>
                      {it && it.countMade !== false && <span className="muted"> {it.name}</span>}
                    </td>
                    <td>
                      {isCut ? <span className="tag2 b">cut up</span> : pr !== null ? pr.toLocaleString('en-US', { maximumFractionDigits: 1 }) : '—'}{' '}
                      {d !== null && (Math.abs(d) <= UNUSUAL ? <span className="tag2 g">normal</span> : <span className={`tag2 ${d < 0 ? 'r' : 'y'}`}>{Math.round(Math.abs(d) * 100)}% {d < 0 ? 'below' : 'above'}</span>)}
                    </td>
                    <td>{staffName(m.by)}</td>
                    <td>
                      <button
                        className="btn small ghost"
                        onClick={() => {
                          const r = undoCooking(m.id, user.id);
                          toast(r.ok ? 'Entry undone' : r.error);
                        }}
                      >
                        <LuUndo2 aria-hidden="true" /> Undo
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      <p className="muted small" style={{ marginTop: 12 }}>
        Raw stock goes down and ready portions go up. Sales take ready portions off by themselves. If you cook more later, add another entry. A wrong entry is
        undone, not deleted, so the record stays honest.
      </p>
    </>
  );
}

/** At a glance: what was bought, made, sold, cut up and what is left right now. */
function NowCard() {
  const st = useStore((s) => s);
  const levels = useStockLevels();
  const today = todayISO();
  const ready = readyItems(st).filter((i) => i.countMade !== false);
  const raws = st.stockItems.filter((i) => ready.some((r) => r.madeFrom === i.id));
  const isToday = (iso: string) => todayISO(new Date(iso)) === today;
  const entries = cookEntries(st).filter((m) => isToday(m.at));
  const made = (id: string) => entries.filter((m) => m.stockItemId === id).reduce((t, m) => t + m.qty, 0);
  const used = (id: string) => entries.filter((m) => m.rawId === id).reduce((t, m) => t + (m.rawQty ?? 0), 0);
  const sold = (id: string) => st.orders.filter((o) => !o.example && o.status !== 'cancelled' && isToday(o.createdAt)).reduce((t, o) => t + (o.stockUsed?.[id] ?? 0), 0);
  const bought = (id: string) => st.purchases.filter((p) => !p.example && isToday(p.at)).reduce((t, p) => t + p.lines.filter((l) => l.stockItemId === id).reduce((u, l) => u + (l.stockQty ?? l.qty), 0), 0);
  const left = (id: string) => {
    const l = levels.get(id);
    return l && l.status !== 'uncounted' && l.status !== 'untracked' ? Math.max(0, l.onHand) : 0;
  };
  const n = (v: number) => v.toLocaleString('en-US', { maximumFractionDigits: 2 });
  if (!ready.length) return null;
  return (
    <div className="card now-card">
      <b>Right now</b>
      <div style={{ overflowX: 'auto' }}>
        <table className="list">
          <thead>
            <tr>
              <th>Item</th>
              <th className="num">Bought / made today</th>
              <th className="num">Sold today</th>
              <th className="num">Used / cut up</th>
              <th className="num">Left now</th>
            </tr>
          </thead>
          <tbody>
            {raws.map((r) => (
              <tr key={r.id} className="raw-row">
                <td>
                  {r.name} <span className="muted small">raw</span>
                </td>
                <td className="num">{n(bought(r.id))}</td>
                <td className="num muted">—</td>
                <td className="num">{n(used(r.id))}</td>
                <td className="num">
                  <b>{plural(Math.round(left(r.id) * 100) / 100, countUnit(r))}</b>
                </td>
              </tr>
            ))}
            {ready.map((i) => (
              <tr key={i.id}>
                <td>
                  <b>{i.name}</b>
                </td>
                <td className="num">{n(made(i.id))}</td>
                <td className="num">{n(sold(i.id))}</td>
                <td className="num">{used(i.id) ? n(used(i.id)) : <span className="muted">—</span>}</td>
                <td className="num">
                  <b className={left(i.id) <= (i.lowAt ?? 0) ? 'warn-t' : ''}>{plural(Math.round(left(i.id) * 100) / 100, countUnit(i))}</b>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/** Leftover portions of one kind cut into another: 2 Quarter chickens → 4 Chicken portions. */
function CutLeftovers() {
  const user = useCurrentUser()!;
  const st = useStore((s) => s);
  const levels = useStockLevels();
  const ready = readyItems(st).filter((i) => i.countMade !== false);
  const [open, setOpen] = useState(false);
  const [fromId, setFromId] = useState(ready[1]?.id ?? ready[0]?.id ?? '');
  const [toId, setToId] = useState(ready[0]?.id ?? '');
  const [qty, setQty] = useState('');
  const [made, setMade] = useState('');
  if (ready.length < 2) return null;
  const from = ready.find((i) => i.id === fromId);
  const to = ready.find((i) => i.id === toId);
  const leftFrom = from ? Math.max(0, levels.get(from.id)?.onHand ?? 0) : 0;
  const save = () => {
    if (!to || !from) return;
    const r = recordCooking({ readyId: to.id, fromId: from.id, rawQty: Number(qty) || 0, made: Number(made) || 0 }, user.id);
    if (!r.ok) return toast(r.error);
    toast(`Saved: ${plural(Number(qty), countUnit(from))} cut into ${plural(Number(made), countUnit(to))}`);
    setQty('');
    setMade('');
    setOpen(false);
  };
  if (!open)
    return (
      <button className="btn" style={{ marginBottom: 12 }} onClick={() => setOpen(true)}>
        Cut leftover portions into another kind (e.g. quarters into pieces)
      </button>
    );
  return (
    <div className="card cook-form">
      <h3>Cut leftovers into another kind</h3>
      <div className="cook-grid">
        <label className="field">
          Cut up
          <select value={fromId} onChange={(e) => setFromId(e.target.value)}>
            {ready.map((i) => (
              <option key={i.id} value={i.id}>
                {i.name}
              </option>
            ))}
          </select>
          <small className="muted">{plural(Math.round(leftFrom * 100) / 100, from ? countUnit(from) : '')} left</small>
        </label>
        <label className="field">
          How many
          <input inputMode="decimal" value={qty} onChange={(e) => setQty(e.target.value.replace(/[^\d.]/g, ''))} placeholder="e.g. 2" />
        </label>
        <label className="field">
          Into
          <select value={toId} onChange={(e) => setToId(e.target.value)}>
            {ready
              .filter((i) => i.id !== fromId)
              .map((i) => (
                <option key={i.id} value={i.id}>
                  {i.name}
                </option>
              ))}
          </select>
        </label>
        <label className="field">
          How many made
          <input inputMode="decimal" value={made} onChange={(e) => setMade(e.target.value.replace(/[^\d.]/g, ''))} placeholder="e.g. 4" />
        </label>
      </div>
      <div className="cook-calc">
        <span className="sp" />
        <button className="btn" onClick={() => setOpen(false)}>
          Cancel
        </button>
        <button className="btn primary" onClick={save} disabled={!(Number(qty) > 0) || !(Number(made) > 0) || !to || to.id === fromId}>
          Save
        </button>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ ready portions (owner) */

function ReadyPortions({ canSetup }: { canSetup: boolean }) {
  const st = useStore((s) => s);
  const levels = useStockLevels();
  const [open, setOpen] = useState<StockItem | null>(null);
  const ready = readyItems(st);
  return (
    <>
      <div className="row wrap" style={{ marginBottom: 10 }}>
        <span className="muted">What your kitchen makes from what you buy. Meals use these: Menu → open a meal → Stock used per plate.</span>
        <span style={{ flex: 1 }} />
        {canSetup && (
          <button className="btn primary" onClick={() => setOpen({ id: uid('st-'), name: '', unit: 'portion', countUnit: 'portion', track: true, madeFrom: '', leftovers: 'keep', hideWhenOut: true })}>
            <LuPlus aria-hidden="true" /> Add a ready portion
          </button>
        )}
      </div>
      {ready.length === 0 ? (
        <div className="card empty">None yet. Example: "Chicken portion" made from "Chicken", "Quarter chicken" made from "Chicken", "Beef piece" made from "Beef".</div>
      ) : (
        <div style={{ overflowX: 'auto' }}>
          <table className="list">
            <thead>
              <tr>
                <th>Ready portion</th>
                <th>Made from</th>
                <th>Usual yield (learnt)</th>
                <th>Leftovers at closing</th>
                <th className="num">Ready now</th>
              </tr>
            </thead>
            <tbody>
              {ready.map((i) => {
                const raw = st.stockItems.find((x) => x.id === i.madeFrom);
                const y = yieldOf(st, i);
                const lv = levels.get(i.id);
                return (
                  <tr key={i.id} onClick={() => canSetup && setOpen(i)} style={{ cursor: canSetup ? 'pointer' : 'default' }}>
                    <td>
                      <b>{i.name}</b>
                      <div className="muted small">one = 1 {countUnit(i)}</div>
                    </td>
                    <td>{raw?.name ?? '—'}</td>
                    <td>
                      {yieldText(i, raw, y.perRaw)}
                      {y.entries > 0 && <div className="muted small">from {y.entries} entr{y.entries === 1 ? 'y' : 'ies'}, last 4 weeks{i.countMade === false ? ' · plates counted from sales' : ''}</div>}
                    </td>
                    <td>{i.leftovers === 'waste' ? <span className="tag2 y">Throw away</span> : <span className="tag2 g">Keep for tomorrow</span>}</td>
                    <td className="num">
                      <b>{i.countMade === false ? '—' : lv && lv.status !== 'uncounted' && lv.status !== 'untracked' ? Math.max(0, lv.onHand).toLocaleString('en-US', { maximumFractionDigits: 2 }) : 0}</b>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {open && <ReadyDialog item={open} onClose={() => setOpen(null)} />}
    </>
  );
}

function ReadyDialog({ item, onClose }: { item: StockItem; onClose: () => void }) {
  const items = useStore((s) => s.stockItems);
  const raws = items.filter((i) => !i.madeFrom && i.id !== item.id);
  const [it, setIt] = useState<StockItem>(item);
  const [rawName, setRawName] = useState(items.find((i) => i.id === item.madeFrom)?.name ?? '');
  const [rawUnit, setRawUnit] = useState('');
  const [error, setError] = useState('');
  const existing = raws.find((r) => r.name.toLowerCase() === rawName.trim().toLowerCase());
  const save = () => {
    if (!it.name.trim()) return setError('Give it a name, e.g. Chicken portion.');
    if (!rawName.trim()) return setError('Say what it is made from, e.g. Chicken.');
    let rawId = existing?.id;
    if (!rawId) {
      // A raw item not in the list yet: add it (bought and counted in the unit given).
      const unit = rawUnit.trim() || 'unit';
      const nr: StockItem = { id: uid('st-'), name: rawName.trim(), unit, countUnit: unit, perPack: 1, track: true };
      const r = upsertStockItem(nr);
      if (!r.ok) return setError(r.error);
      rawId = nr.id;
    } else if (!getState().stockItems.find((x) => x.id === rawId)?.track) {
      upsertStockItem({ ...existing!, track: true });
    }
    const one = (it.countUnit ?? '').trim() || 'portion';
    const r = upsertStockItem({ ...it, madeFrom: rawId, unit: one, countUnit: one, perPack: 1, track: true });
    if (!r.ok) return setError(r.error);
    toast(`${it.name.trim()} saved`);
    onClose();
  };
  return (
    <Dialog
      title="Ready portion"
      onClose={onClose}
      width={560}
      footer={
        <>
          {error && <span className="error-text" style={{ marginRight: 'auto' }}>{error}</span>}
          <button className="btn" onClick={onClose}>
            Cancel
          </button>
          <button className="btn primary" onClick={save}>
            Save
          </button>
        </>
      }
    >
      <div className="form-grid">
        <label className="field">
          Name
          <input value={it.name} onChange={(e) => setIt({ ...it, name: e.target.value })} placeholder="e.g. Chicken portion, Quarter chicken, Beef piece" autoFocus />
        </label>
        <label className="field">
          Made from (raw stock)
          <input list="raw-list" value={rawName} onChange={(e) => setRawName(e.target.value)} placeholder="e.g. Chicken, Beef, Rice" />
          <datalist id="raw-list">
            {raws.map((r) => (
              <option key={r.id} value={r.name} />
            ))}
          </datalist>
          {existing ? <small className="muted">counted in {countUnit(existing)}</small> : rawName.trim() ? <small className="muted">new raw item — say how it is counted below</small> : null}
        </label>
        {!existing && rawName.trim() && (
          <label className="field">
            {rawName.trim()} is counted in
            <input value={rawUnit} onChange={(e) => setRawUnit(e.target.value)} placeholder="e.g. chicken, kg, bag" />
          </label>
        )}
        <label className="field">
          One of them is called a
          <input value={it.countUnit ?? ''} onChange={(e) => setIt({ ...it, countUnit: e.target.value })} placeholder="portion, piece, quarter, plate" />
        </label>
        <label className="field">
          Warn when down to
          <input type="number" min={0} inputMode="decimal" value={it.lowAt ?? ''} onChange={(e) => setIt({ ...it, lowAt: e.target.value === '' ? undefined : Number(e.target.value) })} placeholder="e.g. 5" />
        </label>
      </div>
      <div className="section-title">Leftovers at closing</div>
      <div className="seg">
        <button className={it.leftovers !== 'waste' ? 'on' : ''} onClick={() => setIt({ ...it, leftovers: 'keep' })}>
          Keep for tomorrow
        </button>
        <button className={it.leftovers === 'waste' ? 'on' : ''} onClick={() => setIt({ ...it, leftovers: 'waste' })}>
          Throw away (counts as waste)
        </button>
      </div>
      <div className="switch-rows" style={{ marginTop: 14 }}>
        <div className="switch-row">
          <div className="grow">
            <b>The kitchen counts how many were made</b>
            <div className="muted">Off for rice or sadza: they only enter the bags used, and the system counts the plates from the sales.</div>
          </div>
          <button className={`switch ${it.countMade !== false ? 'on' : ''}`} onClick={() => setIt({ ...it, countMade: it.countMade === false })} aria-pressed={it.countMade !== false} aria-label="Kitchen counts how many were made">
            <span />
          </button>
        </div>
        <div className="switch-row">
          <div className="grow">
            <b>When none are left, hide the meals that need it</b>
            <div className="muted">Only after today's cooking has been entered — a forgotten entry never hides meals.</div>
          </div>
          <button className={`switch ${it.hideWhenOut ? 'on' : ''}`} onClick={() => setIt({ ...it, hideWhenOut: !it.hideWhenOut })} aria-pressed={!!it.hideWhenOut} aria-label="Hide meals when none are left">
            <span />
          </button>
        </div>
      </div>
    </Dialog>
  );
}

/* ------------------------------------------------------------------ closing count */

function Closing() {
  const user = useCurrentUser()!;
  const st = useStore((s) => s);
  const levels = useStockLevels();
  const [counts, setCounts] = useState<Record<string, string>>({});
  const today = todayISO();
  const ready = readyItems(st).filter((i) => i.countMade !== false);
  const raws = st.stockItems.filter((i) => ready.some((r) => r.madeFrom === i.id));
  const madeToday = (id: string) => cookEntries(st).filter((m) => m.stockItemId === id && todayISO(new Date(m.at)) === today).reduce((t, m) => t + m.qty, 0);
  const soldToday = (id: string) =>
    st.orders.filter((o) => !o.example && o.status !== 'cancelled' && todayISO(new Date(o.createdAt)) === today).reduce((t, o) => t + (o.stockUsed?.[id] ?? 0), 0);
  const rows = [...ready, ...raws];
  const save = () => {
    const list = rows.map((i) => ({ stockItemId: i.id, counted: counts[i.id] !== undefined && counts[i.id] !== '' ? Number(counts[i.id]) : undefined }));
    const r = recordClosing(list, user.id);
    setCounts({});
    toast(`Closing saved: ${r.counted} counted${r.thrown ? `, leftovers of ${r.thrown} item${r.thrown === 1 ? '' : 's'} thrown away` : ''}`);
  };
  return (
    <>
      <p className="muted" style={{ marginTop: 0 }}>
        Count what is really left and type it. Skip anything you did not count. Saving applies each item's leftovers rule.
      </p>
      <div style={{ overflowX: 'auto' }}>
        <table className="list">
          <thead>
            <tr>
              <th>Item</th>
              <th className="num">Made today</th>
              <th className="num">Sold today</th>
              <th className="num">Should be left</th>
              <th className="num">Counted</th>
              <th className="num">Difference</th>
              <th>Leftovers</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((i) => {
              const lv = levels.get(i.id);
              const expected = lv && lv.status !== 'uncounted' && lv.status !== 'untracked' ? Math.max(0, lv.onHand) : 0;
              const v = counts[i.id] ?? '';
              const d = v === '' ? null : Number(v) - expected;
              const isRaw = !i.madeFrom;
              return (
                <tr key={i.id}>
                  <td>
                    <b>{i.name}</b>
                    {isRaw && <div className="muted small">raw stock</div>}
                  </td>
                  <td className="num">{isRaw ? '—' : madeToday(i.id)}</td>
                  <td className="num">{isRaw ? '—' : soldToday(i.id)}</td>
                  <td className="num">{plural(Math.round(expected * 100) / 100, countUnit(i))}</td>
                  <td className="num">
                    <input className="count-in" inputMode="decimal" value={v} onChange={(e) => setCounts({ ...counts, [i.id]: e.target.value.replace(/[^\d.]/g, '') })} aria-label={`${i.name} counted`} />
                  </td>
                  <td className={`num ${d === null ? '' : d < -0.0005 ? 'bad' : 'good'}`}>{d === null ? '' : Math.abs(d) < 0.0005 ? <LuCircleCheck aria-hidden="true" /> : d < 0 ? `${d.toLocaleString('en-US', { maximumFractionDigits: 2 })} missing` : `+${d.toLocaleString('en-US', { maximumFractionDigits: 2 })}`}</td>
                  <td>{isRaw ? <span className="muted small">stays</span> : i.leftovers === 'waste' ? <span className="tag2 y">Throw away</span> : <span className="tag2 g">Keep for tomorrow</span>}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div className="row" style={{ justifyContent: 'flex-end', marginTop: 12 }}>
        <button className="btn primary" onClick={save}>
          Save closing count
        </button>
      </div>
    </>
  );
}
