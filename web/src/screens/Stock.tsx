import { useMemo, useState } from 'react';
import { recordStockCount, recordWaste, upsertStockItem, useCurrentUser, useStockLevels, useStore } from '../store/store';
import { can, todayISO, uid } from '../domain/rules';
import { countUnit, fmtQty, perPack, type StockLevel } from '../domain/stock';
import { fmt } from '../domain/money';
import type { StockItem } from '../domain/types';
import { Dialog, TopBar, toast } from '../components/ui';
import { LuClipboardCheck, LuPlus, LuTrash2, LuTriangleAlert } from 'react-icons/lu';

type Filter = 'attention' | 'all' | 'untracked';
const STATUS_LABEL: Record<StockLevel['status'], string> = { ok: 'OK', low: 'Running low', out: 'Out', uncounted: 'Not counted yet', untracked: 'Not tracked' };
const order: Record<StockLevel['status'], number> = { out: 0, low: 1, uncounted: 2, ok: 3, untracked: 4 };

/**
 * What is in the store room. Every sale takes its recipe off; purchases (Books) add;
 * a stock take sets the real amount; waste takes some off. Kitchen can count and record waste,
 * managers and owners also change how items are counted.
 */
export default function StockScreen() {
  const user = useCurrentUser()!;
  const levels = useStockLevels();
  const base = useStore((s) => s.currencies.find((c) => c.code === s.settings.baseCurrency)!);
  const canEdit = can(user.role, 'menu_edit');
  const [filter, setFilter] = useState<Filter>('all');
  const [counting, setCounting] = useState(false);
  const [wasting, setWasting] = useState<string | null>(null);
  const [open, setOpen] = useState<StockItem | null>(null);

  const all = [...levels.values()];
  const tracked = all.filter((l) => l.status !== 'untracked');
  const attention = tracked.filter((l) => l.status === 'low' || l.status === 'out' || l.status === 'uncounted');
  const list = (filter === 'attention' ? attention : filter === 'all' ? tracked : all.filter((l) => l.status === 'untracked')).sort(
    (a, b) => order[a.status] - order[b.status] || a.item.name.localeCompare(b.item.name),
  );
  const n = (st: StockLevel['status']) => tracked.filter((l) => l.status === st).length;
  const value = Math.round(tracked.reduce((s, l) => s + (l.value ?? 0), 0) * 100) / 100;

  return (
    <div className="app">
      <TopBar title="Stock">
        <button className="btn stock-act" onClick={() => setWasting('')} aria-label="Record waste" title="Record waste">
          <LuTrash2 aria-hidden="true" />
          <span>Record waste</span>
        </button>
        <button className="btn primary stock-act" onClick={() => setCounting(true)} aria-label="Stock take" title="Stock take">
          <LuClipboardCheck aria-hidden="true" />
          <span>Stock take</span>
        </button>
      </TopBar>
      <div className="page">
        <div className="stats stock-stats">
          <button className={`card stat ${n('out') ? 'bad' : ''}`} onClick={() => setFilter('attention')}>
            <div className="muted lbl">Out</div>
            <div className="val">{n('out')}</div>
          </button>
          <button className={`card stat ${n('low') ? 'warn' : ''}`} onClick={() => setFilter('attention')}>
            <div className="muted lbl">Running low</div>
            <div className="val">{n('low')}</div>
          </button>
          <button className="card stat" onClick={() => setFilter('attention')}>
            <div className="muted lbl">Not counted yet</div>
            <div className="val">{n('uncounted')}</div>
          </button>
          <div className="card stat">
            <div className="muted lbl">Stock value</div>
            <div className="val">{fmt(value, base)}</div>
            <div className="muted sub">at last purchase prices</div>
          </div>
        </div>

        <div className="tabs" style={{ marginTop: 4 }}>
          <button className={filter === 'all' ? 'on' : ''} onClick={() => setFilter('all')}>
            Counted items ({tracked.length})
          </button>
          <button className={filter === 'attention' ? 'on' : ''} onClick={() => setFilter('attention')}>
            Needs attention ({attention.length})
          </button>
          <button className={filter === 'untracked' ? 'on' : ''} onClick={() => setFilter('untracked')}>
            Not tracked ({all.length - tracked.length})
          </button>
        </div>
        {filter === 'untracked' && (
          <p className="muted" style={{ marginTop: 0 }}>
            Bought (they appear in Books) but not counted, e.g. vegetables bought by the lot. {canEdit ? 'Tap one to start counting it.' : ''}
          </p>
        )}

        <div className="stock-list">
          {list.length === 0 && <div className="empty">{filter === 'attention' ? 'Nothing needs attention. Everything is counted and above its warning level.' : 'Nothing here.'}</div>}
          {list.map((l) => (
            <StockRow key={l.item.id} l={l} onOpen={() => setOpen(l.item)} />
          ))}
        </div>
        {canEdit && (
          <button className="btn" style={{ marginTop: 14 }} onClick={() => setOpen({ id: uid('st-'), name: '', unit: 'kg', track: true, countUnit: 'kg', perPack: 1 })}>
            <LuPlus aria-hidden="true" />
            Add stock item
          </button>
        )}
        <p className="muted stock-how">
          How it works: every sale takes off what its meal uses (set per meal under <b>Menu</b>). Purchases recorded in <b>Books</b> add to stock. A <b>stock take</b> sets
          the real amount and shows any difference. Waste takes stock off with a reason.
        </p>
      </div>
      {counting && <StockTakeDialog onClose={() => setCounting(false)} />}
      {wasting !== null && <WasteDialog initial={wasting} onClose={() => setWasting(null)} />}
      {open && (
        <ItemDialog
          item={open}
          isNew={!levels.has(open.id)}
          canEdit={canEdit}
          onClose={() => setOpen(null)}
          onWaste={() => {
            setWasting(open.id);
            setOpen(null);
          }}
        />
      )}
    </div>
  );
}

function daysText(d?: number) {
  if (d === undefined) return '';
  if (d < 1) return 'runs out today';
  const n = Math.floor(d);
  return `lasts about ${n} day${n === 1 ? '' : 's'}`;
}

function StockRow({ l, onOpen }: { l: StockLevel; onOpen: () => void }) {
  const u = countUnit(l.item);
  const counted = l.status !== 'uncounted' && l.status !== 'untracked';
  // The bar fills up to three times the warning level (or the amount if there is no warning level).
  const full = Math.max(l.item.lowAt ? l.item.lowAt * 3 : 0, l.onHand, 0.0001);
  const pct = counted ? Math.max(0, Math.min(100, (l.onHand / full) * 100)) : 0;
  return (
    <button className={`stock-row st-${l.status}`} onClick={onOpen}>
      <div className="sr-name">
        <b>{l.item.name}</b>
        <small>
          Bought by {l.item.unit}
          {perPack(l.item) !== 1 ? ` (${fmtQty(perPack(l.item), u)})` : ''}
        </small>
      </div>
      <div className="sr-amt">
        {counted ? (
          <>
            <b className="tnum">{fmtQty(l.onHand, u)}</b>
            <span className="sr-bar" aria-hidden="true">
              <span style={{ width: `${pct}%` }} />
            </span>
          </>
        ) : (
          <span className="muted">{l.status === 'untracked' ? 'Not counted' : 'Count it to start'}</span>
        )}
      </div>
      <div className="sr-use">
        {l.status !== 'untracked' && (
          <>
            <span>Used today: {fmtQty(l.usedToday, u)}</span>
            <small>{counted ? daysText(l.daysLeft) || (l.perDay ? '' : 'no recent sales') : ''}</small>
          </>
        )}
      </div>
      <span className={`sr-pill ${l.status}`}>
        {(l.status === 'low' || l.status === 'out') && <LuTriangleAlert aria-hidden="true" />}
        {STATUS_LABEL[l.status]}
      </span>
    </button>
  );
}

/** Count what is really there. Leave an item empty to skip it. */
function StockTakeDialog({ onClose }: { onClose: () => void }) {
  const user = useCurrentUser()!;
  const levels = useStockLevels();
  const items = [...levels.values()].filter((l) => l.status !== 'untracked').sort((a, b) => a.item.name.localeCompare(b.item.name));
  const [vals, setVals] = useState<Record<string, string>>({});
  const filled = Object.entries(vals).filter(([, v]) => v.trim() !== '' && Number(v) >= 0);
  const save = () => {
    const r = recordStockCount(filled.map(([id, v]) => ({ stockItemId: id, qty: Number(v) })), user.id);
    if (!r.ok) return toast(r.error);
    toast(`Stock take saved: ${r.n} item${r.n === 1 ? '' : 's'} counted`);
    onClose();
  };
  return (
    <Dialog
      title="Stock take"
      onClose={onClose}
      width={720}
      footer={
        <>
          <button className="btn" onClick={onClose}>
            Cancel
          </button>
          <button className={`btn ${filled.length ? 'primary' : 'blocked'}`} aria-disabled={!filled.length} onClick={save}>
            {filled.length ? `Save ${filled.length} count${filled.length === 1 ? '' : 's'}` : 'Type what you counted'}
          </button>
        </>
      }
    >
      <p className="muted" style={{ marginTop: 0 }}>
        Count what is really in the store room and kitchen, and type it in. Skip anything you did not count. The difference from what the system expected is kept, so losses show up.
      </p>
      <div className="take-list">
        <div className="take-row head">
          <span>Item</span>
          <span>Expected</span>
          <span>Counted</span>
          <span>Difference</span>
        </div>
        {items.map((l) => {
          const u = countUnit(l.item);
          const v = vals[l.item.id] ?? '';
          const expected = l.status === 'uncounted' ? undefined : l.onHand;
          const diff = v.trim() !== '' && expected !== undefined ? Number(v) - expected : undefined;
          return (
            <div key={l.item.id} className="take-row">
              <span>
                <b>{l.item.name}</b>
              </span>
              <span className="tnum muted">{expected === undefined ? '—' : fmtQty(expected, u)}</span>
              <span className="take-in">
                <input
                  id={`count-${l.item.id}`}
                  type="number"
                  inputMode="decimal"
                  min={0}
                  step="any"
                  value={v}
                  onChange={(e) => setVals((x) => ({ ...x, [l.item.id]: e.target.value }))}
                  aria-label={`${l.item.name} counted, in ${u}`}
                />
                <small>{u}</small>
              </span>
              <span className={`tnum ${diff === undefined ? '' : diff < -0.0005 ? 'neg' : diff > 0.0005 ? 'pos' : ''}`}>
                {diff === undefined ? '' : `${diff > 0 ? '+' : ''}${fmtQty(diff, u)}`}
              </span>
            </div>
          );
        })}
      </div>
    </Dialog>
  );
}

const WASTE_REASONS = ['Spoiled', 'Burnt', 'Dropped', 'Staff meal', 'Expired'];

function WasteDialog({ initial, onClose }: { initial: string; onClose: () => void }) {
  const user = useCurrentUser()!;
  const levels = useStockLevels();
  const items = [...levels.values()].filter((l) => l.status !== 'untracked').sort((a, b) => a.item.name.localeCompare(b.item.name));
  const [id, setId] = useState(initial || items[0]?.item.id || '');
  const [qty, setQty] = useState('');
  const [reason, setReason] = useState('');
  const item = levels.get(id)?.item;
  const blocker = !item ? 'Choose the item' : !(Number(qty) > 0) ? 'Type how much' : !reason.trim() ? 'Choose a reason' : '';
  const save = () => {
    if (blocker || !item) return;
    const r = recordWaste(id, Number(qty), reason, user.id);
    if (!r.ok) return toast(r.error);
    toast(`${fmtQty(Number(qty), countUnit(item))} of ${item.name} recorded as waste`);
    onClose();
  };
  return (
    <Dialog
      title="Record waste"
      onClose={onClose}
      width={520}
      footer={
        <>
          <button className="btn" onClick={onClose}>
            Cancel
          </button>
          <button className={`btn ${blocker ? 'blocked' : 'primary'}`} aria-disabled={!!blocker} onClick={save}>
            {blocker || 'Take it off stock'}
          </button>
        </>
      }
    >
      <label className="field" style={{ marginTop: 0 }}>
        Item
        <select id="waste-item" value={id} onChange={(e) => setId(e.target.value)}>
          {items.map((l) => (
            <option key={l.item.id} value={l.item.id}>
              {l.item.name}
            </option>
          ))}
        </select>
      </label>
      <label className="field">
        How much{item ? ` (${countUnit(item)})` : ''}
        <input id="waste-qty" type="number" inputMode="decimal" min={0} step="any" value={qty} onChange={(e) => setQty(e.target.value)} />
      </label>
      <div className="section-title">Why</div>
      <div className="seg">
        {WASTE_REASONS.map((r) => (
          <button key={r} className={reason === r ? 'on' : ''} onClick={() => setReason(r)}>
            {r}
          </button>
        ))}
      </div>
      <label className="field">
        Or type the reason
        <input value={WASTE_REASONS.includes(reason) ? '' : reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Fridge broke overnight" />
      </label>
    </Dialog>
  );
}

/** One item: what it has been doing (counts, purchases, waste, sales) and, for managers, how it is counted. */
function ItemDialog({ item, isNew, canEdit, onClose, onWaste }: { item: StockItem; isNew: boolean; canEdit: boolean; onClose: () => void; onWaste: () => void }) {
  const levels = useStockLevels();
  const menu = useStore((s) => s.menu);
  const addOns = useStore((s) => s.addOns);
  const moves = useStore((s) => s.stockMoves);
  const purchases = useStore((s) => s.purchases);
  const orders = useStore((s) => s.orders);
  const staff = useStore((s) => s.staff);
  const [it, setIt] = useState<StockItem>({ ...item, track: item.track ?? false });
  const [error, setError] = useState('');
  const l = levels.get(item.id);
  const u = countUnit(it);

  const usedBy = [
    ...menu.flatMap((m) => (m.recipe ?? []).filter((r) => r.stockItemId === item.id).map((r) => `${m.name}: ${fmtQty(r.qty, u)}`)),
    ...addOns.flatMap((a) => (a.recipe ?? []).filter((r) => r.stockItemId === item.id).map((r) => `${a.name} (add-on): ${fmtQty(r.qty, u)}`)),
    ...(it.perPackedPlate ? [`Every Take Away / Delivery plate: ${fmtQty(it.perPackedPlate, u)}`] : []),
  ];

  const history = useMemo(() => {
    const who = (id: string) => staff.find((s) => s.id === id)?.name ?? '';
    const rows: { at: string; text: string; qty: string; cls?: string }[] = [];
    for (const m of moves)
      if (m.stockItemId === item.id)
        rows.push(
          m.kind === 'count'
            ? {
                at: m.at,
                text: `Counted${m.reason ? ` (${m.reason})` : ''} · ${who(m.by)}${m.expected !== undefined ? ` · expected ${fmtQty(m.expected, u)}` : ''}`,
                qty: `= ${fmtQty(m.qty, u)}`,
                cls: m.expected !== undefined && m.qty < m.expected - 0.0005 ? 'neg' : '',
              }
            : { at: m.at, text: `Waste: ${m.reason} · ${who(m.by)}`, qty: `− ${fmtQty(m.qty, u)}`, cls: 'neg' },
        );
    for (const p of purchases)
      if (!p.example)
        for (const pl of p.lines)
          if (pl.stockItemId === item.id)
            rows.push({ at: p.at, text: `${p.reversesId ? 'Purchase reversed' : 'Bought'}: ${pl.qty} × ${pl.unit} from ${p.supplier}`, qty: `${(pl.stockQty ?? 0) >= 0 ? '+' : '−'} ${fmtQty(Math.abs(pl.stockQty ?? pl.qty * perPack(it)), u)}`, cls: (pl.stockQty ?? 0) < 0 ? 'neg' : 'pos' });
    // Sales, one row per day.
    const byDay = new Map<string, { q: number; n: number }>();
    for (const o of orders) {
      const q = o.stockUsed?.[item.id];
      if (!q || o.example || o.status === 'cancelled') continue;
      const d = todayISO(new Date(o.createdAt));
      const cur = byDay.get(d) ?? { q: 0, n: 0 };
      byDay.set(d, { q: cur.q + q, n: cur.n + 1 });
    }
    for (const [d, v] of byDay) rows.push({ at: new Date(`${d}T23:59:59`).toISOString(), text: `Sales on ${new Date(`${d}T12:00`).toLocaleDateString([], { day: 'numeric', month: 'short' })} (${v.n} order${v.n === 1 ? '' : 's'})`, qty: `− ${fmtQty(v.q, u)}`, cls: 'neg' });
    return rows.sort((a, b) => b.at.localeCompare(a.at)).slice(0, 25);
  }, [moves, purchases, orders, staff, item.id, u]);

  const save = () => {
    const r = upsertStockItem(it);
    if (!r.ok) return setError(r.error);
    toast(isNew ? `${it.name.trim()} added — do a stock take to start counting it` : 'Saved');
    onClose();
  };
  const num = (v: string) => (v.trim() === '' ? undefined : Math.max(0, Number(v)));

  return (
    <Dialog
      title={isNew ? 'Add a stock item' : item.name}
      onClose={onClose}
      width={680}
      footer={
        <>
          {!isNew && l && l.status !== 'untracked' && (
            <button className="btn" onClick={onWaste} style={{ marginRight: 'auto' }}>
              <LuTrash2 aria-hidden="true" />
              Record waste
            </button>
          )}
          <button className="btn" onClick={onClose}>
            {canEdit ? 'Cancel' : 'Close'}
          </button>
          {canEdit && (
            <button className="btn primary" onClick={save}>
              Save
            </button>
          )}
        </>
      }
    >
      {!isNew && l && (
        <div className="item-now">
          <div>
            <small className="muted">In stock</small>
            <b className="tnum">{l.status === 'uncounted' ? 'Not counted yet' : l.status === 'untracked' ? 'Not tracked' : fmtQty(l.onHand, u)}</b>
          </div>
          <div>
            <small className="muted">Used today</small>
            <b className="tnum">{fmtQty(l.usedToday, u)}</b>
          </div>
          <div>
            <small className="muted">Per day (7-day average)</small>
            <b className="tnum">{fmtQty(l.perDay, u)}</b>
          </div>
          <div>
            <small className="muted">Last counted</small>
            <b>{l.lastCountAt ? new Date(l.lastCountAt).toLocaleString([], { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—'}</b>
          </div>
        </div>
      )}

      {canEdit && (
        <>
          <label className="row" style={{ margin: '12px 0 4px' }}>
            <input type="checkbox" checked={!!it.track} onChange={(e) => setIt({ ...it, track: e.target.checked })} />
            Count this item and take it off with every sale
          </label>
          <div className="form-grid">
            <label className="field">
              Name
              <input id="stock-name" value={it.name} onChange={(e) => setIt({ ...it, name: e.target.value })} placeholder="e.g. Beef" />
            </label>
            <label className="field">
              Bought by
              <input id="stock-unit" value={it.unit} onChange={(e) => setIt({ ...it, unit: e.target.value })} placeholder="e.g. 10 kg bag, crate of 24, kg" />
            </label>
            <label className="field">
              Counted in
              <input id="stock-count-unit" value={it.countUnit ?? ''} onChange={(e) => setIt({ ...it, countUnit: e.target.value })} placeholder="e.g. kg, bottle, egg" />
            </label>
            <label className="field">
              {it.unit && it.unit.trim().toLowerCase() !== u.toLowerCase() ? `How many ${u} in one ${it.unit}` : `${u} per purchase unit`}
              <input id="stock-per-pack" type="number" inputMode="decimal" min={0} step="any" value={it.perPack ?? ''} onChange={(e) => setIt({ ...it, perPack: num(e.target.value) })} placeholder="1" />
            </label>
            <label className="field">
              Warn when down to ({u})
              <input id="stock-low" type="number" inputMode="decimal" min={0} step="any" value={it.lowAt ?? ''} onChange={(e) => setIt({ ...it, lowAt: num(e.target.value) })} placeholder="e.g. 3" />
            </label>
            <label className="field">
              Packaging: {u} per Take Away plate
              <input id="stock-packed" type="number" inputMode="decimal" min={0} step="any" value={it.perPackedPlate ?? ''} onChange={(e) => setIt({ ...it, perPackedPlate: num(e.target.value) || undefined })} placeholder="only for containers" />
            </label>
          </div>
          <label className="row" style={{ marginTop: 12 }}>
            <input type="checkbox" checked={!!it.hideWhenOut} onChange={(e) => setIt({ ...it, hideWhenOut: e.target.checked })} />
            When it runs out, hide the meals that need it from the till
          </label>
          {error && <div className="error">{error}</div>}
        </>
      )}

      <div className="section-title">Used by</div>
      <p className="hint" style={{ marginTop: -4 }}>
        {usedBy.length ? usedBy.join(' · ') : 'No meal uses it yet. Add it to a meal under Menu → the meal → Stock used per plate.'}
      </p>

      {!isNew && (
        <>
          <div className="section-title">History</div>
          {history.length === 0 ? (
            <p className="hint">Nothing yet.</p>
          ) : (
            <div className="stock-hist">
              {history.map((h, i) => (
                <div key={i}>
                  <span>
                    <small className="muted">{new Date(h.at).toLocaleString([], { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</small>
                    {h.text}
                  </span>
                  <b className={`tnum ${h.cls ?? ''}`}>{h.qty}</b>
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </Dialog>
  );
}
