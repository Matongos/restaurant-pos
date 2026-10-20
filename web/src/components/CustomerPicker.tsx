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

/**
 * Ready to save change against?
 * A typed name is enough on its own. Only when someone with exactly that name
 * already exists must the cashier say "same person" (pick them) or add a phone/note.
 */
export function selectionReady(sel: CustomerSelection, customers: Customer[]): boolean {
  if (sel.kind === 'existing') return true;
  if (sel.kind === 'none') return false;
  const name = tidyName(sel.name);
  if (name.length < 2) return false;
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
  const bal = useMemo(() => balances(credit), [credit]);
  const [showDetails, setShowDetails] = useState(false);

  const typed = value.kind === 'new' ? value.name : '';
  const phone = value.kind === 'new' ? value.phone : '';
  const note = value.kind === 'new' ? value.note : '';
  const twins = useMemo(() => (typed.trim() ? sameNameCustomers(customers, typed) : []), [customers, typed]);
  const similar = useMemo(
    () => (typed.trim().length >= 2 ? findCustomers(customers, credit, typed, { limit: 4 }).filter((c) => !twins.includes(c)) : []),
    [customers, credit, typed, twins],
  );
  const names = useMemo(
    () => nameSuggestions(typed, customers.map((c) => c.name), 4).filter((n) => !typed.toLowerCase().startsWith(n.toLowerCase() + ' ')),
    [typed, customers],
  );

  const setText = (name: string) =>
    onChange(name.trim() ? { kind: 'new', name, phone, note } : { kind: 'none' });

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
            {b > 0 && ` · already has ${fmt(b, base)}`}
          </div>
        </div>
        <button className="btn" onClick={() => onChange({ kind: 'new', name: c.name, phone: '', note: '' })}>
          Not them
        </button>
      </div>
    );
  }

  const needDetail = twins.length > 0;
  const detailsOpen = showDetails || needDetail;

  return (
    <div className="cust-pick">
      <label className="field" style={{ marginTop: 0 }}>
        {label}
        <input
          id="cust-name"
          autoFocus={autoFocus}
          autoComplete="off"
          placeholder="Type their name"
          value={typed}
          onChange={(e) => setText(e.target.value)}
        />
      </label>

      {names.length > 0 && !twins.length && (
        <div className="name-sugg">
          {names.map((n) => (
            <button key={n} onClick={() => setText(n)}>
              {n}
            </button>
          ))}
        </div>
      )}

      {needDetail && (
        <div className="twin-ask">
          <div>
            <b>{tidyName(typed)}</b> is already a customer. Is it the same person?
          </div>
          {twins.map((c) => (
            <button key={c.id} className="cust-opt" onClick={() => onChange({ kind: 'existing', id: c.id })}>
              <span className="grow">
                <b>Yes — {c.name}</b>
                <span className="sub">
                  {describeCustomer(c) || 'No phone or note'} · last here {lastSeen(c.lastSeenAt)}
                </span>
              </span>
              {(bal.get(c.id) ?? 0) > 0 && <span className="tag open">{fmt(bal.get(c.id)!, base)}</span>}
            </button>
          ))}
          <div className="muted" style={{ fontSize: 13 }}>
            A different person? Add their phone or a note below so you can tell them apart.
          </div>
        </div>
      )}

      {!needDetail && similar.length > 0 && (
        <div className="similar">
          <span className="muted">Or is it:</span>
          {similar.map((c) => (
            <button key={c.id} className="chip-btn" onClick={() => onChange({ kind: 'existing', id: c.id })}>
              {c.name}
              {describeCustomer(c) && <span className="muted"> · {describeCustomer(c)}</span>}
            </button>
          ))}
        </div>
      )}

      {typed.trim() &&
        (detailsOpen ? (
          <div className="form-grid">
            <label className="field">
              Phone {needDetail ? '' : '(optional)'}
              <input
                id="cust-phone"
                inputMode="tel"
                value={phone}
                onChange={(e) => onChange({ kind: 'new', name: typed, phone: e.target.value, note })}
                className={needDetail && !phone && !note ? 'need' : undefined}
              />
            </label>
            <label className="field">
              Note {needDetail ? '' : '(optional)'}
              <input
                id="cust-note"
                placeholder="e.g. Mbare, nurse, red cap"
                value={note}
                onChange={(e) => onChange({ kind: 'new', name: typed, phone, note: e.target.value })}
                className={needDetail && !phone && !note ? 'need' : undefined}
              />
            </label>
          </div>
        ) : (
          <button className="link-btn" onClick={() => setShowDetails(true)}>
            + Add phone or note (optional)
          </button>
        ))}
    </div>
  );
}
