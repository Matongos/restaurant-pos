import { useEffect, useMemo, useState } from 'react';
import { placeOrder, setLiveCart, useStore, type CustomerRef, type PlaceOrderSuccess } from '../store/store';
import { fmt, fromBase, round2, toBase } from '../domain/money';
import { cardsInUse, customerBalance, nextFreeCard, tidyName } from '../domain/rules';
import { CREDIT_METHOD, type OrderLine, type Payment } from '../domain/types';
import { Dialog, toast } from '../components/ui';
import CustomerPicker, { selectionReady, type CustomerSelection } from '../components/CustomerPicker';

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

  const [payments, setPayments] = useState<Payment[]>([]);
  const [methodId, setMethodId] = useState(enabledMethods[0]?.id ?? 'cash');
  const [curCode, setCurCode] = useState(base.code);
  const [amountStr, setAmountStr] = useState('');
  const [reference, setReference] = useState('');

  const [changeCode, setChangeCode] = useState(base.code);
  const [changeGivenStr, setChangeGivenStr] = useState<string | null>(null);
  const [cust, setCust] = useState<CustomerSelection>({ kind: 'none' });
  const [showCustomer, setShowCustomer] = useState(false);

  const needsCard = !parentOrderId && settings.numberMode !== 'slip';
  const suggested = useMemo(() => nextFreeCard(orders, settings.cardFrom, settings.cardTo), [orders, settings.cardFrom, settings.cardTo]);
  const [cardStr, setCardStr] = useState(suggested ? String(suggested) : '');
  const inUse = useMemo(() => cardsInUse(orders), [orders]);
  const card = Number(cardStr);
  const cardProblem = !needsCard
    ? ''
    : !cardStr
      ? 'Enter the card number you are handing over'
      : card < settings.cardFrom || card > settings.cardTo
        ? `Cards run ${settings.cardFrom}–${settings.cardTo}`
        : inUse.has(card)
          ? `Card ${card} is still with another customer`
          : '';

  const cur = enabledCur.find((c) => c.code === curCode) ?? base;
  const method = enabledMethods.find((m) => m.id === methodId);
  const changeCur = enabledCur.find((c) => c.code === changeCode) ?? base;

  const paidBase = round2(payments.reduce((s, p) => s + p.baseAmount, 0));
  const remainingBase = round2(Math.max(0, total - paidBase));
  const changeDueBase = round2(Math.max(0, paidBase - total));
  const changeDueInCur = fromBase(changeDueBase, changeCur);

  const changeGiven = changeGivenStr === null ? changeDueInCur : Math.min(changeDueInCur, Math.max(0, Number(changeGivenStr) || 0));
  const keptInCur = round2(Math.max(0, changeDueInCur - changeGiven));
  const keptBase = toBase(keptInCur, changeCur);

  // Customer and their change balance.
  const existing = cust.kind === 'existing' ? customers.find((c) => c.id === cust.id) : undefined;
  const balance = existing ? customerBalance(credit, existing.id) : 0;
  const creditUsed = round2(payments.filter((p) => p.methodId === CREDIT_METHOD).reduce((s, p) => s + p.baseAmount, 0));
  const balanceLeft = round2(balance - creditUsed);
  const custName = existing?.name ?? (cust.kind === 'new' ? tidyName(cust.name) : '');
  const needCustomer = keptBase > 0 || creditUsed > 0;
  const custReady = selectionReady(cust, customers);

  // Keep the customer display in step with the payment.
  useEffect(() => {
    setLiveCart(tillId, {
      orderTypeId,
      lines,
      total,
      paid: paidBase,
      change: toBase(changeGiven, changeCur),
      changeCurrency: changeCur.code,
      kept: keptBase || undefined,
      customerName: custName || undefined,
      message: remainingBase > 0 && paidBase > 0 ? `Still to pay ${fmt(remainingBase, base)}` : undefined,
    });
  }, [paidBase, changeGiven, changeCur.code, keptBase, custName, remainingBase]); // eslint-disable-line react-hooks/exhaustive-deps

  const addPayment = (amount: number) => {
    if (!(amount > 0)) return;
    if (method?.requiresReference && !reference.trim()) {
      toast(`Enter the ${method.name} reference first`);
      return;
    }
    setPayments((p) => [
      ...p,
      { methodId, currency: cur.code, amount: round2(amount), baseAmount: toBase(amount, cur), reference: reference.trim() || undefined },
    ]);
    setAmountStr('');
    setReference('');
    setChangeGivenStr(null);
  };

  const useChange = () => {
    const amt = round2(Math.min(balanceLeft, remainingBase));
    if (!(amt > 0)) return;
    setPayments((p) => [...p, { methodId: CREDIT_METHOD, currency: base.code, amount: amt, baseAmount: amt }]);
    setChangeGivenStr(null);
  };

  const exact = () => addPayment(fromBase(remainingBase, cur));

  const canConfirm = remainingBase <= 0.004 && !cardProblem && (!needCustomer || custReady);

  const confirm = () => {
    let customerRef: CustomerRef | undefined;
    if (cust.kind === 'existing') customerRef = { id: cust.id };
    else if (cust.kind === 'new') customerRef = { name: cust.name, phone: cust.phone, note: cust.note };
    const r = placeOrder({
      tillId,
      orderTypeId,
      lines,
      payments,
      changeGiven: toBase(changeGiven, changeCur),
      changeCurrency: changeCur.code,
      cardNumber: needsCard ? card : undefined,
      customer: needCustomer ? customerRef : undefined,
      keep: keptBase > 0 ? { amount: keptBase, currency: changeCur.code } : undefined,
      parentOrderId,
      cashierId,
    });
    if (!r.ok) {
      toast(r.error);
      return;
    }
    setLiveCart(tillId, {
      orderTypeId,
      lines,
      total,
      paid: paidBase,
      change: toBase(changeGiven, changeCur),
      changeCurrency: changeCur.code,
      kept: keptBase || undefined,
      customerName: r.customer?.name,
      message: `Your number is ${r.order.number}. Thank you!`,
    });
    onDone(r);
  };

  const methodName = (id: string) => (id === CREDIT_METHOD ? 'Change used' : methods.find((m) => m.id === id)?.name ?? id);
  const pickerOpen = showCustomer || cust.kind !== 'none' || keptBase > 0;

  return (
    <Dialog
      title={`Payment — ${fmt(total, base)}`}
      onClose={onCancel}
      width={900}
      footer={
        <>
          <button className="btn big" onClick={onCancel}>
            Back
          </button>
          <button className="btn big primary" disabled={!canConfirm} onClick={confirm}>
            Confirm &amp; send to kitchen
          </button>
        </>
      }
    >
      <div className="pay-grid">
        <div>
          {/* Customer: optional, needed only when change is used or kept. */}
          {!pickerOpen ? (
            <button className="btn" style={{ width: '100%', marginBottom: 6 }} onClick={() => setShowCustomer(true)}>
              👤 Customer has change with us?
            </button>
          ) : (
            <div className="cust-box">
              <CustomerPicker
                value={cust}
                autoFocus={showCustomer && cust.kind === 'none'}
                label={keptBase > 0 ? 'Who is the change for?' : 'Customer'}
                onChange={(v) => {
                  // Switching customer removes change used from the previous one.
                  setPayments((ps) => ps.filter((p) => p.methodId !== CREDIT_METHOD));
                  setCust(v);
                }}
              />
              {existing && balanceLeft > 0 && remainingBase > 0 && (
                <button className="btn primary" style={{ width: '100%', marginTop: 8 }} onClick={useChange}>
                  Pay {fmt(Math.min(balanceLeft, remainingBase), base)} from {existing.name.split(' ')[0]}'s change
                </button>
              )}
            </div>
          )}

          <div className="section-title">Method</div>
          <div className="seg">
            {enabledMethods.map((m) => (
              <button key={m.id} className={methodId === m.id ? 'on' : ''} onClick={() => setMethodId(m.id)}>
                {m.name}
              </button>
            ))}
          </div>
          <div className="section-title">Currency</div>
          <div className="seg">
            {enabledCur.map((c) => (
              <button key={c.code} className={curCode === c.code ? 'on' : ''} onClick={() => setCurCode(c.code)}>
                {c.code}
              </button>
            ))}
          </div>
          {method?.requiresReference && (
            <label className="field">
              {method.name} reference
              <input id="pay-ref" value={reference} onChange={(e) => setReference(e.target.value)} placeholder="e.g. transaction ID" />
            </label>
          )}
          <div className="section-title">Amount received</div>
          <div className="row">
            <input
              id="pay-amount"
              className="amount-input"
              inputMode="decimal"
              placeholder={fmt(fromBase(remainingBase, cur), cur)}
              value={amountStr}
              onChange={(e) => setAmountStr(e.target.value.replace(/[^\d.]/g, ''))}
              onKeyDown={(e) => e.key === 'Enter' && addPayment(Number(amountStr))}
            />
            <button className="btn big" onClick={() => addPayment(Number(amountStr))} disabled={!(Number(amountStr) > 0)}>
              Add
            </button>
          </div>
          <div className="quick">
            <button onClick={exact} disabled={remainingBase <= 0}>
              Exact
            </button>
            {method?.isCash &&
              cur.quickCash.map((q) => (
                <button key={q} onClick={() => addPayment(q)}>
                  {fmt(q, cur)}
                </button>
              ))}
          </div>
          {payments.length > 0 && (
            <div className="pay-list">
              {payments.map((p, i) => {
                const c = currencies.find((x) => x.code === p.currency)!;
                return (
                  <div key={i}>
                    <span>
                      {methodName(p.methodId)} {p.reference ? `· ${p.reference}` : ''}
                    </span>
                    <span>
                      {fmt(p.amount, c)}{' '}
                      <button
                        className="btn ghost"
                        style={{ minHeight: 0, padding: '0 6px' }}
                        onClick={() => {
                          setPayments((ps) => ps.filter((_, j) => j !== i));
                          setChangeGivenStr(null);
                        }}
                        aria-label="Remove payment"
                      >
                        ✕
                      </button>
                    </span>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        <div>
          <div className="summary">
            <div className="r strong">
              <span>Total</span>
              <span>{fmt(total, base)}</span>
            </div>
            <div className="r">
              <span>Paid</span>
              <span>{fmt(paidBase, base)}</span>
            </div>
            {remainingBase > 0 ? (
              <div className="r due">
                <span>Still to pay</span>
                <span>
                  {fmt(remainingBase, base)}
                  {cur.code !== base.code && ` (${fmt(fromBase(remainingBase, cur), cur)})`}
                </span>
              </div>
            ) : (
              <div className="r change">
                <span>Change</span>
                <span>{fmt(changeDueInCur, changeCur)}</span>
              </div>
            )}
            {existing && (creditUsed > 0 || keptBase > 0 || balance > 0) && (
              <div className="r" style={{ borderTop: '1px dashed var(--line)', marginTop: 4, paddingTop: 8 }}>
                <span>{existing.name.split(' ')[0]}'s change after this</span>
                <b>{fmt(round2(balanceLeft + keptBase), base)}</b>
              </div>
            )}
          </div>

          {changeDueBase > 0 && (
            <>
              <div className="section-title">Give change in</div>
              <div className="seg">
                {enabledCur.map((c) => (
                  <button
                    key={c.code}
                    className={changeCode === c.code ? 'on' : ''}
                    onClick={() => {
                      setChangeCode(c.code);
                      setChangeGivenStr(null);
                    }}
                  >
                    {c.code}
                  </button>
                ))}
              </div>
              <label className="field">
                Change handed over now (lower it if you are short of change)
                <div className="row">
                  <input
                    id="change-given"
                    className="grow"
                    inputMode="decimal"
                    value={changeGivenStr ?? String(changeDueInCur)}
                    onChange={(e) => setChangeGivenStr(e.target.value.replace(/[^\d.]/g, ''))}
                  />
                  <button className="btn" onClick={() => setChangeGivenStr('0')}>
                    Keep all
                  </button>
                </div>
              </label>
              {keptInCur > 0 && (
                <div className="owe-box">
                  <b>
                    Keep {fmt(keptInCur, changeCur)} for {custName || 'the customer'}
                  </b>
                  <div className="muted" style={{ fontSize: 13 }}>
                    It goes on their change balance. They can collect it or spend it any day.
                  </div>
                  {!custReady && (
                    <div style={{ color: 'var(--warn)', fontWeight: 700, fontSize: 13, marginTop: 4 }}>
                      {cust.kind === 'none' ? 'Choose or add the customer on the left.' : 'Add a phone or note to tell them apart.'}
                    </div>
                  )}
                </div>
              )}
            </>
          )}

          {needsCard && (
            <div className="number-box">
              <div className="grow">
                <b>Card number</b>
                <div className="muted" style={{ fontSize: 13 }}>
                  {cardProblem || `Next free card: ${suggested ?? 'none'}`}
                </div>
              </div>
              <input
                id="card-number"
                inputMode="numeric"
                value={cardStr}
                onChange={(e) => setCardStr(e.target.value.replace(/\D/g, ''))}
                style={cardProblem ? { borderColor: 'var(--bad)' } : undefined}
              />
            </div>
          )}
          {!needsCard && !parentOrderId && (
            <div className="number-box">
              <div className="grow">
                <b>Printed slip</b>
                <div className="muted" style={{ fontSize: 13 }}>
                  The number is printed on the customer slip.
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </Dialog>
  );
}
