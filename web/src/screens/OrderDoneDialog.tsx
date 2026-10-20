import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { getState, useStore, type PlaceOrderSuccess } from '../store/store';
import { changeVoucherHTML, customerSlipHTML, kitchenTicketHTML, printTickets, TICKET_CSS } from '../print/tickets';
import { fmt } from '../domain/money';
import { Dialog } from '../components/ui';
import { LuCheck, LuPrinter } from 'react-icons/lu';

export function TicketPaper({ title, html }: { title: string; html: string }) {
  return (
    <div>
      <div className="paper-title">{title}</div>
      <div className="paper">
        <style>{TICKET_CSS}</style>
        <div dangerouslySetInnerHTML={{ __html: html }} />
      </div>
    </div>
  );
}

export default function OrderDoneDialog({ result, onNew }: { result: PlaceOrderSuccess; onNew: () => void }) {
  const { order, kept, customer, used, balanceAfter } = result;
  const settings = useStore((s) => s.settings);
  const currencies = useStore((s) => s.currencies);
  const changeCur = currencies.find((c) => c.code === order.changeCurrency)!;
  const base = currencies.find((c) => c.code === settings.baseCurrency)!;

  const parts = useMemo(() => {
    const s = getState();
    const list: { title: string; html: string }[] = [];
    if (s.settings.printKitchenTicket !== false) list.push({ title: 'Kitchen ticket', html: kitchenTicketHTML(order, s) });
    if (!order.parentOrderId && (order.numberMode === 'slip' || order.numberMode === 'both'))
      list.push({ title: 'Customer slip', html: customerSlipHTML(order, s) });
    if (kept && customer && s.settings.printChangeSlip !== false)
      list.push({ title: 'Change slip', html: changeVoucherHTML(kept, customer, balanceAfter ?? kept.amount, s) });
    return list;
  }, [order, kept, customer, balanceAfter]);

  const when = settings.printWhen ?? 'on_pay';
  const [printed, setPrinted] = useState(false);
  const print = useCallback(() => {
    if (!parts.length) return;
    printTickets(parts.map((p) => p.html));
    setPrinted(true);
  }, [parts]);

  // "Print straight away": the tickets go out the moment the payment is confirmed — once only,
  // even if React runs this effect twice (development mode does).
  const autoPrinted = useRef(false);
  useEffect(() => {
    if (when !== 'on_pay' || autoPrinted.current) return;
    autoPrinted.current = true;
    print();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  /** The big button: in "Print & next customer" mode it prints first (unless already printed). */
  const primary = useCallback(() => {
    if (when === 'on_next' && !printed) print();
    onNew();
  }, [when, printed, print, onNew]);

  // Optional countdown back to Sell. Any touch or key stops it, so nobody is rushed mid-conversation.
  const autoSecs = settings.autoNextSeconds ?? 0;
  const [left, setLeft] = useState<number | null>(autoSecs > 0 ? autoSecs : null);
  const primaryRef = useRef(primary);
  primaryRef.current = primary;
  useEffect(() => {
    if (left === null) return;
    if (left <= 0) {
      primaryRef.current?.();
      return;
    }
    const t = setTimeout(() => setLeft((n) => (n === null ? null : n - 1)), 1000);
    return () => clearTimeout(t);
  }, [left]);
  useEffect(() => {
    if (left === null) return;
    const stop = () => setLeft(null);
    window.addEventListener('pointerdown', stop);
    return () => window.removeEventListener('pointerdown', stop);
  }, [left === null]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    // Ignore the Enter that confirmed the payment, so the number stays on screen.
    const openedAt = Date.now();
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Enter' || e.repeat || Date.now() - openedAt < 600) return;
      primaryRef.current?.();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const countdown = left !== null && left > 0 ? ` (${left})` : '';
  const printedNames = parts.map((p) => p.title.toLowerCase()).join(', ');

  const handOver = order.parentOrderId ? 'Added to the same number' : order.numberMode === 'slip' ? 'Hand over the printed slip' : 'Hand over card';

  return (
    <Dialog
      title="Order sent to kitchen"
      onClose={onNew}
      width={900}
      footer={
        <>
          {parts.length > 0 && when === 'on_next' && !printed ? (
            <button className="btn big" onClick={onNew}>
              Next, don't print
            </button>
          ) : (
            parts.length > 0 && (
              <button className="btn big" onClick={print}>
                <LuPrinter aria-hidden="true" />
                {printed ? 'Print again' : 'Print'}
              </button>
            )
          )}
          <button className="btn big primary" onClick={primary}>
            {when === 'on_next' && !printed && parts.length > 0 && <LuPrinter aria-hidden="true" />}
            {when === 'on_next' && !printed && parts.length > 0 ? 'Print & next customer' : 'Next customer'}
            {countdown}
          </button>
        </>
      }
    >
      <div className="done-number">
        <div className="muted">{handOver}</div>
        <div className="n">{order.number}</div>
        {order.changeGiven > 0 && (
          <div style={{ fontSize: 22, fontWeight: 800, color: 'var(--good)' }}>
            Give change: {fmt(order.changeGiven * changeCur.rate, changeCur)}
          </div>
        )}
        {customer && (used > 0 || kept) && (
          <div style={{ fontSize: 18, fontWeight: 700, color: 'var(--warn)' }}>
            {used > 0 && `${fmt(used, base)} taken from ${customer.name}'s change. `}
            {kept && `${fmt(kept.amount, base)} kept for ${customer.name} (code ${kept.code}). `}
            Balance now {fmt(balanceAfter ?? 0, base)}.
          </div>
        )}
      </div>
      <div className={`print-status ${printed ? 'done' : ''}`}>
        {parts.length === 0
          ? 'Nothing is set to print — the kitchen sees this order on the kitchen screen.'
          : printed
            ? (
                <>
                  <LuCheck aria-hidden="true" /> Printed: {printedNames}
                </>
              )
            : when === 'on_next'
              ? `Prints when you press Print & next customer: ${printedNames}`
              : `Not printed yet: ${printedNames}`}
      </div>
      <div className="ticket-previews">
        {parts.map((p) => (
          <TicketPaper key={p.title} title={p.title} html={p.html} />
        ))}
      </div>
    </Dialog>
  );
}
