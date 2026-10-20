import { useMemo, useState } from 'react';
import { useStore } from '../store/store';
import { balances, findCustomers } from '../domain/rules';
import { fmt } from '../domain/money';
import type { Customer } from '../domain/types';
import { describeCustomer } from './CustomerPicker';

/**
 * Search box + list of customers who have change with us.
 * Before anything is typed it lists the people most recently owed change,
 * so a returning customer is usually one tap away.
 */
export default function ChangeFinder({
  onPick,
  autoFocus = true,
  action = 'Choose',
}: {
  onPick: (c: Customer, balance: number) => void;
  autoFocus?: boolean;
  /** Text on the right of each row, e.g. "Give $6.00". */
  action?: string | ((c: Customer, balance: number) => string);
}) {
  const customers = useStore((s) => s.customers);
  const credit = useStore((s) => s.credit);
  const currencies = useStore((s) => s.currencies);
  const baseCode = useStore((s) => s.settings.baseCurrency);
  const base = currencies.find((c) => c.code === baseCode)!;
  const [q, setQ] = useState('');
  const bal = useMemo(() => balances(credit), [credit]);

  const rows = useMemo(() => {
    if (q.trim()) return findCustomers(customers, credit, q, { limit: 8, onlyWithBalance: true });
    return customers
      .filter((c) => (bal.get(c.id) ?? 0) > 0)
      .sort((a, b) => b.lastSeenAt.localeCompare(a.lastSeenAt))
      .slice(0, 6);
  }, [customers, credit, bal, q]);

  const label = (c: Customer, b: number) => (typeof action === 'function' ? action(c, b) : action);

  return (
    <div className="finder">
      <input
        id="finder-search"
        className="finder-input"
        autoFocus={autoFocus}
        autoComplete="off"
        placeholder="Name, phone or slip code"
        value={q}
        onChange={(e) => setQ(e.target.value)}
      />
      <div className="finder-hint muted">{q.trim() ? `${rows.length} found` : 'Recently owed change'}</div>
      <div className="finder-list">
        {rows.map((c) => {
          const b = bal.get(c.id) ?? 0;
          return (
            <button key={c.id} className="finder-row" onClick={() => onPick(c, b)}>
              <span className="grow">
                <b>{c.name}</b>
                <span className="sub">{describeCustomer(c) || 'No phone or note'}</span>
              </span>
              <span className="finder-bal">{fmt(b, base)}</span>
              <span className="finder-go">{label(c, b)}</span>
            </button>
          );
        })}
        {rows.length === 0 && (
          <div className="empty" style={{ padding: 20 }}>
            {q.trim() ? 'Nobody with change matches that. Try part of the name or the phone number.' : 'Nobody is owed change.'}
          </div>
        )}
      </div>
    </div>
  );
}
