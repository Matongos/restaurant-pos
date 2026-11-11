import { useState } from 'react';
import { LuPencil, LuPlus, LuTrash2 } from 'react-icons/lu';
import { deleteAddOn, setAddOnAvailable, upsertAddOn, upsertMenuItem, useStore } from '../store/store';
import { uid } from '../domain/rules';
import { fmt } from '../domain/money';
import type { AddOn } from '../domain/types';
import { Dialog, toast } from './ui';

/**
 * Add-ons the customer can ask for with a meal: Extra meat +$1.50, Fried egg +$0.50, Extra gravy (free).
 * One list, so a price changes everywhere at once; each add-on says which meals offer it.
 */
export default function AddOnEditor() {
  const addOns = useStore((s) => s.addOns);
  const menu = useStore((s) => s.menu);
  const base = useStore((s) => s.currencies.find((c) => c.code === s.settings.baseCurrency)!);
  const [editing, setEditing] = useState<AddOn | null>(null);
  const [deleting, setDeleting] = useState<AddOn | null>(null);
  const sorted = addOns.slice().sort((a, b) => a.sort - b.sort);
  const mealsWith = (id: string) => menu.filter((m) => m.addOnIds?.includes(id));

  return (
    <>
      <div className="row" style={{ marginBottom: 10 }}>
        <p className="muted grow" style={{ margin: 0 }}>
          Extras the cashier adds to a meal with one tap, priced per plate. Use 0 for free extras like gravy.
        </p>
        <button className="btn" onClick={() => setEditing({ id: uid('ad-'), name: '', price: 0, available: true, sort: 0 })}>
          <LuPlus aria-hidden="true" />
          Add add-on
        </button>
      </div>
      <div className="cat-list">
        {sorted.length === 0 && <div className="empty">No add-ons yet.</div>}
        {sorted.map((a) => {
          const meals = mealsWith(a.id);
          return (
            <div key={a.id} className={`cat-edit-row addon-row ${a.available ? '' : 'off'}`}>
              <div className="grow">
                <b>{a.name}</b> <span className="addon-price">{a.price > 0 ? `+${fmt(a.price, base)}` : 'free'}</span>
                <div className="muted cat-sub">
                  {meals.length ? `With ${meals.map((m) => m.name).join(', ')}` : 'Not offered with any meal yet'}
                  {a.available ? '' : ' · finished today'}
                </div>
              </div>
              <div className="cat-tools">
                <button className="btn icon-only" onClick={() => setEditing(a)} aria-label={`Edit ${a.name}`}>
                  <LuPencil aria-hidden="true" />
                </button>
                <button className="btn icon-only" onClick={() => setDeleting(a)} aria-label={`Delete ${a.name}`}>
                  <LuTrash2 aria-hidden="true" />
                </button>
              </div>
              <button className={`switch ${a.available ? 'on' : ''}`} onClick={() => setAddOnAvailable(a.id, !a.available)} aria-label={`${a.name} available today`} aria-pressed={a.available}>
                <span />
              </button>
            </div>
          );
        })}
      </div>
      {editing && <AddOnDialog addOn={editing} isNew={!addOns.some((a) => a.id === editing.id)} onClose={() => setEditing(null)} />}
      {deleting && (
        <Dialog
          title={`Delete ${deleting.name}?`}
          onClose={() => setDeleting(null)}
          width={480}
          footer={
            <>
              <button className="btn" onClick={() => setDeleting(null)}>
                Cancel
              </button>
              <button
                className="btn danger-fill"
                onClick={() => {
                  deleteAddOn(deleting.id);
                  toast(`${deleting.name} deleted`);
                  setDeleting(null);
                }}
              >
                Delete add-on
              </button>
            </>
          }
        >
          <p style={{ marginTop: 0 }}>
            It disappears from {mealsWith(deleting.id).length ? mealsWith(deleting.id).map((m) => m.name).join(', ') : 'the till'}. Past sales keep it, so totals and reports don't change.
            To stop it for today only, switch it off instead.
          </p>
        </Dialog>
      )}
    </>
  );
}

function AddOnDialog({ addOn, isNew, onClose }: { addOn: AddOn; isNew: boolean; onClose: () => void }) {
  const menu = useStore((s) => s.menu);
  const categories = useStore((s) => s.categories);
  const [name, setName] = useState(addOn.name);
  const [price, setPrice] = useState(isNew ? '' : String(addOn.price));
  const [cost, setCost] = useState(addOn.cost === undefined ? '' : String(addOn.cost));
  const [meals, setMeals] = useState<Set<string>>(() => new Set(menu.filter((m) => m.addOnIds?.includes(addOn.id)).map((m) => m.id)));
  const [error, setError] = useState('');
  const p = price.trim() === '' ? 0 : Number(price);
  const blocker = !name.trim() ? 'Type a name' : !(p >= 0) ? 'Check the price' : '';
  const flip = (id: string) =>
    setMeals((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  const save = () => {
    if (blocker) return;
    const r = upsertAddOn({ ...addOn, name, price: p, cost: cost.trim() === '' ? undefined : Math.max(0, Number(cost) || 0) });
    if (!r.ok) return setError(r.error);
    for (const m of menu) {
      const has = !!m.addOnIds?.includes(addOn.id);
      if (has === meals.has(m.id)) continue;
      const ids = has ? m.addOnIds!.filter((x) => x !== addOn.id) : [...(m.addOnIds ?? []), addOn.id];
      upsertMenuItem({ ...m, addOnIds: ids.length ? ids : undefined });
    }
    toast(isNew ? `${name.trim()} added` : 'Saved');
    onClose();
  };
  return (
    <Dialog
      title={isNew ? 'Add an add-on' : `Edit ${addOn.name}`}
      onClose={onClose}
      width={560}
      footer={
        <>
          <button className="btn" onClick={onClose}>
            Cancel
          </button>
          <button className={`btn ${blocker ? 'blocked' : 'primary'}`} aria-disabled={!!blocker} onClick={save}>
            {blocker || 'Save'}
          </button>
        </>
      }
    >
      <div className="form-grid">
        <label className="field" style={{ marginTop: 0 }}>
          Name
          <input id="addon-name" autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Extra meat" />
        </label>
        <label className="field" style={{ marginTop: 0 }}>
          Price per plate (0 = free)
          <input id="addon-price" type="number" step="0.05" min={0} inputMode="decimal" value={price} onChange={(e) => setPrice(e.target.value)} placeholder="0.00" />
        </label>
        <label className="field">
          Cost to make (optional)
          <input id="addon-cost" type="number" step="0.05" min={0} inputMode="decimal" value={cost} onChange={(e) => setCost(e.target.value)} placeholder="e.g. 0.90" />
        </label>
      </div>
      <div className="section-title">Offered with</div>
      <p className="hint" style={{ marginTop: -4 }}>
        Tap the meals this add-on goes with. It appears as <b>+ Extra</b> on their order lines.
      </p>
      {categories
        .slice()
        .sort((a, b) => a.sort - b.sort)
        .map((c) => {
          const list = menu.filter((m) => m.categoryId === c.id);
          if (!list.length) return null;
          return (
            <div key={c.id} style={{ marginBottom: 8 }}>
              <div className="muted" style={{ fontSize: 13, margin: '6px 0' }}>
                {c.name}
              </div>
              <div className="seg">
                {list.map((m) => (
                  <button key={m.id} className={meals.has(m.id) ? 'on' : ''} aria-pressed={meals.has(m.id)} onClick={() => flip(m.id)}>
                    {m.name}
                  </button>
                ))}
              </div>
            </div>
          );
        })}
      {error && <div className="error">{error}</div>}
    </Dialog>
  );
}
