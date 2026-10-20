import { useMemo, useState } from 'react';
import { useStore } from '../store/store';
import { balances, findCustomers, sameNameCustomers, tidyName } from '../domain/rules';
import { nameSuggestions } from '../data/names';
import { fmt } from '../domain/money';
import type { Customer } from '../domain/types';

export type CustomerSelection =
  | { kind: 'none' }
  | { kind: 'existing'; id: string }
  | { kind: 'new'; name: string; phone: string; note: string };

/** True when the selection is complete enough to save change against. */
export function selectionReady(sel: CustomerSelection, customers: Customer[]): boolean {
  if (sel.kind === 'existing') return true;
  if (sel.kind === 'none') return false;
  const name = tidyName(sel.name);
  if (name.length < 2) return false;
  // Same name already on file: need a phone or a note to tell them apart.
  if (sameNameCustomers(customers, name).length > 0) return !!(sel.phone.trim() || sel.note.trim());
  return true;
}

export function describeCustomer(c: Customer): string {
  return [c.phone, c.note].filter(Boolean).join(' · ');
}

function lastSeen(iso: string) {
  const d = Math.floor((Date.now() - Date.parse(iso)) / 86400000);
  return d <= 0 ? 'today' : d === 1 ? 'yesterday' : `${d} days ago`;
}

export default function CustomerPicker({
  value,
  onChange,
  autoFocus,
  label = 'Customer name',
}: {
  value: CustomerSelection;
  onChange: (v: CustomerSelection) => void;
  autoFocus?: boolean;
  label?: string;
}) {
  const customers = useStore((s) => s.customers);
  const credit = useStore((s) => s.credit);
  const baseCode = useStore((s) => s.settings.baseCurrency);
  const currencies = useStore((s) => s.currencies);
  const base = currencies.find((c) => c.code === baseCode)!;
  const [typed, setTyped] = useState('');
  const bal = useMemo(() => balances(credit), [credit]);

  const matches = useMemo(() => findCustomers(customers, credit, typed), [customers, credit, typed]);
  const suggestions = useMemo(
    () =>
      nameSuggestions(
        typed,
        customers.map((c) => c.name),
      ).filter((n) => !matches.some((m) => m.name.toLowerCase() === n.toLowerCase())),
    [typed, customers, matches],
  );

  if (value.kind === 'existing') {
    const c = customers.find((x) => x.id === value.id);
    if (!c) return null;
    const b = bal.get(c.id) ?? 0;
    return (
      <div className="cust-chosen">
        <div className="grow">
          <b>{c.name}</b>
          <div className="muted" style={{ fontSize: 13 }}>
            {describeCustomer(c) || 'No phone or note'} · last here {lastSeen(c.lastSeenAt)}
          </div>
        </div>
        <span className={`tag ${b > 0 ? 'open' : ''}`}>{b > 0 ? `${fmt(b, base)} change` : 'No change'}</span>
        <button className="btn" onClick={() => onChange({ kind: 'none' })}>
          Change
        </button>
      </div>
    );
  }

  if (value.kind === 'new') {
    const twins = sameNameCustomers(customers, value.name);
    const needsDetail = twins.length > 0 && !(value.phone.trim() || value.note.trim());
    return (
      <div className="cust-new">
        <div className="row">
          <b className="grow">New customer: {tidyName(value.name)}</b>
          <button className="btn" onClick={() => onChange({ kind: 'none' })}>
            Change
          </button>
        </div>
        {twins.length > 0 && (
          <div className="twin-warn">
            {twins.length === 1 ? 'There is already a customer' : `There are already ${twins.length} customers`} called{' '}
            <b>{tidyName(value.name)}</b> ({twins.map((t) => describeCustomer(t) || 'no details').join('; ')}). Add a phone or a note so you
            can tell them apart — or pick them above if it is the same person.
          </div>
        )}
        <div className="form-grid">
          <label className="field">
            Phone {twins.length ? '' : '(optional)'}
            <input
              id="cust-phone"
              inputMode="tel"
              value={value.phone}
              onChange={(e) => onChange({ ...value, phone: e.target.value })}
              style={needsDetail ? { borderColor: 'var(--warn)' } : undefined}
            />
          </label>
          <label className="field">
            Note to recognise them (optional)
            <input
              id="cust-note"
              placeholder="e.g. Mbare, nurse, red cap"
              value={value.note}
              onChange={(e) => onChange({ ...value, note: e.target.value })}
              style={needsDetail ? { borderColor: 'var(--warn)' } : undefined}
            />
          </label>
        </div>
      </div>
    );
  }

  return (
    <div className="cust-pick">
      <label className="field" style={{ marginTop: 0 }}>
        {label}
        <input
          id="cust-search"
          autoFocus={autoFocus}
          autoComplete="off"
          placeholder="Type a name or phone"
          value={typed}
          onChange={(e) => setTyped(e.target.value)}
        />
      </label>
      {typed.trim() && (
        <div className="cust-list">
          {matches.map((c) => {
            const b = bal.get(c.id) ?? 0;
            return (
              <button key={c.id} className="cust-opt" onClick={() => onChange({ kind: 'existing', id: c.id })}>
                <span className="grow">
                  <b>{c.name}</b>
                  <span className="muted"> {describeCustomer(c) && `· ${describeCustomer(c)}`}</span>
                  <span className="sub">last here {lastSeen(c.lastSeenAt)}</span>
                </span>
                {b > 0 && <span className="tag open">{fmt(b, base)}</span>}
              </button>
            );
          })}
          {suggestions.length > 0 && (
            <div className="name-sugg">
              {suggestions.map((n) => (
                <button key={n} onClick={() => setTyped(n + ' ')}>
                  {n}
                </button>
              ))}
            </div>
          )}
          {tidyName(typed).length >= 2 && (
            <button className="cust-opt new" onClick={() => onChange({ kind: 'new', name: tidyName(typed), phone: '', note: '' })}>
              + New customer “{tidyName(typed)}”
            </button>
          )}
        </div>
      )}
    </div>
  );
}
