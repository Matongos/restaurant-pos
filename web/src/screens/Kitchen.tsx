import { useMemo, useState } from 'react';
import { setOrderStatus, useCurrentUser, useStore } from '../store/store';
import { fmtDuration, timerState } from '../domain/rules';
import { Dialog, TopBar, useNow } from '../components/ui';
import { TIMER_CLASS } from './ActiveOrders';

/**
 * Kitchen display (Phase 2 feature, included in the prototype to show the idea).
 * The only action is "tick done". Ticked orders disappear; Recall brings one back.
 */
export default function Kitchen() {
  const now = useNow(1000);
  const user = useCurrentUser()!;
  const orders = useStore((s) => s.orders);
  const orderTypes = useStore((s) => s.orderTypes);
  const settings = useStore((s) => s.settings);
  const [recallOpen, setRecallOpen] = useState(false);

  const waiting = useMemo(
    () => orders.filter((o) => o.status === 'in_kitchen').sort((a, b) => a.createdAt.localeCompare(b.createdAt)),
    [orders],
  );
  const recent = useMemo(() => {
    // Only orders not yet served can be brought back.
    const ready = orders.filter((o) => o.status === 'ready');
    const doneAt = (o: (typeof orders)[number]) => [...o.history].reverse().find((h) => h.status === 'ready')?.at ?? '';
    return ready
      .filter((o) => doneAt(o))
      .sort((a, b) => doneAt(b).localeCompare(doneAt(a)))
      .slice(0, 10);
  }, [orders]);

  return (
    <div className="app">
      <TopBar title="Kitchen">
        <button className="btn" onClick={() => setRecallOpen(true)}>
          ↺ Recall
        </button>
      </TopBar>
      <div className="page">
        {waiting.length === 0 && <div className="empty">All caught up. New orders appear here automatically.</div>}
        <div className="order-grid">
          {waiting.map((o) => {
            const waited = now - Date.parse(o.createdAt);
            const state = timerState(waited, settings.warnAfterMinutes, settings.lateAfterMinutes);
            const type = orderTypes.find((t) => t.id === o.orderTypeId);
            return (
              <div key={o.id} className="ocard">
                <div className={`oh ${TIMER_CLASS[state]}`}>
                  <span className="n">{o.number}</span>
                  <span className="t">
                    {type?.ticketLabel}
                    <br />
                    <span className="clock">{fmtDuration(waited)}</span>
                    {state === 'late' && <span className="late-pill">LATE</span>}
                    <small>{type?.packaging}</small>
                  </span>
                </div>
                <div className="ob">
                  {o.parentOrderId && <div className="addon">ADD-ON to #{o.number}</div>}
                  {o.lines.map((l) => (
                    <div key={l.id}>
                      <b>{l.qty} ×</b> {l.name}
                      {l.note && <div className="muted">» {l.note}</div>}
                    </div>
                  ))}
                </div>
                <button className="kitchen-tick" onClick={() => setOrderStatus(o.id, 'ready', user.id)}>
                  ✓ Done
                </button>
              </div>
            );
          })}
        </div>
      </div>
      {recallOpen && (
        <Dialog title="Recall a ticked order" onClose={() => setRecallOpen(false)} width={560}>
          {recent.length === 0 && <div className="empty">Nothing ticked yet.</div>}
          {recent.map((o) => (
            <div key={o.id} className="row" style={{ padding: '8px 0', borderBottom: '1px solid var(--line)' }}>
              <b style={{ fontSize: 24, width: 60 }}>{o.number}</b>
              <span className="grow">{o.lines.map((l) => `${l.qty}× ${l.name}`).join(', ')}</span>
              <button
                className="btn"
                onClick={() => {
                  setOrderStatus(o.id, 'in_kitchen', user.id);
                  setRecallOpen(false);
                }}
              >
                Bring back
              </button>
            </div>
          ))}
        </Dialog>
      )}
    </div>
  );
}
