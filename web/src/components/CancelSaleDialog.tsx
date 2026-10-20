import { useMemo, useState } from 'react';
import { cancelOrder, useCurrentUser, useStore } from '../store/store';
import { fmt, round2 } from '../domain/money';
import { CREDIT_METHOD, type Order, type RefundMethod } from '../domain/types';
import { Dialog, toast } from './ui';

const REASONS = ['Customer changed their mind', 'Wrong item entered', 'Meal ran out', 'Entered twice', 'Food complaint'];

/**
 * Cancel a sale. Nothing is deleted: the sale stays in the journal marked "cancelled",
 * with the reason, the refund and the manager who approved it.
 */
export default function CancelSaleDialog({ order, onClose }: { order: Order; onClose: () => void }) {
  const user = useCurrentUser()!;
  const orders = useStore((s) => s.orders);
  const customers = useStore((s) => s.customers);
  const methods = useStore((s) => s.paymentMethods);
  const currencies = useStore((s) => s.currencies);
  const baseCode = useStore((s) => s.settings.baseCurrency);
  const base = currencies.find((c) => c.code === baseCode)!;
  const customer = customers.find((c) => c.id === order.customerId);

  const group = useMemo(() => orders.filter((o) => (o.id === order.id || o.parentOrderId === order.id) && o.status !== 'cancelled'), [orders, order.id]);
  const total = round2(group.reduce((s, o) => s + o.total, 0));
  const changeUsed = round2(group.flatMap((o) => o.payments).filter((p) => p.methodId === CREDIT_METHOD).reduce((s, p) => s + p.baseAmount, 0));
  const refundable = round2(Math.max(0, total - changeUsed));

  const [reason, setReason] = useState('');
  const [refund, setRefund] = useState<RefundMethod>(refundable > 0 ? 'cash' : 'none');
  const [pin, setPin] = useState('');
  const [error, setError] = useState('');

  const paidWith = group
    .flatMap((o) => o.payments)
    .map((p) => `${p.methodId === CREDIT_METHOD ? 'Customer change' : methods.find((m) => m.id === p.methodId)?.name ?? p.methodId} ${fmt(p.amount, currencies.find((c) => c.code === p.currency))}`)
    .join(' + ');

  const go = () => {
    const r = cancelOrder({ orderId: order.id, reason, refund, requestedBy: user.id, approverPin: pin });
    if (!r.ok) {
      setError(r.error);
      setPin('');
      return;
    }
    toast(`Sale #${order.number} cancelled${r.cancellation.refundAmount > 0 ? ` — refund ${fmt(r.cancellation.refundAmount, base)}` : ''}`);
    onClose();
  };

  const ready = reason.trim().length > 0 && pin.length === 4;

  return (
    <Dialog
      title={`Cancel sale #${order.number}`}
      onClose={onClose}
      width={600}
      footer={
        <>
          <button className="btn" onClick={onClose}>
            Keep the sale
          </button>
          <button className={`btn ${ready ? 'danger-fill' : 'blocked'}`} aria-disabled={!ready} onClick={() => ready && go()}>
            {!reason.trim() ? 'Choose a reason' : pin.length < 4 ? 'Manager PIN needed' : 'Cancel this sale'}
          </button>
        </>
      }
    >
      <div className="cancel-summary">
        <div>
          {group.flatMap((o) => o.lines).map((l) => (
            <div key={l.id}>
              {l.qty} × {l.name}
            </div>
          ))}
          <div className="muted" style={{ fontSize: 13, marginTop: 4 }}>
            Paid: {paidWith || '—'} · {new Date(order.createdAt).toLocaleString([], { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}
          </div>
        </div>
        <b style={{ fontSize: 22 }}>{fmt(total, base)}</b>
      </div>

      <div className="step-label" style={{ marginTop: 14 }}>
        Why?
      </div>
      <div className="seg small">
        {REASONS.map((r) => (
          <button key={r} className={reason === r ? 'on' : ''} onClick={() => setReason(r)}>
            {r}
          </button>
        ))}
      </div>
      <input
        id="cancel-reason"
        className="plain-input"
        placeholder="Or type the reason"
        value={REASONS.includes(reason) ? '' : reason}
        onChange={(e) => setReason(e.target.value)}
      />

      <div className="step-label" style={{ marginTop: 14 }}>
        Money back
      </div>
      <div className="seg">
        {refundable > 0 && (
          <button className={refund === 'cash' ? 'on' : ''} onClick={() => setRefund('cash')}>
            Give back {fmt(refundable, base)} cash
          </button>
        )}
        {refundable > 0 && customer && (
          <button className={refund === 'to_change' ? 'on' : ''} onClick={() => setRefund('to_change')}>
            Add {fmt(refundable, base)} to {customer.name.split(' ')[0]}'s change
          </button>
        )}
        <button className={refund === 'none' ? 'on' : ''} onClick={() => setRefund('none')}>
          No money back
        </button>
      </div>
      {changeUsed > 0 && (
        <div className="muted" style={{ fontSize: 13, marginTop: 6 }}>
          {fmt(changeUsed, base)} of {customer?.name ?? 'the customer'}'s change used on this sale goes back onto their balance.
        </div>
      )}

      <div className="step-label" style={{ marginTop: 14 }}>
        Manager or owner approves
      </div>
      <input
        id="manager-pin"
        className="pin-input"
        type="password"
        inputMode="numeric"
        autoComplete="off"
        maxLength={4}
        placeholder="PIN"
        value={pin}
        onChange={(e) => {
          setError('');
          setPin(e.target.value.replace(/\D/g, '').slice(0, 4));
        }}
        onKeyDown={(e) => e.key === 'Enter' && ready && go()}
      />
      {error && <div className="error" style={{ marginTop: 6 }}>{error}</div>}
      <p className="muted" style={{ fontSize: 13 }}>
        The sale stays in the records, marked cancelled, with this reason and the approving manager.
      </p>
    </Dialog>
  );
}
