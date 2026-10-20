import { useState } from 'react';
import { payOutChange, useCurrentUser, useStore } from '../store/store';
import { fmt, round2 } from '../domain/money';
import type { Customer } from '../domain/types';
import { Dialog, toast } from './ui';
import ChangeFinder from './ChangeFinder';
import { describeCustomer } from './CustomerPicker';

/** A customer came back only to collect change: find them, hand it over, back to the till. */
export default function CollectChangeDialog({ onClose }: { onClose: () => void }) {
  const user = useCurrentUser()!;
  const currencies = useStore((s) => s.currencies);
  const baseCode = useStore((s) => s.settings.baseCurrency);
  const base = currencies.find((c) => c.code === baseCode)!;
  const [picked, setPicked] = useState<{ c: Customer; b: number } | null>(null);
  const [other, setOther] = useState<string | null>(null);

  const amount = picked ? (other === null ? picked.b : Math.min(picked.b, Math.max(0, Number(other) || 0))) : 0;

  const give = () => {
    if (!picked || !(amount > 0)) return;
    const r = payOutChange(picked.c.id, amount, user.id);
    if (!r.ok) return toast(r.error!);
    const left = round2(picked.b - amount);
    toast(`Gave ${fmt(amount, base)} to ${picked.c.name}.${left > 0 ? ` ${fmt(left, base)} still kept for them.` : ''}`);
    onClose();
  };

  return (
    <Dialog title="Collect change" onClose={onClose} width={620}>
      {!picked ? (
        <ChangeFinder onPick={(c, b) => setPicked({ c, b })} action={(_, b) => `Give ${fmt(b, base)}`} />
      ) : (
        <div className="collect">
          <div className="collect-who">
            <div>
              <div className="collect-name">{picked.c.name}</div>
              <div className="muted">{describeCustomer(picked.c) || 'No phone or note'}</div>
            </div>
            <button className="btn" onClick={() => { setPicked(null); setOther(null); }}>
              Someone else
            </button>
          </div>
          <div className="collect-amount">
            <div className="muted">Hand over</div>
            <div className="collect-big">{fmt(amount, base)}</div>
            {other === null ? (
              <button className="btn ghost" onClick={() => setOther(String(picked.b))}>
                Give a different amount
              </button>
            ) : (
              <label className="field" style={{ alignItems: 'center' }}>
                Amount (up to {fmt(picked.b, base)})
                <input
                  id="collect-other"
                  autoFocus
                  inputMode="decimal"
                  value={other}
                  onChange={(e) => setOther(e.target.value.replace(/[^\d.]/g, ''))}
                  style={{ textAlign: 'center', fontSize: 22, width: 160 }}
                />
              </label>
            )}
          </div>
          <button className="btn big primary" style={{ width: '100%' }} disabled={!(amount > 0)} onClick={give}>
            Give {fmt(amount, base)} to {picked.c.name.split(' ')[0]}
          </button>
        </div>
      )}
    </Dialog>
  );
}
