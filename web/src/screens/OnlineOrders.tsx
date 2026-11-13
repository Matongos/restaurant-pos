/** Online orders from the restaurant's web page / QR menu: accept or decline, then take payment at the counter. */
import { useEffect, useState } from 'react';
import { LuCheck, LuGlobe, LuPhone, LuX, LuClock, LuBellRing } from 'react-icons/lu';
import { TopBar, toast } from '../components/ui';
import { getState, useCurrentUser, useStore } from '../store/store';
import { fmt } from '../domain/money';
import { lineLabel, minutesSince } from '../domain/rules';
import { tabDue } from '../domain/tables';
import { acceptRemote, declineRemote, onNewOnlineOrder, useOnlineOrders, type RemoteOnlineOrder } from '../cloud/online';
import { getLink } from '../cloud/sync';
import { go, useRoute } from '../router';
import PayDialog from './PayDialog';

const MINUTES = [10, 15, 20, 30, 45];

export default function OnlineOrders() {
  const user = useCurrentUser()!;
  const { news, open, on } = useOnlineOrders();
  const orders = useStore((s) => s.orders);
  const base = useStore((s) => s.currencies.find((c) => c.code === s.settings.baseCurrency)!);
  const [busy, setBusy] = useState('');
  const [paying, setPaying] = useState<string | null>(null);
  const [, tick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => tick((x) => x + 1), 15000);
    return () => clearInterval(t);
  }, []);

  const accept = async (r: RemoteOnlineOrder, m: number) => {
    setBusy(r.id);
    try {
      await acceptRemote(r, m, user.id);
      toast(`WEB ${r.number} accepted — sent to the kitchen`);
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy('');
    }
  };
  const decline = async (r: RemoteOnlineOrder) => {
    setBusy(r.id);
    try {
      await declineRemote(r);
      toast(`WEB ${r.number} declined`);
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy('');
    }
  };

  const payTab = paying ? orders.find((o) => o.id === paying) : undefined;

  return (
    <div className="app">
      <TopBar title="Online orders" />
      <div className="page">
        <div className="page-narrow">
          {!getLink() || !on ? (
            <div className="empty">
              <LuGlobe aria-hidden="true" style={{ width: 34, height: 34 }} />
              <p>
                Online orders are off. The owner switches them on in <b>Settings → Website &amp; QR menu</b>.
              </p>
            </div>
          ) : (
            <>
              <h2 className="sec-h">
                New <span className="count">{news.length}</span>
              </h2>
              {news.length === 0 && <p className="muted">No new orders. They appear here (with a sound) as customers order.</p>}
              <div className="web-list">
                {news.map((r) => (
                  <div key={r.id} className="web-card new">
                    <div className="web-head">
                      <b className="web-no">WEB {r.number}</b>
                      <span className="web-mode">{r.mode === 'table' ? `Table ${r.table_name ?? ''}` : r.mode === 'delivery' ? 'Delivery' : 'Pick-up'}</span>
                      <span className="muted">
                        <LuClock aria-hidden="true" /> {minutesSince(r.created_at)} min ago
                      </span>
                    </div>
                    <div className="web-who">
                      {r.customer_name} ·{' '}
                      <a href={`tel:${r.phone.replace(/\s/g, '')}`}>
                        <LuPhone aria-hidden="true" /> {r.phone}
                      </a>
                    </div>
                    <ul className="web-lines">
                      {r.lines.map((l, i) => (
                        <li key={i}>
                          <span>
                            {l.qty} × {l.name}
                            {l.extras?.length ? ` + ${l.extras.map((x) => getState().addOns.find((a) => a.id === x)?.name ?? x).join(', ')}` : ''}
                            {l.note ? <em> — {l.note}</em> : null}
                          </span>
                          <span>{fmt(l.qty * l.unitPrice, base)}</span>
                        </li>
                      ))}
                    </ul>
                    <div className="web-total">
                      Total <b>{fmt(Number(r.total), base)}</b> · pays at the counter
                    </div>
                    <div className="web-actions">
                      <span className="muted">Ready in</span>
                      {MINUTES.map((m) => (
                        <button key={m} className="btn primary" disabled={busy === r.id} onClick={() => accept(r, m)}>
                          <LuCheck aria-hidden="true" /> {m} min
                        </button>
                      ))}
                      <button className="btn danger" disabled={busy === r.id} onClick={() => decline(r)}>
                        <LuX aria-hidden="true" /> Decline
                      </button>
                    </div>
                  </div>
                ))}
              </div>

              <h2 className="sec-h" style={{ marginTop: 28 }}>
                Accepted <span className="count">{open.length}</span>
              </h2>
              {open.length === 0 && <p className="muted">Accepted orders wait here until the customer pays and collects.</p>}
              <div className="web-list">
                {open.map((o) => {
                  const due = tabDue(orders, o);
                  const ready = o.status === 'ready' || o.status === 'served';
                  return (
                    <div key={o.id} className={`web-card ${ready ? 'ready' : ''}`}>
                      <div className="web-head">
                        <b className="web-no">{o.table?.name}</b>
                        <span className={`web-state ${ready ? 'ready' : ''}`}>{ready ? 'Ready — waiting for the customer' : 'In the kitchen'}</span>
                        <span className="muted">{minutesSince(o.createdAt)} min ago</span>
                      </div>
                      <div className="web-who">
                        {o.online!.name} · <a href={`tel:${o.online!.phone.replace(/\s/g, '')}`}>{o.online!.phone}</a>
                      </div>
                      <div className="web-total">{o.lines.map((l) => `${l.qty} × ${lineLabel(l)}`).join(', ')}</div>
                      <div className="web-actions">
                        <button className="btn primary" onClick={() => setPaying(o.id)}>
                          Take payment {fmt(due, base)}
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </>
          )}
        </div>
      </div>
      {payTab && (
        <PayDialog
          tillId="online"
          total={tabDue(orders, payTab)}
          orderTypeId={payTab.orderTypeId}
          lines={payTab.lines}
          cashierId={user.id}
          tabPay={{ tabId: payTab.id, label: payTab.online!.name }}
          onCancel={() => setPaying(null)}
          onDone={() => setPaying(null)}
          onTabPaid={(r) => {
            setPaying(null);
            toast(r.closed ? `${payTab.table?.name} paid — collected` : `Paid. Still to pay ${fmt(r.due, base)}`);
          }}
        />
      )}
    </div>
  );
}

/** Rings and shows a banner on any screen when a new online order comes in. */
export function OnlineOrderAlert() {
  const user = useCurrentUser();
  const { path } = useRoute();
  const [latest, setLatest] = useState<RemoteOnlineOrder | null>(null);
  useEffect(() => {
    onNewOnlineOrder((o) => {
      setLatest(o);
      beep();
    });
    return () => onNewOnlineOrder(null);
  }, []);
  const { news } = useOnlineOrders();
  if (!user || !latest || path === '/online' || !news.some((n) => n.id === latest.id)) return null;
  if (user.role === 'kitchen') return null;
  return (
    <div className="web-alert" role="alert">
      <LuBellRing aria-hidden="true" />
      <span>
        New online order <b>WEB {latest.number}</b> from {latest.customer_name}
      </span>
      <button className="btn primary" onClick={() => go('/online')}>
        Open
      </button>
      <button className="btn ghost icon-only" onClick={() => setLatest(null)} aria-label="Hide">
        <LuX aria-hidden="true" />
      </button>
    </div>
  );
}

function beep() {
  try {
    const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    const ctx = new Ctx();
    [0, 0.25, 0.5].forEach((t, i) => {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.frequency.value = i === 2 ? 1320 : 880;
      g.gain.setValueAtTime(0.0001, ctx.currentTime + t);
      g.gain.exponentialRampToValueAtTime(0.3, ctx.currentTime + t + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + t + 0.2);
      o.connect(g).connect(ctx.destination);
      o.start(ctx.currentTime + t);
      o.stop(ctx.currentTime + t + 0.22);
    });
  } catch {
    /* no sound available */
  }
}
