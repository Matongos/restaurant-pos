import { useEffect, useMemo, useRef, useState } from 'react';
import { placeOrder, setLiveCart, useStore, type CustomerRef, type PlaceOrderSuccess } from '../store/store';
import { fmt, fromBase, round2, toBase } from '../domain/money';
import { cardsInUse, customerBalance, nextFreeCard, tidyName } from '../domain/rules';
import { CREDIT_METHOD, type OrderLine, type Payment } from '../domain/types';
import { Dialog, toast } from '../components/ui';
import CustomerPicker, { selectionReady, type CustomerSelection } from '../components/CustomerPicker';
import ChangeFinder from '../components/ChangeFinder';
import { LuBanknote, LuCircleAlert, LuCircleCheck, LuCreditCard, LuHandCoins, LuSmartphone, LuWallet, LuX } from 'react-icons/lu';

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

  const methodIcon = (id: string, isCash: boolean) => {
    const I = isCash ? LuBanknote : id === 'swipe' ? LuCreditCard : id === 'innbucks' ? LuWallet : LuSmartphone;
    return <I aria-hidden="true" />;
  };
  // Notes a customer would hand over for this bill: skip the ones far too small, show four at most.
  const dueInCur = fromBase(dueBeforeEntry, cur);
  const quickNotes = method?.isCash ? cur.quickCash.filter((q) => q >= dueInCur / 4).slice(0, 4) : [];
  const noteLabel = (q: number) => (Number.isInteger(q) ? `${cur.symbol}${cur.symbol.length > 1 ? ' ' : ''}${q}` : fmt(q, cur));
  const setAmount = (v: string) => {
    setAmountStr(v);
    resetChange();
  };

  return (
    <Dialog
      title="Payment"
      onClose={onCancel}
      width={980}
      className="pay-dialog"
      footer={
        <>
          <button className="btn big" onClick={onCancel}>
            Back
          </button>
          <button className={`btn big ${blocker ? 'blocked' : 'primary'}`} aria-disabled={!!blocker} onClick={confirm}>
            {!blocker && <LuCircleCheck aria-hidden="true" />}
            {confirmLabel}
          </button>
        </>
      }
    >
      {/* ---------------------------------------------- 1. bill and what to do now */}
      <div className="pay-head">
        <div className="ph-bill">
          <span>Total bill</span>
          <strong>{fmt(total, base)}</strong>
          {cur.code !== base.code && <small>{fmt(fromBase(total, cur), cur)}</small>}
        </div>
        <div className={`ph-status ${status}`} aria-live="polite">
          <span className="ph-icon" aria-hidden="true">
            {status === 'short' ? <LuCircleAlert /> : status === 'waiting' ? <LuWallet /> : <LuCircleCheck />}
          </span>
          <div>
            <span>
              {status === 'waiting' ? 'Amount to pay' : status === 'short' ? 'Short — ask for' : status === 'exact' ? 'Paid exactly' : 'Give change'}
            </span>
            <strong>
              {status === 'waiting' ? fmt(dueBeforeEntry, base) : status === 'short' ? fmt(shortBase, base) : status === 'exact' ? 'No change' : fmt(hand, changeCur)}
            </strong>
            {status === 'short' && cur.code !== base.code && <small>{fmt(fromBase(shortBase, cur), cur)} more</small>}
            {status === 'change' && keepInCur > 0 && (
              <small>
                + {fmt(keepInCur, changeCur)} kept for {keepName || 'customer'}
              </small>
            )}
          </div>
        </div>
      </div>

      <div className="pay3">
        {/* ---------------------------------------------- 2. how they pay */}
        <div className="pay-col">
          <div className="pay-label">Payment method</div>
          <div className="method-grid">
            {enabledMethods.map((m) => (
              <button
                key={m.id}
                className={methodId === m.id && !findingChange ? 'on' : ''}
                onClick={() => {
                  setFindingChange(false);
                  chooseMethod(m.id);
                }}
              >
                {methodIcon(m.id, m.isCash)}
                {m.name}
              </button>
            ))}
            <button className={`their-change ${findingChange ? 'on' : ''}`} onClick={() => setFindingChange(true)}>
              <LuHandCoins aria-hidden="true" />
              Their change
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
                <div className="cur-row">
                  <span>Currency</span>
                  <div className="seg small cur-seg">
                    {enabledCur.map((c) => (
                      <button key={c.code} className={curCode === c.code ? 'on' : ''} onClick={() => chooseCurrency(c.code)}>
                        {c.code}
                      </button>
                    ))}
                  </div>
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
                          <LuX aria-hidden="true" />
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
                          <LuX aria-hidden="true" />
                        </button>
                      </span>
                    </div>
                  ))}
                </div>
              )}

              {dueBeforeEntry > 0 || entered > 0 ? (
                <>
                  <div className="pay-label">Quick amount</div>
                  <div className="quick">
                    <button onClick={() => setAmount(String(fromBase(dueBeforeEntry, cur)))}>Exact</button>
                    {quickNotes.map((q) => (
                      <button key={q} onClick={() => setAmount(String(q))}>
                        {noteLabel(q)}
                      </button>
                    ))}
                  </div>

                  <label className="pay-label" htmlFor="pay-amount">
                    {method?.isCash ? 'Cash received' : `${method?.name} amount`} ({cur.code})
                  </label>
                  <div className={`amount-box ${status}`}>
                    <span className="sym">{cur.symbol}</span>
                    <input
                      id="pay-amount"
                      ref={amountRef}
                      autoFocus
                      inputMode="decimal"
                      placeholder="Enter amount received"
                      value={amountStr}
                      onChange={(e) => setAmount(e.target.value.replace(/[^\d.]/g, ''))}
                      onKeyDown={(e) => e.key === 'Enter' && confirm()}
                    />
                    {amountStr && (
                      <button className="amount-clear" onClick={() => setAmount('')} aria-label="Clear amount">
                        <LuX aria-hidden="true" />
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
                      Customer pays the rest another way (e.g. EcoCash)? Keep this {fmt(entered, cur)} and add the rest
                    </button>
                  )}
                </>
              ) : (
                <div className="muted" style={{ marginTop: 6 }}>
                  Nothing more to pay.
                </div>
              )}
            </>
          )}
        </div>

        {/* ---------------------------------------------- 3. change, kept change, card */}
        <div className="pay-col">
          {status === 'change' && !nonCashOver && (
            <div className="change-card">
              <div className="cc-head">
                <span className="cc-icon" aria-hidden="true">
                  <LuCircleAlert />
                </span>
                <div>
                  <b>Not enough change?</b>
                  <div>Hand over what you have. The rest is kept for the customer by name — they use it or collect it later.</div>
                </div>
              </div>
              {enabledCur.length > 1 && (
                <div className="cur-row">
                  <span>Change in</span>
                  <div className="seg small">
                    {enabledCur.map((c) => (
                      <button key={c.code} className={changeCode === c.code ? 'on' : ''} onClick={() => { setChangeCode(c.code); resetChange(); }}>
                        {c.code}
                      </button>
                    ))}
                  </div>
                </div>
              )}
              <div className="cc-fields">
                <label className="cc-field">
                  <span>Hand over now ({changeCur.code})</span>
                  <div className="cc-input">
                    <span className="sym">{changeCur.symbol}</span>
                    <input
                      id="hand-over"
                      inputMode="decimal"
                      value={handStr ?? String(changeInCur)}
                      onChange={(e) => setHandStr(e.target.value.replace(/[^\d.]/g, ''))}
                      onKeyDown={(e) => e.key === 'Enter' && confirm()}
                    />
                  </div>
                </label>
                <button className="btn" onClick={() => setHandStr('0')}>
                  Keep it all
                </button>
              </div>
              {keepInCur > 0 &&
                (changeOf ? (
                  <div className="muted" style={{ fontSize: 13 }}>
                    {fmt(keepInCur, changeCur)} added to {changeCustomer?.name}'s change. New balance {fmt(round2(changeBalance - creditUsed + keepBase), base)}.
                  </div>
                ) : (
                  <div className="cc-keep">
                    <CustomerPicker value={keepFor} onChange={setKeepFor} autoFocus label={`Keeping ${fmt(keepInCur, changeCur)} for — customer name`} onEnter={confirm} />
                  </div>
                ))}
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

      {/* ---------------------------------------------- 4. summary, always in view */}
      <div className="pay-summary">
        <div>
          <span>Received</span>
          <b>{fmt(paidBase, base)}</b>
        </div>
        <div>
          <span>Change due</span>
          <b className={hand > 0 ? 'good' : ''}>{fmt(hand, changeCur)}</b>
        </div>
        {keepInCur > 0 ? (
          <div className="kept">
            <span>Kept</span>
            <b>
              {fmt(keepInCur, changeCur)} {keepName ? `· ${keepName}` : ''}
            </b>
          </div>
        ) : status === 'short' ? (
          <div className="short">
            <span>Still to pay</span>
            <b>{fmt(shortBase, base)}</b>
          </div>
        ) : null}
      </div>
    </Dialog>
  );
}
