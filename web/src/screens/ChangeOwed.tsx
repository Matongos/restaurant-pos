import { useMemo, useState } from 'react';
import { getState, payOutChangeOwed, useCurrentUser, useStore } from '../store/store';
import { changeOwedBalance } from '../domain/rules';
import { fmt, fromBase, round2 } from '../domain/money';
import { changeVoucherHTML, printTickets } from '../print/tickets';
import { Dialog, TopBar, toast } from '../components/ui';
import type { ChangeOwed } from '../domain/types';

export default function ChangeOwedScreen() {
  const user = useCurrentUser()!;
  const all = useStore((s) => s.changeOwed);
  const currencies = useStore((s) => s.currencies);
  const staff = useStore((s) => s.staff);
  const baseCode = useStore((s) => s.settings.baseCurrency);
  const base = currencies.find((c) => c.code === baseCode)!;
  const [q, setQ] = useState('');
  const [tab, setTab] = useState<'open' | 'settled'>('open');
  const [paying, setPaying] = useState<ChangeOwed | null>(null);

  const list = useMemo(() => {
    const term = q.trim().toLowerCase();
    return all
      .filter((c) => (tab === 'open' ? changeOwedBalance(c) > 0 : changeOwedBalance(c) <= 0))
      .filter(
        (c) =>
          !term ||
          c.customerName.toLowerCase().includes(term) ||
          (c.phone ?? '').includes(term) ||
          c.code.toLowerCase().includes(term) ||
          String(c.orderNumber) === term,
      )
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }, [all, q, tab]);

  const totalOpen = round2(all.reduce((s, c) => s + Math.max(0, changeOwedBalance(c)), 0));
  const age = (iso: string) => {
    const days = Math.floor((Date.now() - Date.parse(iso)) / 86400000);
    return days === 0 ? 'today' : days === 1 ? 'yesterday' : `${days} days ago`;
  };

  return (
    <div className="app">
      <TopBar title="Change Owed" />
      <div className="page">
        <div className="page-narrow">
          <div className="row wrap" style={{ marginBottom: 14 }}>
            <div className="tabs" style={{ margin: 0 }}>
              <button className={tab === 'open' ? 'on' : ''} onClick={() => setTab('open')}>
                Still owed
              </button>
              <button className={tab === 'settled' ? 'on' : ''} onClick={() => setTab('settled')}>
                Settled
              </button>
            </div>
            <div className="grow" />
            <b>Total still owed: {fmt(totalOpen, base)}</b>
          </div>
          <input
            className="amount-input"
            style={{ fontSize: 18, fontWeight: 500 }}
            placeholder="Search name, phone, voucher code or order number"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
          <div style={{ marginTop: 14, overflowX: 'auto' }}>
            <table className="list">
              <thead>
                <tr>
                  <th>Customer</th>
                  <th>Code</th>
                  <th>Owed</th>
                  <th>Balance</th>
                  <th>When</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {list.map((c) => {
                  const bal = changeOwedBalance(c);
                  const cur = currencies.find((x) => x.code === c.currency) ?? base;
                  return (
                    <tr key={c.id}>
                      <td>
                        <b>{c.customerName}</b>
                        <div className="muted" style={{ fontSize: 13 }}>
                          {c.phone ?? '—'} · order #{c.orderNumber} · by {staff.find((s) => s.id === c.createdBy)?.name}
                        </div>
                      </td>
                      <td>
                        <span className="tag">{c.code}</span>
                      </td>
                      <td>{fmt(c.amount, base)}</td>
                      <td>
                        <span className={`tag ${bal > 0 ? 'open' : 'paid'}`}>
                          {bal > 0 ? `${fmt(bal, base)}${cur.code !== base.code ? ` (${fmt(fromBase(bal, cur), cur)})` : ''}` : 'Paid'}
                        </span>
                      </td>
                      <td className="muted">{age(c.createdAt)}</td>
                      <td style={{ whiteSpace: 'nowrap' }}>
                        {bal > 0 && (
                          <button className="btn primary" onClick={() => setPaying(c)}>
                            Pay out
                          </button>
                        )}{' '}
                        <button className="btn" onClick={() => printTickets([changeVoucherHTML(c, getState())])} aria-label="Reprint voucher">
                          🖨
                        </button>
                      </td>
                    </tr>
                  );
                })}
                {list.length === 0 && (
                  <tr>
                    <td colSpan={6} className="empty">
                      Nothing here.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
      {paying && (
        <PayOutDialog
          c={paying}
          onClose={() => setPaying(null)}
          onPay={(amount, method) => {
            payOutChangeOwed(paying.id, amount, user.id, method);
            toast(method === 'cash' ? `Paid ${fmt(amount, base)} to ${paying.customerName}` : `Used ${fmt(amount, base)} as credit`);
            setPaying(null);
          }}
        />
      )}
    </div>
  );
}

function PayOutDialog({ c, onClose, onPay }: { c: ChangeOwed; onClose: () => void; onPay: (amount: number, method: 'cash' | 'credit') => void }) {
  const currencies = useStore((s) => s.currencies);
  const baseCode = useStore((s) => s.settings.baseCurrency);
  const base = currencies.find((x) => x.code === baseCode)!;
  const bal = changeOwedBalance(c);
  const [amt, setAmt] = useState(String(bal));
  const n = Math.min(bal, Number(amt) || 0);
  return (
    <Dialog
      title={`Pay ${c.customerName}`}
      onClose={onClose}
      width={520}
      footer={
        <>
          <button className="btn" disabled={!(n > 0)} onClick={() => onPay(n, 'credit')}>
            Use as credit on food
          </button>
          <button className="btn primary" disabled={!(n > 0)} onClick={() => onPay(n, 'cash')}>
            Pay out cash
          </button>
        </>
      }
    >
      <p>
        Balance: <b>{fmt(bal, base)}</b> (voucher {c.code})
      </p>
      <label className="field">
        Amount to settle now (can be part of it)
        <input inputMode="decimal" value={amt} onChange={(e) => setAmt(e.target.value.replace(/[^\d.]/g, ''))} />
      </label>
    </Dialog>
  );
}
