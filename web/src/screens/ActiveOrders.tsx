import { useMemo, useState } from 'react';
import { go } from '../router';
import { getState, sendOutForDelivery, setOrderStatus, useCurrentUser, useStore } from '../store/store';
import { can, fmtDuration, lineExtras, lineLabel, serviceTimes, timerState, todayISO, type TimerState } from '../domain/rules';
import { customerSlipHTML, deliverySlipHTML, kitchenTicketHTML, printTickets } from '../print/tickets';
import { Dialog, MoreMenu, TopBar, toast, useNow } from '../components/ui';
import { LuBan, LuBike, LuCheck, LuCookingPot, LuCupSoda, LuMapPin, LuPhone, LuPrinter } from 'react-icons/lu';
import type { Order } from '../domain/types';
import CancelSaleDialog from '../components/CancelSaleDialog';

type Filter = 'waiting' | 'ready' | 'out' | 'served';

export const TIMER_CLASS: Record<TimerState, string> = { ok: 'green', warn: 'amber', late: 'red' };

export default function ActiveOrders() {
  const now = useNow(1000);
  const user = useCurrentUser()!;
  const orders = useStore((s) => s.orders);
  const orderTypes = useStore((s) => s.orderTypes);
  const settings = useStore((s) => s.settings);
  const [filter, setFilter] = useState<Filter>('waiting');
  const [cancelling, setCancelling] = useState<Order | null>(null);
  const [sending, setSending] = useState<Order | null>(null);
  const deliveryOn = useStore((s) => s.orderTypes.some((t) => t.id === 'delivery' && t.enabled));

  const today = todayISO();
  const mains = useMemo(
    // Table orders live on the Tables screen.
    () => orders.filter((o) => !o.parentOrderId && !o.table && !o.example && todayISO(new Date(o.createdAt)) === today),
    [orders, today],
  );
  const addonsOf = (id: string) => orders.filter((o) => o.parentOrderId === id);

  // A delivery that has left with a rider sits in "Out for delivery" until it is marked delivered.
  const out = (o: Order) => !!o.delivery?.outAt;
  const inTab = (o: Order, f: Filter) =>
    f === 'waiting'
      ? o.status === 'in_kitchen' && !out(o)
      : f === 'ready'
        ? o.status === 'ready' && !out(o)
        : f === 'out'
          ? out(o) && (o.status === 'in_kitchen' || o.status === 'ready')
          : o.status === 'served';
  const list = mains
    .filter((o) => inTab(o, filter))
    .sort((a, b) => (filter === 'served' ? b.createdAt.localeCompare(a.createdAt) : a.createdAt.localeCompare(b.createdAt)));

  const count = (f: Filter) => mains.filter((o) => inTab(o, f)).length;
  const showOutTab = deliveryOn || count('out') > 0;

  const reprint = (o: Order) => {
    const s = getState();
    const parts = [kitchenTicketHTML(o, s)];
    if (o.delivery) parts.push(deliverySlipHTML(o, s));
    else if (o.numberMode !== 'card') parts.push(customerSlipHTML(o, s));
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
            {showOutTab && (
              <button className={filter === 'out' ? 'on' : ''} onClick={() => setFilter('out')}>
                Out for delivery ({count('out')})
              </button>
            )}
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
            const isOut = out(o) && o.status !== 'served';
            const waited = o.status === 'served' || isOut ? st.toServedMs ?? 0 : now - Date.parse(st.placed);
            const state = timerState(waited, settings.warnAfterMinutes, settings.lateAfterMinutes);
            const color = isOut ? 'out' : o.status === 'served' ? (state === 'late' ? 'red-soft' : 'grey') : TIMER_CLASS[state];
            const d = o.delivery;
            return (
              <div key={o.id} className="ocard">
                <div className={`oh ${color}`}>
                  <span className="n">{o.number}</span>
                  <span className="t">
                    {type?.ticketLabel}
                    <br />
                    <span className="clock">{isOut ? fmtDuration(now - Date.parse(d!.outAt!)) : fmtDuration(waited)}</span>
                    {!isOut && state === 'late' && <span className="late-pill">{o.status === 'served' ? 'WAS LATE' : 'LATE'}</span>}
                    {isOut && <small> on the road</small>}
                    {o.status === 'served' && <small> {d ? 'delivered' : 'served'}</small>}
                  </span>
                </div>
                <div className="ob">
                  {d && (
                    <div className="odl">
                      <div>
                        <LuMapPin aria-hidden="true" />
                        <span>
                          <b>{d.name}</b> · <a href={`tel:${d.phone.replace(/[^\d+]/g, '')}`}>{d.phone}</a>
                          <br />
                          {d.address}
                          {d.areaName ? ` · ${d.areaName}` : ''}
                          {d.note && <span className="muted"> — {d.note}</span>}
                        </span>
                      </div>
                      {d.outAt && (
                        <div className="odl-out">
                          <LuBike aria-hidden="true" />
                          Left {new Date(d.outAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                          {d.rider ? ` with ${d.rider}` : ''}
                        </div>
                      )}
                    </div>
                  )}
                  {o.lines.map((l) => (
                    <div key={l.id}>
                      {l.qty} × {l.name}
                      {lineExtras(l) && <span className="muted"> — {lineExtras(l)}</span>}
                    </div>
                  ))}
                  {addons.flatMap((a) =>
                    a.lines.map((l) => (
                      <div key={l.id} className="addon">
                        + {l.qty} × {lineLabel(l)} {a.status === 'ready' ? '(ready)' : ''}
                      </div>
                    )),
                  )}
                </div>
                {o.status !== 'served' && (
                  <div className="of">
                    {d && !d.outAt ? (
                      <button className="btn primary" onClick={() => setSending(o)}>
                        <LuBike aria-hidden="true" />
                        Out for delivery
                      </button>
                    ) : (
                      <button
                        className="btn primary"
                        onClick={() => {
                          setOrderStatus(o.id, 'served', user.id);
                          toast(
                            `Order ${o.number} ${d ? `delivered to ${d.name}` : 'served'}${o.numberMode !== 'slip' ? ` — card ${o.number} is free again` : ''}`,
                          );
                        }}
                      >
                        <LuCheck aria-hidden="true" />
                        {d ? 'Delivered' : 'Served'}
                      </button>
                    )}
                    {can(user.role, 'take_orders') && !isOut && (
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
      {sending && <RiderDialog order={sending} onClose={() => setSending(null)} />}
    </div>
  );
}

/** Who takes the delivery: tap a staff member or a rider used before, or type a name. */
function RiderDialog({ order, onClose }: { order: Order; onClose: () => void }) {
  const user = useCurrentUser()!;
  const staff = useStore((s) => s.staff);
  const orders = useStore((s) => s.orders);
  const [rider, setRider] = useState('');
  const names = useMemo(() => {
    const seen = new Set<string>();
    const list: string[] = [];
    const add = (n?: string) => {
      const k = n?.trim().toLowerCase();
      if (!n || !k || seen.has(k)) return;
      seen.add(k);
      list.push(n.trim());
    };
    for (let i = orders.length - 1; i >= 0 && list.length < 6; i--) add(orders[i].delivery?.rider);
    for (const s of staff) if (s.active && !s.deletedAt && (s.role === 'attendant' || s.role === 'cashier')) add(s.name.replace(/\s*\(.*\)\s*/g, ''));
    return list.slice(0, 8);
  }, [orders, staff]);
  const d = order.delivery!;
  const send = () => {
    sendOutForDelivery(order.id, rider, user.id);
    toast(`Order ${order.number} is out for delivery${rider.trim() ? ` with ${rider.trim()}` : ''}`);
    onClose();
  };
  return (
    <Dialog
      title={`Send order ${order.number} out`}
      onClose={onClose}
      width={480}
      footer={
        <>
          <button className="btn" onClick={onClose}>
            Cancel
          </button>
          <button className="btn primary" onClick={send}>
            <LuBike aria-hidden="true" />
            {rider.trim() ? `Out with ${rider.trim()}` : 'Out for delivery'}
          </button>
        </>
      }
    >
      <p style={{ marginTop: 0 }}>
        To <b>{d.name}</b>, {d.address}
        {d.areaName ? ` (${d.areaName})` : ''}.{' '}
        <a href={`tel:${d.phone.replace(/[^\d+]/g, '')}`}>
          <LuPhone aria-hidden="true" style={{ verticalAlign: '-2px' }} /> {d.phone}
        </a>
      </p>
      <div className="section-title">Who is taking it?</div>
      {names.length > 0 && (
        <div className="seg">
          {names.map((n) => (
            <button key={n} className={rider === n ? 'on' : ''} onClick={() => setRider(n)}>
              {n}
            </button>
          ))}
        </div>
      )}
      <label className="field">
        Rider name (optional)
        <input id="rider-name" value={rider} onChange={(e) => setRider(e.target.value)} placeholder="e.g. Farai" onKeyDown={(e) => e.key === 'Enter' && send()} />
      </label>
    </Dialog>
  );
}
