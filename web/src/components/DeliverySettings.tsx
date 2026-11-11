import { useState } from 'react';
import { LuPencil, LuPlus, LuTrash2 } from 'react-icons/lu';
import { deleteDeliveryArea, setOrderTypeEnabled, updateOrderType, upsertDeliveryArea, useStore } from '../store/store';
import { uid } from '../domain/rules';
import { fmt } from '../domain/money';
import type { DeliveryArea } from '../domain/types';
import { Dialog, toast } from './ui';

/**
 * Delivery on or off, the packaging printed on the kitchen ticket, and the delivery areas with their fee.
 * The cashier picks an area at the till (or types another fee for an unusual address).
 */
export default function DeliverySettings() {
  const type = useStore((s) => s.orderTypes.find((t) => t.id === 'delivery'));
  const areas = useStore((s) => s.settings.deliveryAreas ?? []);
  const base = useStore((s) => s.currencies.find((c) => c.code === s.settings.baseCurrency)!);
  const [editing, setEditing] = useState<DeliveryArea | null>(null);
  const [pack, setPack] = useState(type?.packaging ?? '');
  if (!type) return <p className="muted">Delivery is not available in this set-up.</p>;
  const on = type.enabled;

  return (
    <>
      <div className={`cat-edit-row ${on ? '' : 'off'}`} style={{ marginBottom: 14 }}>
        <div className="grow">
          <b>Take delivery orders</b>
          <div className="muted cat-sub">
            {on ? 'A Delivery button sits next to Eat In and Take Away at the till.' : 'Off: the till shows only Eat In and Take Away.'}
          </div>
        </div>
        <button
          id="delivery-on"
          className={`switch ${on ? 'on' : ''}`}
          onClick={() => {
            setOrderTypeEnabled('delivery', !on);
            toast(on ? 'Delivery switched off' : 'Delivery is on — it appears at the till');
          }}
          aria-label="Take delivery orders"
          aria-pressed={on}
        >
          <span />
        </button>
      </div>

      <p className="muted" style={{ marginTop: 0 }}>
        How it works: the cashier taps <b>Delivery</b>, types the customer, phone and address, and picks an area (that sets the fee). The customer pays first, as with
        every order (EcoCash or cash at the counter). A <b>delivery slip</b> prints for the bag. In <b>Orders</b>, tap <b>Out for delivery</b> when the rider
        leaves, then <b>Delivered</b> when they are back.
      </p>

      <label className="field">
        Packaging (printed on the kitchen ticket)
        <div className="row">
          <input className="grow" value={pack} onChange={(e) => setPack(e.target.value)} placeholder="e.g. Plastic container + bag" />
          <button
            className="btn"
            disabled={pack.trim() === (type.packaging ?? '')}
            onClick={() => {
              updateOrderType('delivery', { packaging: pack.trim() });
              toast('Saved');
            }}
          >
            Save
          </button>
        </div>
      </label>

      <h3 className="sub-head">Delivery areas and fees</h3>
      <div className="row" style={{ marginBottom: 10 }}>
        <p className="muted grow" style={{ margin: 0 }}>
          The cashier taps an area to set the fee. A different fee can still be typed for one order.
        </p>
        <button className="btn" onClick={() => setEditing({ id: uid('da-'), name: '', fee: 0 })}>
          <LuPlus aria-hidden="true" />
          Add area
        </button>
      </div>
      <div className="cat-list">
        {areas.length === 0 && <div className="empty">No areas yet. The cashier will type the fee for each delivery.</div>}
        {areas.map((a) => (
          <div key={a.id} className="cat-edit-row">
            <div className="grow">
              <b>{a.name}</b> <span className="addon-price">{a.fee > 0 ? fmt(a.fee, base) : 'free'}</span>
            </div>
            <div className="cat-tools">
              <button className="btn icon-only" onClick={() => setEditing(a)} aria-label={`Edit ${a.name}`}>
                <LuPencil aria-hidden="true" />
              </button>
              <button
                className="btn icon-only"
                onClick={() => {
                  deleteDeliveryArea(a.id);
                  toast(`${a.name} removed. Past orders keep their fee.`);
                }}
                aria-label={`Delete ${a.name}`}
              >
                <LuTrash2 aria-hidden="true" />
              </button>
            </div>
          </div>
        ))}
      </div>
      {editing && <AreaDialog area={editing} isNew={!areas.some((a) => a.id === editing.id)} onClose={() => setEditing(null)} />}
    </>
  );
}

function AreaDialog({ area, isNew, onClose }: { area: DeliveryArea; isNew: boolean; onClose: () => void }) {
  const base = useStore((s) => s.currencies.find((c) => c.code === s.settings.baseCurrency)!);
  const [name, setName] = useState(area.name);
  const [fee, setFee] = useState(isNew ? '' : String(area.fee));
  const [error, setError] = useState('');
  const f = fee.trim() === '' ? NaN : Number(fee);
  const blocker = !name.trim() ? 'Type the area name' : !(f >= 0) ? 'Type the fee (0 = free)' : '';
  const save = () => {
    if (blocker) return;
    const r = upsertDeliveryArea({ ...area, name, fee: f });
    if (!r.ok) return setError(r.error);
    toast(isNew ? `${name.trim()} added` : 'Saved');
    onClose();
  };
  return (
    <Dialog
      title={isNew ? 'Add a delivery area' : `Edit ${area.name}`}
      onClose={onClose}
      width={460}
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
      <label className="field" style={{ marginTop: 0 }}>
        Area
        <input id="area-name" autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Avondale, Belgravia" />
      </label>
      <label className="field">
        Delivery fee ({base.code})
        <input id="area-fee" type="number" inputMode="decimal" step="0.5" min={0} value={fee} onChange={(e) => setFee(e.target.value)} placeholder="0.00" onKeyDown={(e) => e.key === 'Enter' && save()} />
      </label>
      {error && <div className="error">{error}</div>}
    </Dialog>
  );
}
