import { useMemo, useState } from 'react';
import { go } from '../router';
import { getState, setOrderStatus, useCurrentUser, useStore } from '../store/store';
import { can, fmtDuration, serviceTimes, timerState, todayISO, type TimerState } from '../domain/rules';
import { customerSlipHTML, kitchenTicketHTML, printTickets } from '../print/tickets';
import { MoreMenu, TopBar, toast, useNow } from '../components/ui';
import { LuBan, LuCheck, LuCookingPot, LuCupSoda, LuPrinter } from 'react-icons/lu';
import type { Order } from '../domain/types';
import CancelSaleDialog from '../components/CancelSaleDialog';

type Filter = 'waiting' | 'ready' | 'served';

export const TIMER_CLASS: Record<TimerState, string> = { ok: 'green', warn: 'amber', late: 'red' };

export default function ActiveOrders() {
  const now = useNow(1000);
  const user = useCurrentUser()!;
  const orders = useStore((s) => s.orders);
  const orderTypes = useStore((s) => s.orderTypes);
  const settings = useStore((s) => s.settings);
  const [filter, setFilter] = useState<Filter>('waiting');
  const [cancelling, setCancelling] = useState<Order | null>(null);

  const today = todayISO();
  const mains = useMemo(
    () => orders.filter((o) => !o.parentOrderId && !o.example && todayISO(new Date(o.createdAt)) === today),
    [orders, today],
  );
  const addonsOf = (id: string) => orders.filter((o) => o.parentOrderId === id);

  const list = mains
    .filter((o) =>
      filter === 'waiting' ? o.status === 'in_kitchen' : filter === 'ready' ? o.status === 'ready' : o.status === 'served',
    )
    .sort((a, b) => (filter === 'served' ? b.createdAt.localeCompare(a.createdAt) : a.createdAt.localeCompare(b.createdAt)));

  const count = (f: Filter) =>
    mains.filter((o) => (f === 'waiting' ? o.status === 'in_kitchen' : f === 'ready' ? o.status === 'ready' : o.status === 'served')).length;

  const reprint = (o: Order) => {
    const s = getState();
    const parts = [kitchenTicketHTML(o, s)];
    if (o.numberMode !== 'card') parts.push(customerSlipHTML(o, s));
    printTickets(parts);
  };

  return (
    <div className="app">
      <TopBar title="Orders" />
      <div className="page">
        <div className="filters">
          <div className="tabs" style={{ margin: 0 }}>
            <button className={filter === 'waiting' ? 'on' : ''} onClick={() => setFilter('waiting')}>
              In kitchen ({count('waiting')})
            </button>
            <button className={filter === 'ready' ? 'on' : ''} onClick={() => setFilter('ready')}>
              Ready to serve ({count('ready')})
            </button>
            <button className={filter === 'served' ? 'on' : ''} onClick={() => setFilter('served')}>
              Served today ({count('served')})
            </button>
          </div>
        </div>
        {list.length === 0 && <div className="empty">No orders here.</div>}
        <div className="order-grid">
          {list.map((o) => {
            const type = orderTypes.find((t) => t.id === o.orderTypeId);
            const addons = addonsOf(o.id);
            const st = serviceTimes(o);
            const waited = o.status === 'served' ? st.toServedMs ?? 0 : now - Date.parse(st.placed);
            const state = timerState(waited, settings.warnAfterMinutes, settings.lateAfterMinutes);
            const color = o.status === 'served' ? (state === 'late' ? 'red-soft' : 'grey') : TIMER_CLASS[state];
            return (
              <div key={o.id} className="ocard">
                <div className={`oh ${color}`}>
                  <span className="n">{o.number}</span>
                  <span className="t">
                    {type?.ticketLabel}
                    <br />
                    <span className="clock">{fmtDuration(waited)}</span>
                    {state === 'late' && <span className="late-pill">{o.status === 'served' ? 'WAS LATE' : 'LATE'}</span>}
                    {o.status === 'served' && <small> served</small>}
                  </span>
                </div>
                <div className="ob">
                  {o.lines.map((l) => (
                    <div key={l.id}>
                      {l.qty} × {l.name}
                      {l.note && <span className="muted"> — {l.note}</span>}
                    </div>
                  ))}
                  {addons.flatMap((a) =>
                    a.lines.map((l) => (
                      <div key={l.id} className="addon">
                        + {l.qty} × {l.name} {a.status === 'ready' ? '(ready)' : ''}
                      </div>
                    )),
                  )}
                </div>
                {o.status !== 'served' && (
                  <div className="of">
                    <button
                      className="btn primary"
                      onClick={() => {
                        setOrderStatus(o.id, 'served', user.id);
                        toast(`Order ${o.number} served${o.numberMode !== 'slip' ? ` — card ${o.number} is free again` : ''}`);
                      }}
                    >
                      <LuCheck aria-hidden="true" />
                      Served
                    </button>
                    {can(user.role, 'take_orders') && (
                      <button className="btn" onClick={() => go(`/till?addon=${o.id}`)}>
                        <LuCupSoda aria-hidden="true" />
                        Drink
                      </button>
                    )}
                    <MoreMenu
                      items={[
                        ...(o.status === 'in_kitchen' && can(user.role, 'kitchen')
                          ? [{ label: 'Mark ready', icon: <LuCookingPot aria-hidden="true" />, onClick: () => setOrderStatus(o.id, 'ready', user.id) }]
                          : []),
                        { label: 'Reprint ticket', icon: <LuPrinter aria-hidden="true" />, onClick: () => reprint(o) },
                        { label: 'Cancel sale', icon: <LuBan aria-hidden="true" />, danger: true, onClick: () => setCancelling(o) },
                      ]}
                    />
                  </div>
                )}
                {o.status === 'served' && (
                  <div className="of">
                    <button className="btn" onClick={() => reprint(o)}>
                      <LuPrinter aria-hidden="true" />
                      Reprint
                    </button>
                    <MoreMenu items={[{ label: 'Cancel sale / refund', icon: <LuBan aria-hidden="true" />, danger: true, onClick: () => setCancelling(o) }]} />
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
      {cancelling && <CancelSaleDialog order={cancelling} onClose={() => setCancelling(null)} />}
    </div>
  );
}
