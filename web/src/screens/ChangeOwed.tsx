import { useMemo, useState } from 'react';
import { getState, payOutChange, updateCustomer, useCurrentUser, useStore } from '../store/store';
import { balances, sameNameCustomers } from '../domain/rules';
import { fmt, round2 } from '../domain/money';
import { changeVoucherHTML, printTickets } from '../print/tickets';
import { Dialog, TopBar, toast } from '../components/ui';
import { describeCustomer } from '../components/CustomerPicker';
import CollectChangeDialog from '../components/CollectChangeDialog';
import { LuHandCoins, LuPrinter } from 'react-icons/lu';
import type { CreditEntry, Customer } from '../domain/types';

const KIND_LABEL: Record<CreditEntry['kind'], string> = {
  change_left: 'Change kept',
  used_for_food: 'Used for food',
  paid_out: 'Paid out in cash',
  cancel_adjust: 'Sale cancelled — put back',
  refund: 'Refund of cancelled sale',
};

const when = (iso: string) =>
  new Date(iso).toLocaleString([], { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

export default function CustomerChange() {
  const customers = useStore((s) => s.customers);
  const credit = useStore((s) => s.credit);
  const currencies = useStore((s) => s.currencies);
  const baseCode = useStore((s) => s.settings.baseCurrency);
  const base = currencies.find((c) => c.code === baseCode)!;
  const [q, setQ] = useState('');
  const [tab, setTab] = useState<'owed' | 'all'>('owed');
  const [open, setOpen] = useState<Customer | null>(null);
  const [collecting, setCollecting] = useState(false);

  const bal = useMemo(() => balances(credit), [credit]);
  const totalOwed = useMemo(() => round2([...bal.values()].reduce((a, b) => a + Math.max(0, b), 0)), [bal]);

  const list = useMemo(() => {
    const term = q.trim().toLowerCase();
    const digits = term.replace(/\D/g, '');
    const codeHit = new Set(credit.filter((e) => e.code && e.code.toLowerCase() === term).map((e) => e.customerId));
    return customers
      .filter((c) => tab === 'all' || (bal.get(c.id) ?? 0) > 0)
      .filter(
        (c) =>
          !term ||
          codeHit.has(c.id) ||
          c.name.toLowerCase().split(' ').some((w) => w.startsWith(term)) ||
          c.name.toLowerCase().startsWith(term) ||
          (c.note ?? '').toLowerCase().includes(term) ||
          (digits.length >= 3 && (c.phone ?? '').replace(/\D/g, '').includes(digits)),
      )
      .sort((a, b) => (bal.get(b.id) ?? 0) - (bal.get(a.id) ?? 0) || b.lastSeenAt.localeCompare(a.lastSeenAt));
  }, [customers, credit, bal, q, tab]);

  return (
    <div className="app">
      <TopBar title="Customer change">
        <button className="btn primary" onClick={() => setCollecting(true)}>
          <LuHandCoins aria-hidden="true" />
          Collect change
        </button>
      </TopBar>
      <div className="page">
        <div className="page-narrow">
          <div className="row wrap" style={{ marginBottom: 14 }}>
            <div className="tabs" style={{ margin: 0 }}>
              <button className={tab === 'owed' ? 'on' : ''} onClick={() => setTab('owed')}>
                Owed change
              </button>
              <button className={tab === 'all' ? 'on' : ''} onClick={() => setTab('all')}>
                All customers ({customers.length})
              </button>
            </div>
            <div className="grow" />
            <b>We are holding {fmt(totalOwed, base)} for customers</b>
          </div>
          <input
            id="change-search"
            className="amount-input"
            style={{ fontSize: 18, fontWeight: 500 }}
            placeholder="Search name, phone, note or slip code"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
          <div style={{ marginTop: 14, overflowX: 'auto' }}>
            <table className="list">
              <thead>
                <tr>
                  <th>Customer</th>
                  <th>Change held</th>
                  <th>Last here</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {list.map((c) => {
                  const b = bal.get(c.id) ?? 0;
                  const twins = sameNameCustomers(customers, c.name, c.id).length;
                  return (
                    <tr key={c.id} onClick={() => setOpen(c)} style={{ cursor: 'pointer' }}>
                      <td>
                        <b>{c.name}</b> {twins > 0 && <span className="tag">same name ×{twins + 1}</span>}
                        <div className="muted" style={{ fontSize: 13 }}>
                          {describeCustomer(c) || 'No phone or note'}
                        </div>
                      </td>
                      <td>
                        <span className={`tag ${b > 0 ? 'open' : 'paid'}`}>{b > 0 ? fmt(b, base) : 'Nothing'}</span>
                      </td>
                      <td className="muted">{when(c.lastSeenAt)}</td>
                      <td>
                        <button className="btn">Open</button>
                      </td>
                    </tr>
                  );
                })}
                {list.length === 0 && (
                  <tr>
                    <td colSpan={4} className="empty">
                      {tab === 'owed' ? 'Nobody is owed change.' : 'No customers found.'}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          <p className="muted" style={{ fontSize: 13 }}>
            Change is added at the till when a customer leaves it, and taken off when they use it for food or collect it.
          </p>
        </div>
      </div>
      {collecting && <CollectChangeDialog onClose={() => setCollecting(false)} />}
      {open && <CustomerDialog customerId={open.id} onClose={() => setOpen(null)} />}
    </div>
  );
}

function CustomerDialog({ customerId, onClose }: { customerId: string; onClose: () => void }) {
  const user = useCurrentUser()!;
  const customers = useStore((s) => s.customers);
  const credit = useStore((s) => s.credit);
  const staff = useStore((s) => s.staff);
  const currencies = useStore((s) => s.currencies);
  const baseCode = useStore((s) => s.settings.baseCurrency);
  const base = currencies.find((c) => c.code === baseCode)!;
  const c = customers.find((x) => x.id === customerId)!;
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState({ name: c.name, phone: c.phone ?? '', note: c.note ?? '' });

  const history = useMemo(() => {
    let running = 0;
    return credit
      .filter((e) => e.customerId === customerId)
      .sort((a, b) => a.at.localeCompare(b.at))
      .map((e) => ({ e, after: (running = round2(running + e.amount)) }))
      .reverse();
  }, [credit, customerId]);
  const balance = history[0]?.after ?? 0;
  const [amt, setAmt] = useState(String(balance));

  return (
    <Dialog
      title={c.name}
      onClose={onClose}
      width={640}
      footer={
        balance > 0 ? (
          <>
            <input
              id="payout-amount"
              inputMode="decimal"
              value={amt}
              onChange={(e) => setAmt(e.target.value.replace(/[^\d.]/g, ''))}
              style={{ width: 110, fontSize: 18, padding: '8px 10px', border: '1px solid var(--line)', borderRadius: 10 }}
              aria-label="Amount to pay out"
            />
            <button
              className="btn primary"
              onClick={() => {
                const r = payOutChange(c.id, Number(amt), user.id);
                if (!r.ok) return toast(r.error!);
                toast(`Paid ${fmt(Number(amt), base)} to ${c.name}`);
                setAmt('0');
              }}
            >
              Pay out cash
            </button>
          </>
        ) : undefined
      }
    >
      <div className="row wrap" style={{ alignItems: 'flex-start' }}>
        <div className="grow">
          {!editing ? (
            <>
              <div className="muted">{describeCustomer(c) || 'No phone or note'}</div>
              <button className="btn" style={{ marginTop: 8 }} onClick={() => setEditing(true)}>
                Edit details
              </button>
            </>
          ) : (
            <div>
              <div className="form-grid">
                <label className="field">
                  Name
                  <input id="edit-name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
                </label>
                <label className="field">
                  Phone
                  <input id="edit-phone" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
                </label>
                <label className="field">
                  Note
                  <input id="edit-note" value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} />
                </label>
              </div>
              <button
                className="btn primary"
                style={{ marginTop: 8 }}
                onClick={() => {
                  updateCustomer(c.id, { name: form.name, phone: form.phone.trim() || undefined, note: form.note.trim() || undefined });
                  setEditing(false);
                }}
              >
                Save
              </button>
            </div>
          )}
        </div>
        <div className="summary" style={{ minWidth: 180, textAlign: 'right' }}>
          <div className="muted">Change held</div>
          <div style={{ fontSize: 30, fontWeight: 900 }}>{fmt(balance, base)}</div>
        </div>
      </div>
      <div className="section-title">History</div>
      <table className="list">
        <tbody>
          {history.map(({ e, after }) => (
            <tr key={e.id}>
              <td className="muted" style={{ whiteSpace: 'nowrap' }}>
                {when(e.at)}
              </td>
              <td>
                {KIND_LABEL[e.kind]}
                {e.orderNumber != null && <span className="muted"> · order #{e.orderNumber}</span>}
                {e.code && <span className="muted"> · slip {e.code}</span>}
                <div className="muted" style={{ fontSize: 12 }}>
                  by {staff.find((s) => s.id === e.by)?.name ?? '—'}
                </div>
              </td>
              <td style={{ fontWeight: 700, color: e.amount > 0 ? 'var(--good)' : 'var(--bad)', whiteSpace: 'nowrap' }}>
                {e.amount > 0 ? '+' : '−'}
                {fmt(Math.abs(e.amount), base)}
              </td>
              <td className="muted" style={{ whiteSpace: 'nowrap' }}>
                = {fmt(after, base)}
              </td>
              <td>
                {e.kind === 'change_left' && (
                  <button className="btn" onClick={() => printTickets([changeVoucherHTML(e, c, balance, getState())])} aria-label="Reprint slip">
                    <LuPrinter aria-hidden="true" />
                  </button>
                )}
              </td>
            </tr>
          ))}
          {history.length === 0 && (
            <tr>
              <td className="muted">No change history yet.</td>
            </tr>
          )}
        </tbody>
      </table>
    </Dialog>
  );
}
