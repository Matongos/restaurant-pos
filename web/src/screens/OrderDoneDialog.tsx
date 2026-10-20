import { useEffect, useMemo } from 'react';
import { getState, useStore } from '../store/store';
import type { ChangeOwed, Order } from '../domain/types';
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

export default function OrderDoneDialog({ order, changeOwed, onNew }: { order: Order; changeOwed?: ChangeOwed; onNew: () => void }) {
  const settings = useStore((s) => s.settings);
  const currencies = useStore((s) => s.currencies);
  const changeCur = currencies.find((c) => c.code === order.changeCurrency)!;

  const parts = useMemo(() => {
    const s = getState();
    const list: { title: string; html: string }[] = [{ title: 'Kitchen printer', html: kitchenTicketHTML(order, s) }];
    if (!order.parentOrderId && (order.numberMode === 'slip' || order.numberMode === 'both'))
      list.push({ title: 'Customer slip', html: customerSlipHTML(order, s) });
    if (changeOwed) list.push({ title: 'Change voucher', html: changeVoucherHTML(changeOwed, s) });
    return list;
  }, [order, changeOwed]);

  useEffect(() => {
    if (settings.autoPrintKitchen) printTickets(parts.map((p) => p.html));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Enter' && onNew();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onNew]);

  const handOver =
    order.parentOrderId ? 'Added to the same number' : order.numberMode === 'slip' ? 'Hand over the printed slip' : 'Hand over card';

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
        {changeOwed && (
          <div style={{ fontSize: 18, fontWeight: 700, color: 'var(--warn)' }}>
            Owed to {changeOwed.customerName}: voucher {changeOwed.code}
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
