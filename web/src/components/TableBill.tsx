import { useEffect, useState } from 'react';
import { billTable, getState, setTabSplit, useCurrentUser, useStore } from '../store/store';
import { fmt, round2 } from '../domain/money';
import { lineLabel } from '../domain/rules';
import { equalShares, tabDue, tabItemsTotal, tabPaid, tabRounds, tabTotal } from '../domain/tables';
import type { TableInfo } from '../domain/types';
import { printTickets, tableBillHTML } from '../print/tickets';
import { Dialog } from './ui';
import { LuCircleCheck, LuCoins, LuEqual, LuListChecks, LuMinus, LuPlus, LuPrinter, LuReceipt } from 'react-icons/lu';

type Mode = NonNullable<TableInfo['split']>['mode'];
const MODES: [Mode, string, typeof LuReceipt][] = [
  ['one', 'One bill', LuReceipt],
  ['equal', 'Split equally', LuEqual],
  ['item', 'By item', LuListChecks],
  ['amount', 'By amount', LuCoins],
];

/**
 * A table's bill: print it, then take payment as one bill, split equally, by item or by amount.
 * Each share is paid on the normal payment screen (onPay). The table closes when nothing is left.
 */
export default function TableBill({ tabId, onClose, onPay }: { tabId: string; onClose: () => void; onPay: (label: string, amount: number) => void }) {
  const user = useCurrentUser()!;
  const orders = useStore((s) => s.orders);
  const base = useStore((s) => s.currencies.find((c) => c.code === s.settings.baseCurrency)!);
  const scPct = useStore((s) => s.settings.serviceChargePct ?? 0);
  const tab = orders.find((o) => o.id === tabId);
  const [amountStr, setAmountStr] = useState('');

  // Opening the bill prints it (in the till's sense): service charge added, table shown as waiting to pay.
  useEffect(() => {
    const t = getState().orders.find((o) => o.id === tabId);
    if (t?.table && t.table.status !== 'billed' && t.table.status !== 'paid') billTable(tabId, user.id);
  }, [tabId, user.id]);

  if (!tab?.table) return null;
  const rounds = tabRounds(orders, tab);
  const total = tabTotal(orders, tab);
  const paid = tabPaid(tab);
  const due = tabDue(orders, tab);
  const shares = tab.table.shares ?? [];
  const split = tab.table.split ?? { mode: 'one' as Mode, people: Math.max(2, tab.table.guests ?? 2) };
  const save = (p: Partial<NonNullable<TableInfo['split']>>) => setTabSplit(tab.id, { ...split, ...p });
  const paidLabel = (label: string) => shares.some((x) => x.label === label);
  const name = (i: number) => split.names?.[i] || `Person ${i + 1}`;

  // ---- by item: who had what (a line not given to anyone is shared by everyone)
  const items = rounds.flatMap((o) => o.lines.map((l) => ({ key: `${o.id}:${l.id}`, label: `${l.qty} × ${lineLabel(l)}`, amount: round2(l.qty * l.unitPrice) })));
  const assign = split.assign ?? {};
  const itemsTotal = tabItemsTotal(orders, tab);
  const byItem = (() => {
    const n = split.people;
    const raw = Array.from({ length: n }, () => 0);
    for (const it of items) {
      const who = assign[it.key];
      if (who !== undefined && who >= 0 && who < n) raw[who] += it.amount;
      else for (let i = 0; i < n; i++) raw[i] += it.amount / n;
    }
    // Service charge in proportion; cents corrected on the last person so the shares add up exactly.
    const scale = itemsTotal > 0 ? total / itemsTotal : 1;
    const cents = raw.map((v) => Math.round(v * scale * 100));
    cents[n - 1] += Math.round(total * 100) - cents.reduce((a, b) => a + b, 0);
    return cents.map((c) => c / 100);
  })();
  const unassigned = items.filter((it) => assign[it.key] === undefined || assign[it.key] < 0).length;

  const rowsFor = (amounts: number[]) =>
    amounts.map((a, i) => {
      const label = name(i);
      const done = paidLabel(label);
      const amt = done ? shares.filter((x) => x.label === label).reduce((s, x) => s + x.amount, 0) : Math.min(a, due);
      return (
        <div key={i} className={`person ${done ? 'paid' : ''}`}>
          <span className="av">{i + 1}</span>
          <span className="who">
            <b>{label}</b>
            <small>{done ? 'Paid' : 'Cash, EcoCash, any currency…'}</small>
          </span>
          <span className="amt tnum">{fmt(amt, base)}</span>
          {done ? (
            <span className="paid-tag">
              <LuCircleCheck aria-hidden="true" /> Paid
            </span>
          ) : (
            <button className="btn primary" disabled={!(amt > 0)} onClick={() => onPay(label, amt)}>
              Pay
            </button>
          )}
        </div>
      );
    });

  const partAmount = Math.min(due, Number(amountStr) || 0);

  return (
    <Dialog
      title={`Bill · ${tab.table.name}`}
      onClose={onClose}
      width={720}
      className="bill-dialog"
      footer={
        <>
          <button className="btn" onClick={() => printTickets([tableBillHTML(tab, rounds, getState())])}>
            <LuPrinter aria-hidden="true" />
            Print bill
          </button>
          <button className="btn" onClick={onClose}>
            {due > 0 ? 'Back to the table' : 'Close'}
          </button>
        </>
      }
    >
      <div className="bill-sum">
        <div>
          <small>Food &amp; drinks</small>
          <b className="tnum">{fmt(itemsTotal, base)}</b>
        </div>
        {!!tab.table.serviceCharge && (
          <div>
            <small>Service charge ({scPct}%)</small>
            <b className="tnum">{fmt(tab.table.serviceCharge, base)}</b>
          </div>
        )}
        <div>
          <small>Total</small>
          <b className="tnum">{fmt(total, base)}</b>
        </div>
        <div>
          <small>Paid</small>
          <b className="tnum" style={{ color: paid > 0 ? 'var(--good)' : undefined }}>
            {fmt(paid, base)}
          </b>
        </div>
        <div className="due">
          <small>Still to pay</small>
          <b className="tnum">{fmt(due, base)}</b>
        </div>
      </div>

      <div className="split-modes" role="tablist" aria-label="How to pay">
        {MODES.map(([m, label, Icon]) => (
          <button key={m} role="tab" aria-selected={split.mode === m} className={split.mode === m ? 'on' : ''} onClick={() => save({ mode: m })}>
            <Icon aria-hidden="true" />
            {label}
          </button>
        ))}
      </div>

      {split.mode === 'one' && (
        <div className="people">
          {due > 0 ? (
            <div className="person">
              <span className="av">
                <LuReceipt aria-hidden="true" />
              </span>
              <span className="who">
                <b>Whole bill</b>
                <small>One person pays everything{paid > 0 ? ' that is left' : ''}</small>
              </span>
              <span className="amt tnum">{fmt(due, base)}</span>
              <button className="btn primary" onClick={() => onPay('Whole bill', due)}>
                Pay
              </button>
            </div>
          ) : (
            <div className="empty">Paid in full.</div>
          )}
        </div>
      )}

      {(split.mode === 'equal' || split.mode === 'item') && (
        <div className="guest-stepper" style={{ marginBottom: 12 }}>
          <span>Split between</span>
          <button className="btn icon-only" onClick={() => save({ people: Math.max(2, split.people - 1) })} aria-label="One person less">
            <LuMinus aria-hidden="true" />
          </button>
          <b>{split.people}</b>
          <button className="btn icon-only" onClick={() => save({ people: Math.min(30, split.people + 1) })} aria-label="One person more">
            <LuPlus aria-hidden="true" />
          </button>
          <span>people</span>
        </div>
      )}

      {split.mode === 'equal' && <div className="people">{rowsFor(equalShares(total, split.people))}</div>}

      {split.mode === 'item' && (
        <>
          <p className="muted" style={{ margin: '0 0 8px' }}>
            Tap who had each item. Anything not given to one person is shared by everyone{unassigned ? ` (${unassigned} shared now)` : ''}.
          </p>
          <div className="bill-items">
            {items.map((it) => (
              <div key={it.key} className="bill-item">
                <span className="nm">{it.label}</span>
                <span className="pr tnum">{fmt(it.amount, base)}</span>
                <span className="who">
                  {Array.from({ length: split.people }, (_, i) => (
                    <button key={i} className={assign[it.key] === i ? 'on' : ''} onClick={() => save({ assign: { ...assign, [it.key]: assign[it.key] === i ? -1 : i } })}>
                      {name(i)}
                    </button>
                  ))}
                  <button className={assign[it.key] === undefined || assign[it.key] < 0 ? 'sh' : ''} onClick={() => save({ assign: { ...assign, [it.key]: -1 } })}>
                    Shared
                  </button>
                </span>
              </div>
            ))}
          </div>
          <div className="section-title">Each person pays</div>
          <div className="people">{rowsFor(byItem)}</div>
        </>
      )}

      {split.mode === 'amount' && (
        <>
          <p className="muted" style={{ marginTop: 0 }}>
            Someone pays part of the bill ("I'll pay $20"); the rest stays open for the next person.
          </p>
          <div className="row" style={{ gap: 8 }}>
            <input className="plain-input grow" style={{ marginTop: 0 }} inputMode="decimal" placeholder={`Amount (up to ${fmt(due, base)})`} value={amountStr} onChange={(e) => setAmountStr(e.target.value.replace(/[^\d.]/g, ''))} />
            <button
              className="btn primary"
              disabled={!(partAmount > 0)}
              onClick={() => {
                onPay(`Part payment ${shares.length + 1}`, round2(partAmount));
                setAmountStr('');
              }}
            >
              Pay {partAmount > 0 ? fmt(partAmount, base) : ''}
            </button>
            <button className="btn" disabled={!(due > 0)} onClick={() => onPay(`Part payment ${shares.length + 1}`, due)}>
              Pay the rest ({fmt(due, base)})
            </button>
          </div>
        </>
      )}

      {shares.length > 0 && (
        <>
          <div className="section-title">Paid so far</div>
          <div className="paid-list">
            {shares.map((x) => (
              <div key={x.id}>
                <span>
                  {x.label} · {new Date(x.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                </span>
                <b className="tnum">{fmt(x.amount, base)}</b>
              </div>
            ))}
          </div>
        </>
      )}
    </Dialog>
  );
}

