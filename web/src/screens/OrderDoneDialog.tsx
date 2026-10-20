import { useEffect, useMemo } from 'react';
import { getState, useStore, type PlaceOrderSuccess } from '../store/store';
import { changeVoucherHTML, customerSlipHTML, kitchenTicketHTML, printTickets, TICKET_CSS } from '../print/tickets';
import { fmt } from '../domain/money';
import { Dialog } from '../components/ui';

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
    const list: { title: string; html: string }[] = [{ title: 'Kitchen printer', html: kitchenTicketHTML(order, s) }];
    if (!order.parentOrderId && (order.numberMode === 'slip' || order.numberMode === 'both'))
      list.push({ title: 'Customer slip', html: customerSlipHTML(order, s) });
    if (kept && customer) list.push({ title: 'Change slip', html: changeVoucherHTML(kept, customer, balanceAfter ?? kept.amount, s) });
    return list;
  }, [order, kept, customer, balanceAfter]);

  useEffect(() => {
    if (settings.autoPrintKitchen) printTickets(parts.map((p) => p.html));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    // Ignore the Enter that confirmed the payment, so the number stays on screen.
    const openedAt = Date.now();
    const onKey = (e: KeyboardEvent) => e.key === 'Enter' && !e.repeat && Date.now() - openedAt > 600 && onNew();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onNew]);

  const handOver = order.parentOrderId ? 'Added to the same number' : order.numberMode === 'slip' ? 'Hand over the printed slip' : 'Hand over card';

  return (
    <Dialog
      title="Order sent to kitchen"
      onClose={onNew}
      width={900}
      footer={
        <>
          <button className="btn big" onClick={() => printTickets(parts.map((p) => p.html))}>
            🖨 Print {settings.autoPrintKitchen ? 'again' : ''}
          </button>
          <button className="btn big primary" onClick={onNew}>
            Next customer ↵
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
      <div className="ticket-previews">
        {parts.map((p) => (
          <TicketPaper key={p.title} title={p.title} html={p.html} />
        ))}
      </div>
    </Dialog>
  );
}
