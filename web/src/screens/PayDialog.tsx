import { useEffect, useMemo, useRef, useState } from 'react';
import { placeOrder, setLiveCart, useStore, type CustomerRef, type PlaceOrderSuccess } from '../store/store';
import { fmt, fromBase, round2, toBase } from '../domain/money';
import { cardsInUse, customerBalance, nextFreeCard, tidyName } from '../domain/rules';
import { CREDIT_METHOD, type OrderLine, type Payment } from '../domain/types';
import { Dialog, toast } from '../components/ui';
import CustomerPicker, { selectionReady, type CustomerSelection } from '../components/CustomerPicker';
import ChangeFinder from '../components/ChangeFinder';

interface Props {
  tillId: string;
  total: number;
  orderTypeId: string;
  lines: OrderLine[];
  parentOrderId?: string;
  cashierId: string;
  onCancel: () => void;
  onDone: (r: PlaceOrderSuccess) => void;
}

/**
 * Payment, top to bottom:
 *   1. How they pay (Cash / EcoCash / … / Their change) and the currency.
 *   2. Amount received — typing it updates everything at once (no "Add").
 *   3. The status panel on the right says SHORT / NO CHANGE / GIVE CHANGE.
 *      Keeping change for the customer, and their name, happen right there.
 *   4. The confirm button always says what it will do, or what is missing.
 */
export default function PayDialog({ tillId, total, orderTypeId, lines, parentOrderId, cashierId, onCancel, onDone }: Props) {
  const currencies = useStore((s) => s.currencies);
  const methods = useStore((s) => s.paymentMethods);
  const settings = useStore((s) => s.settings);
  const orders = useStore((s) => s.orders);
  const customers = useStore((s) => s.customers);
  const credit = useStore((s) => s.credit);

  const enabledCur = useMemo(() => currencies.filter((c) => c.enabled), [currencies]);
  const enabledMethods = useMemo(() => methods.filter((m) => m.enabled), [methods]);
  const base = currencies.find((c) => c.code === settings.baseCurrency)!;

  // ---- what is being paid
  const [methodId, setMethodId] = useState(enabledMethods.find((m) => m.isCash)?.id ?? enabledMethods[0]?.id ?? 'cash');
  const [curCode, setCurCode] = useState(base.code);
  const [amountStr, setAmountStr] = useState('');
  const [reference, setReference] = useState('');
  const [split, setSplit] = useState<Payment[]>([]); // earlier parts of a split payment
  const [changeOf, setChangeOf] = useState<string | null>(null); // customer paying with their change
  const [findingChange, setFindingChange] = useState(false);
  const amountRef = useRef<HTMLInputElement>(null);

  // ---- change handed back / kept
  const [changeCode, setChangeCode] = useState(base.code);
  const [handStr, setHandStr] = useState<string | null>(null);
  const [keepFor, setKeepFor] = useState<CustomerSelection>({ kind: 'none' });

  // ---- order number
  const needsCard = !parentOrderId && settings.numberMode !== 'slip';
  const suggested = useMemo(() => nextFreeCard(orders, settings.cardFrom, settings.cardTo), [orders, settings.cardFrom, settings.cardTo]);
  const [cardStr, setCardStr] = useState(suggested ? String(suggested) : '');
  const inUse = useMemo(() => cardsInUse(orders), [orders]);
  const card = Number(cardStr);
  const cardProblem = !needsCard
    ? ''
    : !cardStr
      ? 'Enter card number'
      : card < settings.cardFrom || card > settings.cardTo
        ? `Cards run ${settings.cardFrom}–${settings.cardTo}`
        : '';
  // Not blocking: nobody may have pressed "Served", so if the cashier holds the card it is back.
  const cardWarn = needsCard && !cardProblem && inUse.has(card) ? `Card ${card} was not marked served — it will be closed now` : '';

  const cur = enabledCur.find((c) => c.code === curCode) ?? base;
  const method = enabledMethods.find((m) => m.id === methodId);
  const changeCur = enabledCur.find((c) => c.code === changeCode) ?? base;

  // ---- money maths (all in base currency unless named "InCur")
  const changeCustomer = changeOf ? customers.find((c) => c.id === changeOf) : undefined;
  const changeBalance = changeOf ? customerBalance(credit, changeOf) : 0;
  const creditUsed = round2(Math.min(changeBalance, total));
  const splitBase = round2(split.reduce((s, p) => s + p.baseAmount, 0));
  const dueBeforeEntry = round2(Math.max(0, total - creditUsed - splitBase));
  const entered = Number(amountStr) || 0;
  const enteredBase = toBase(entered, cur);
  const paidBase = round2(creditUsed + splitBase + enteredBase);
  const shortBase = round2(Math.max(0, total - paidBase));
  const changeBase = round2(Math.max(0, paidBase - total));
  const changeInCur = fromBase(changeBase, changeCur);
  const hand = handStr === null ? changeInCur : Math.min(changeInCur, Math.max(0, Number(handStr) || 0));
  const keepInCur = round2(Math.max(0, changeInCur - hand));
  const keepBase = toBase(keepInCur, changeCur);

  // Whose change balance does kept change go to? The change payer, if any.
  const keepSelection: CustomerSelection = changeOf ? { kind: 'existing', id: changeOf } : keepFor;
  const keepReady = keepBase <= 0 || selectionReady(keepSelection, customers);
  const keepName =
    keepSelection.kind === 'existing'
      ? customers.find((c) => c.id === keepSelection.id)?.name ?? ''
      : keepSelection.kind === 'new'
        ? tidyName(keepSelection.name)
        : '';
  const nonCashOver = !method?.isCash && entered > 0 && changeBase > 0;

  // ---- what the confirm button says
  let blocker = '';
  if (paidBase <= 0 && total > 0) blocker = 'Enter amount received';
  else if (shortBase > 0) blocker = `Short by ${fmt(shortBase, base)}`;
  else if (nonCashOver) blocker = `${method?.name} amount is more than the total`;
  else if (method?.requiresReference && entered > 0 && !reference.trim()) blocker = `Enter ${method.name} reference`;
  else if (!keepReady) blocker = keepSelection.kind === 'none' ? 'Type name for kept change' : 'Same person? Tap them or add phone';
  else if (cardProblem) blocker = cardProblem;
  const confirmLabel = blocker || (hand > 0 ? `Confirm · give ${fmt(hand, changeCur)} change` : 'Confirm & send to kitchen');

  // Customer display follows every keystroke.
  useEffect(() => {
    setLiveCart(tillId, {
      orderTypeId,
      lines,
      total,
      paid: paidBase,
      change: toBase(hand, changeCur),
      changeCurrency: changeCur.code,
      kept: keepBase || undefined,
      customerName: keepName || changeCustomer?.name || undefined,
      message: shortBase > 0 && paidBase > 0 ? `Still to pay ${fmt(shortBase, base)}` : undefined,
    });
  }, [paidBase, hand, changeCur.code, keepBase, keepName, shortBase]); // eslint-disable-line react-hooks/exhaustive-deps

  const resetChange = () => setHandStr(null);

  const chooseMethod = (id: string) => {
    setMethodId(id);
    const m = enabledMethods.find((x) => x.id === id);
    // Mobile money / card: the amount is normally exactly what is owed — fill it in.
    if (m && !m.isCash) setAmountStr(dueBeforeEntry > 0 ? String(fromBase(dueBeforeEntry, cur)) : '');
    resetChange();
    setTimeout(() => amountRef.current?.focus(), 0);
  };

  const chooseCurrency = (code: string) => {
    setCurCode(code);
    const c = enabledCur.find((x) => x.code === code)!;
    if (method && !method.isCash) setAmountStr(dueBeforeEntry > 0 ? String(fromBase(dueBeforeEntry, c)) : '');
    resetChange();
  };

  const startSplit = () => {
    if (!(entered > 0)) return;
    setSplit((s) => [...s, { methodId, currency: cur.code, amount: round2(entered), baseAmount: enteredBase, reference: reference.trim() || undefined }]);
    setAmountStr('');
    setReference('');
    resetChange();
    amountRef.current?.focus();
  };

  const confirm = () => {
    if (blocker) return;
    const payments: Payment[] = [];
    if (creditUsed > 0) payments.push({ methodId: CREDIT_METHOD, currency: base.code, amount: creditUsed, baseAmount: creditUsed });
    payments.push(...split);
    if (entered > 0)
      payments.push({ methodId, currency: cur.code, amount: round2(entered), baseAmount: enteredBase, reference: reference.trim() || undefined });

    let customer: CustomerRef | undefined;
    if (changeOf) customer = { id: changeOf };
    else if (keepBase > 0 && keepFor.kind === 'existing') customer = { id: keepFor.id };
    else if (keepBase > 0 && keepFor.kind === 'new') customer = { name: keepFor.name, phone: keepFor.phone, note: keepFor.note };

    const r = placeOrder({
      tillId,
      orderTypeId,
      lines,
      payments,
      changeGiven: toBase(hand, changeCur),
      changeCurrency: changeCur.code,
      cardNumber: needsCard ? card : undefined,
      customer,
      keep: keepBase > 0 ? { amount: keepBase, currency: changeCur.code } : undefined,
      parentOrderId,
      cashierId,
    });
    if (!r.ok) return toast(r.error);
    setLiveCart(tillId, {
      orderTypeId,
      lines,
      total,
      paid: paidBase,
      change: toBase(hand, changeCur),
      changeCurrency: changeCur.code,
      kept: keepBase || undefined,
      customerName: r.customer?.name,
      message: `Your number is ${r.order.number}. Thank you!`,
    });
    onDone(r);
  };

  const methodName = (id: string) => methods.find((m) => m.id === id)?.name ?? id;
  const status: 'waiting' | 'short' | 'exact' | 'change' =
    paidBase <= 0 ? 'waiting' : shortBase > 0 ? 'short' : changeBase > 0 ? 'change' : 'exact';

  return (
    <Dialog
      title={`Payment · ${fmt(total, base)}`}
      onClose={onCancel}
      width={940}
      footer={
        <>
          <button className="btn big" onClick={onCancel}>
            Back
          </button>
          <button className={`btn big ${blocker ? 'blocked' : 'primary'}`} aria-disabled={!!blocker} onClick={confirm}>
            {confirmLabel}
          </button>
        </>
      }
    >
      <div className="pay2">
        {/* ------------------------------------------------ left: what they give */}
        <div className="pay-left">
          <div className="step-label">How are they paying?</div>
          <div className="seg">
            {enabledMethods.map((m) => (
              <button key={m.id} className={methodId === m.id && !findingChange ? 'on' : ''} onClick={() => { setFindingChange(false); chooseMethod(m.id); }}>
                {m.name}
              </button>
            ))}
            <button className={findingChange ? 'on' : 'seg-change'} onClick={() => setFindingChange(true)}>
              👤 Their change
            </button>
          </div>

          {findingChange ? (
            <div className="finder-wrap">
              <ChangeFinder
                action={(_, b) => `Use ${fmt(Math.min(b, total), base)}`}
                onPick={(c) => {
                  setChangeOf(c.id);
                  setKeepFor({ kind: 'none' });
                  setFindingChange(false);
                  setAmountStr('');
                  resetChange();
                  setTimeout(() => amountRef.current?.focus(), 0);
                }}
              />
              <button className="btn" onClick={() => setFindingChange(false)}>
                Cancel
              </button>
            </div>
          ) : (
            <>
              {enabledCur.length > 1 && (
                <div className="seg cur-seg">
                  {enabledCur.map((c) => (
                    <button key={c.code} className={curCode === c.code ? 'on' : ''} onClick={() => chooseCurrency(c.code)}>
                      {c.code}
                    </button>
                  ))}
                </div>
              )}

              {(changeCustomer || split.length > 0) && (
                <div className="paid-lines">
                  {changeCustomer && creditUsed > 0 && (
                    <div>
                      <span>
                        From <b>{changeCustomer.name}</b>'s change
                        {changeBalance > creditUsed && <span className="muted"> ({fmt(round2(changeBalance - creditUsed), base)} stays kept)</span>}
                      </span>
                      <span>
                        {fmt(creditUsed, base)}
                        <button className="x" onClick={() => setChangeOf(null)} aria-label="Remove">
                          ✕
                        </button>
                      </span>
                    </div>
                  )}
                  {split.map((p, i) => (
                    <div key={i}>
                      <span>{methodName(p.methodId)}</span>
                      <span>
                        {fmt(p.amount, currencies.find((x) => x.code === p.currency))}
                        <button className="x" onClick={() => setSplit((s) => s.filter((_, j) => j !== i))} aria-label="Remove">
                          ✕
                        </button>
                      </span>
                    </div>
                  ))}
                </div>
              )}

              {dueBeforeEntry > 0 || entered > 0 ? (
                <>
                  <label className="step-label" htmlFor="pay-amount">
                    {method?.isCash ? 'Cash received' : `${method?.name} amount`} ({cur.code})
                  </label>
                  <div className={`amount-box ${status}`}>
                    <span className="sym">{cur.symbol}</span>
                    <input
                      id="pay-amount"
                      ref={amountRef}
                      autoFocus
                      inputMode="decimal"
                      placeholder="Type amount"
                      value={amountStr}
                      onChange={(e) => {
                        setAmountStr(e.target.value.replace(/[^\d.]/g, ''));
                        resetChange();
                      }}
                      onKeyDown={(e) => e.key === 'Enter' && confirm()}
                    />
                  </div>
                  <div className="quick">
                    <button onClick={() => { setAmountStr(String(fromBase(dueBeforeEntry, cur))); resetChange(); }}>Exact</button>
                    {method?.isCash &&
                      cur.quickCash
                        .filter((q) => q >= fromBase(dueBeforeEntry, cur) * 0.5)
                        .map((q) => (
                          <button key={q} onClick={() => { setAmountStr(String(q)); resetChange(); }}>
                            {fmt(q, cur)}
                          </button>
                        ))}
                    {amountStr && (
                      <button onClick={() => { setAmountStr(''); resetChange(); }} className="clear-btn">
                        Clear
                      </button>
                    )}
                  </div>
                  {method?.requiresReference && entered > 0 && (
                    <label className="field">
                      {method.name} reference
                      <input id="pay-ref" value={reference} onChange={(e) => setReference(e.target.value)} placeholder="Transaction ID from the SMS" onKeyDown={(e) => e.key === 'Enter' && confirm()} />
                    </label>
                  )}
                  {status === 'short' && entered > 0 && (
                    <button className="link-btn" onClick={startSplit}>
                      Customer pays the rest another way (e.g. EcoCash)? Keep this {fmt(entered, cur)} and add the rest →
                    </button>
                  )}
                </>
              ) : (
                <div className="muted" style={{ marginTop: 14 }}>
                  Nothing more to pay.
                </div>
              )}
            </>
          )}
        </div>

        {/* ------------------------------------------------ right: what happens */}
        <div className="pay-right">
          <div className={`status-panel ${status}`}>
            <div className="sp-row">
              <span>Total</span>
              <b>{fmt(total, base)}</b>
            </div>
            {paidBase > 0 && (
              <div className="sp-row">
                <span>Received</span>
                <b>{fmt(paidBase, base)}</b>
              </div>
            )}
            <div className="sp-main">
              {status === 'waiting' && (
                <>
                  <span>To pay</span>
                  <strong>{fmt(total, base)}</strong>
                  {cur.code !== base.code && <small>{fmt(fromBase(total, cur), cur)}</small>}
                </>
              )}
              {status === 'short' && (
                <>
                  <span>SHORT — ask for</span>
                  <strong>{fmt(shortBase, base)}</strong>
                  {cur.code !== base.code && <small>{fmt(fromBase(shortBase, cur), cur)} more</small>}
                </>
              )}
              {status === 'exact' && (
                <>
                  <span>Paid exactly</span>
                  <strong>No change</strong>
                </>
              )}
              {status === 'change' && (
                <>
                  <span>GIVE CHANGE</span>
                  <strong>{fmt(hand, changeCur)}</strong>
                  {keepInCur > 0 && <small>+ {fmt(keepInCur, changeCur)} kept for {keepName || 'customer'}</small>}
                </>
              )}
            </div>
          </div>

          {status === 'change' && !nonCashOver && (
            <div className="change-panel">
              {enabledCur.length > 1 && (
                <div className="row wrap" style={{ gap: 6 }}>
                  <span className="muted" style={{ fontSize: 13 }}>
                    Change in
                  </span>
                  <div className="seg small">
                    {enabledCur.map((c) => (
                      <button key={c.code} className={changeCode === c.code ? 'on' : ''} onClick={() => { setChangeCode(c.code); resetChange(); }}>
                        {c.code}
                      </button>
                    ))}
                  </div>
                </div>
              )}
              <div className="short-of-change">
                <label htmlFor="hand-over">Short of change? Hand over only</label>
                <div className="row">
                  <input
                    id="hand-over"
                    inputMode="decimal"
                    value={handStr ?? String(changeInCur)}
                    onChange={(e) => setHandStr(e.target.value.replace(/[^\d.]/g, ''))}
                    onKeyDown={(e) => e.key === 'Enter' && confirm()}
                  />
                  <button className="btn" onClick={() => setHandStr('0')}>
                    Keep it all
                  </button>
                </div>
              </div>

              {keepInCur > 0 && (
                <div className="keep-box">
                  <div className="keep-title">
                    Keeping {fmt(keepInCur, changeCur)} for {keepName ? <b>{keepName}</b> : 'this customer'}
                  </div>
                  {changeOf ? (
                    <div className="muted" style={{ fontSize: 13 }}>
                      Added to their change. New balance {fmt(round2(changeBalance - creditUsed + keepBase), base)}.
                    </div>
                  ) : (
                    <CustomerPicker value={keepFor} onChange={setKeepFor} autoFocus label="Customer name" />
                  )}
                </div>
              )}
            </div>
          )}
          {nonCashOver && <div className="warn-box">{method?.name} should be the exact amount. Tap Exact.</div>}

          {needsCard && (
            <div className={`number-box ${cardProblem ? 'bad' : cardWarn ? 'warn' : ''}`}>
              <div className="grow">
                <b>Card to hand over</b>
                <div className="muted" style={{ fontSize: 13 }}>
                  {cardProblem || cardWarn || 'Change it if you give a different card'}
                </div>
              </div>
              <input id="card-number" inputMode="numeric" value={cardStr} onChange={(e) => setCardStr(e.target.value.replace(/\D/g, ''))} onKeyDown={(e) => e.key === 'Enter' && confirm()} />
            </div>
          )}
        </div>
      </div>
    </Dialog>
  );
}
