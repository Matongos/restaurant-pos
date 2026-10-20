import { useEffect, useMemo, useState } from 'react';
import { placeOrder, setLiveCart, useStore } from '../store/store';
import { fmt, fromBase, round2, toBase } from '../domain/money';
import { cardsInUse, nextFreeCard } from '../domain/rules';
import type { ChangeOwed, Order, OrderLine, Payment } from '../domain/types';
import { Dialog, toast } from '../components/ui';

interface Props {
  tillId: string;
  total: number;
  orderTypeId: string;
  lines: OrderLine[];
  parentOrderId?: string;
  cashierId: string;
  onCancel: () => void;
  onDone: (r: { order: Order; changeOwed?: ChangeOwed }) => void;
}

export default function PayDialog({ tillId, total, orderTypeId, lines, parentOrderId, cashierId, onCancel, onDone }: Props) {
  const currencies = useStore((s) => s.currencies);
  const methods = useStore((s) => s.paymentMethods);
  const settings = useStore((s) => s.settings);
  const orders = useStore((s) => s.orders);

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
  const [oweName, setOweName] = useState('');
  const [owePhone, setOwePhone] = useState('');

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

  const changeGiven = changeGivenStr === null ? changeDueInCur : Math.max(0, Number(changeGivenStr) || 0);
  const owedInCur = round2(Math.max(0, changeDueInCur - changeGiven));
  const owedBase = toBase(owedInCur, changeCur);

  // Keep the customer display in step with the payment.
  useEffect(() => {
    setLiveCart(tillId, {
      orderTypeId,
      lines,
      total,
      paid: paidBase,
      change: changeDueBase,
      changeCurrency: changeCur.code,
      message: remainingBase > 0 && paidBase > 0 ? `Still to pay ${fmt(remainingBase, base)}` : undefined,
    });
  }, [paidBase, changeDueBase, changeCur.code, remainingBase]); // eslint-disable-line react-hooks/exhaustive-deps

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

  const exact = () => addPayment(fromBase(remainingBase, cur));

  const canConfirm = remainingBase <= 0.004 && !cardProblem && (owedInCur <= 0 || oweName.trim().length > 0);

  const confirm = () => {
    const r = placeOrder({
      tillId,
      orderTypeId,
      lines,
      payments,
      changeGiven: toBase(changeGiven, changeCur),
      changeCurrency: changeCur.code,
      cardNumber: needsCard ? card : undefined,
      owe: owedInCur > 0 ? { customerName: oweName, phone: owePhone, amount: owedBase, currency: changeCur.code } : undefined,
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
      message: `Your number is ${r.order.number}. Thank you!`,
    });
    onDone(r);
  };

  return (
    <Dialog
      title={`Payment — ${fmt(total, base)}`}
      onClose={onCancel}
      width={880}
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
          <div className="section-title" style={{ marginTop: 0 }}>
            Method
          </div>
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
              <input value={reference} onChange={(e) => setReference(e.target.value)} placeholder="e.g. transaction ID" />
            </label>
          )}
          <div className="section-title">Amount received</div>
          <div className="row">
            <input
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
                      {methods.find((m) => m.id === p.methodId)?.name} {p.reference ? `· ${p.reference}` : ''}
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
                Change actually given (lower it if you are short of change)
                <input
                  inputMode="decimal"
                  value={changeGivenStr ?? String(changeDueInCur)}
                  onChange={(e) => setChangeGivenStr(e.target.value.replace(/[^\d.]/g, ''))}
                />
              </label>
              {owedInCur > 0 && (
                <div className="owe-box">
                  <b>Owe {fmt(owedInCur, changeCur)} to the customer</b>
                  <div className="muted" style={{ fontSize: 13 }}>
                    A voucher with a code prints. They can collect it any day.
                  </div>
                  <label className="field">
                    Customer name *
                    <input value={oweName} onChange={(e) => setOweName(e.target.value)} />
                  </label>
                  <label className="field">
                    Phone (optional)
                    <input inputMode="tel" value={owePhone} onChange={(e) => setOwePhone(e.target.value)} />
                  </label>
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
