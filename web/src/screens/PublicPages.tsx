/**
 * What customers see (no login):
 *   #/r/<web address>          the restaurant's page: details, today's menu, ordering (when switched on)
 *   #/r/<web address>?t=T4     the same from a table's QR code (orders go to that table)
 *   #/o/<private code>         the customer's order: accepted, ready, collected
 */
import { useEffect, useMemo, useState } from 'react';
import { LuClock, LuMapPin, LuMessageCircle, LuMinus, LuPhone, LuPlus, LuShoppingBasket, LuWifiOff, LuX, LuCircleCheck, LuChefHat, LuStore } from 'react-icons/lu';
import { rpc } from '../cloud/api';

interface PubItem { id: string; name: string; price: number; categoryId: string; emoji: string; photo?: string; available: boolean; addOnIds: string[]; sort?: number }
interface PubAddOn { id: string; name: string; price: number; available: boolean }
interface PubMenu {
  slug: string; name: string; town: string | null; info: { phone?: string; whatsapp?: string; address?: string; hours?: string; about?: string; tableOrders?: boolean };
  webPage: boolean; qrMenu: boolean; onlineOrders: boolean; online: boolean; updatedAt: string | null;
  categories: { id: string; name: string; sort: number }[]; items: PubItem[]; addOns: PubAddOn[]; symbol: string;
  tagline?: string | null; logo?: string | null; brandColor?: string | null;
}
interface CartLine { key: string; itemId: string; name: string; qty: number; unit: number; extras: string[] }

const money = (sym: string, n: number) => `${sym}${Number(n).toFixed(2)}`;
const MINE_KEY = 'techplug.my-orders';

function useMenu(slug: string) {
  const [menu, setMenu] = useState<PubMenu | null | undefined>(undefined);
  const [error, setError] = useState('');
  useEffect(() => {
    let alive = true;
    const load = () =>
      rpc<PubMenu | null>('public_menu', { p_slug: slug })
        .then((m) => alive && (setMenu(m), setError('')))
        .catch((e) => alive && setError(e instanceof Error ? e.message : String(e)));
    void load();
    const t = setInterval(load, 30000); // sold-out changes show up within half a minute
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, [slug]);
  // also the brand colour etc. from the published menu record
  return { menu, error };
}

export function RestaurantPage({ slug, table }: { slug: string; table?: string }) {
  const { menu, error } = useMenu(slug);
  const [cart, setCart] = useState<CartLine[]>([]);
  const [picking, setPicking] = useState<PubItem | null>(null);
  const [checkout, setCheckout] = useState(false);
  const extra = menu;

  useEffect(() => {
    document.title = menu?.name ? `${menu.name} — menu` : 'Menu';
    if (extra?.brandColor) document.documentElement.style.setProperty('--brand', extra.brandColor);
  }, [menu?.name, extra?.brandColor]);

  if (menu === undefined && !error) return <div className="pub"><div className="pub-wait">Loading the menu…</div></div>;
  if (error && !menu) return <div className="pub"><div className="pub-wait">Could not load the menu. Check your internet and try again.</div></div>;
  if (!menu) return <div className="pub"><div className="pub-wait"><LuStore aria-hidden="true" /> This restaurant's page is not available.</div></div>;

  const sym = menu.symbol || '$';
  const showMenu = menu.online && (menu.qrMenu || menu.webPage);
  const canOrder = menu.online && menu.onlineOrders && (!table || menu.info.tableOrders);
  const cats = [...menu.categories].sort((a, b) => a.sort - b.sort).filter((c) => menu.items.some((i) => i.categoryId === c.id));
  const count = cart.reduce((a, l) => a + l.qty, 0);
  const total = cart.reduce((a, l) => a + l.qty * l.unit, 0);
  const add = (it: PubItem, extras: string[]) => {
    const unit = it.price + extras.reduce((a, id) => a + (menu.addOns.find((x) => x.id === id)?.price ?? 0), 0);
    const key = it.id + '|' + [...extras].sort().join(',');
    setCart((c) => (c.some((l) => l.key === key) ? c.map((l) => (l.key === key ? { ...l, qty: l.qty + 1 } : l)) : [...c, { key, itemId: it.id, name: it.name, qty: 1, unit, extras }]));
  };
  const tap = (it: PubItem) => {
    if (!canOrder || !it.available) return;
    const offered = it.addOnIds.map((id) => menu.addOns.find((a) => a.id === id)).filter((a) => a?.available);
    if (offered.length) setPicking(it);
    else add(it, []);
  };

  return (
    <div className="pub">
      <header className="pub-head">
        {extra?.logo ? <img className="pub-logo" src={extra.logo} alt="" /> : <div className="pub-logo ph">{menu.name.slice(0, 1)}</div>}
        <div>
          <h1>{menu.name}</h1>
          {extra?.tagline && <p className="pub-tag">{extra.tagline}</p>}
          <div className={`pub-live ${menu.online ? 'on' : 'off'}`}>
            <span className="dot" /> {menu.online ? 'Open now · menu is live' : 'Menu not live right now'}
            {table && <span className="pub-table">Table {table}</span>}
          </div>
        </div>
      </header>

      <div className="pub-info">
        {menu.info.address || menu.town ? (
          <span>
            <LuMapPin aria-hidden="true" /> {[menu.info.address, menu.town].filter(Boolean).join(', ')}
          </span>
        ) : null}
        {menu.info.hours && (
          <span>
            <LuClock aria-hidden="true" /> {menu.info.hours}
          </span>
        )}
        {menu.info.phone && (
          <a href={`tel:${menu.info.phone.replace(/\s/g, '')}`}>
            <LuPhone aria-hidden="true" /> {menu.info.phone}
          </a>
        )}
        {menu.info.whatsapp && (
          <a href={`https://wa.me/${menu.info.whatsapp.replace(/\D/g, '').replace(/^0/, '263')}`} target="_blank" rel="noreferrer">
            <LuMessageCircle aria-hidden="true" /> WhatsApp
          </a>
        )}
      </div>
      {menu.info.about && <p className="pub-about">{menu.info.about}</p>}

      {!showMenu ? (
        <div className="pub-off">
          <LuWifiOff aria-hidden="true" />
          <b>Today's menu is not live right now</b>
          <p>The restaurant's system is offline or closed, so we can't show what is available. Please ask at the counter.</p>
        </div>
      ) : (
        <>
          {canOrder ? (
            <p className="pub-hint">Tap a meal to add it. You pay at the counter{table ? '' : ' when you collect'}.</p>
          ) : menu.onlineOrders && table ? (
            <p className="pub-hint">Order at the counter — this is today's menu.</p>
          ) : null}
          <nav className="pub-cats">
            {cats.map((c) => (
              <a key={c.id} href={`#/r/${slug}${table ? `?t=${encodeURIComponent(table)}` : ''}`} onClick={(e) => { e.preventDefault(); document.getElementById(`cat-${c.id}`)?.scrollIntoView({ behavior: 'smooth' }); }}>
                {c.name}
              </a>
            ))}
          </nav>
          {cats.map((c) => (
            <section key={c.id} id={`cat-${c.id}`} className="pub-sec">
              <h2>{c.name}</h2>
              <div className="pub-items">
                {menu.items
                  .filter((i) => i.categoryId === c.id)
                  .sort((a, b) => Number(b.available) - Number(a.available) || (a.sort ?? 0) - (b.sort ?? 0))
                  .map((i) => {
                    const inCart = cart.filter((l) => l.itemId === i.id).reduce((a, l) => a + l.qty, 0);
                    return (
                      <button key={i.id} className={`pub-item ${i.available ? '' : 'out'}`} onClick={() => tap(i)} disabled={!i.available || !canOrder} aria-label={`${i.name} ${money(sym, i.price)}${i.available ? '' : ' sold out'}`}>
                        {i.photo ? <img src={i.photo} alt="" loading="lazy" /> : <span className="pub-emoji">{i.emoji}</span>}
                        <span className="pub-name">{i.name}</span>
                        <span className="pub-price">{i.available ? money(sym, i.price) : 'Sold out today'}</span>
                        {inCart > 0 && <span className="pub-qty">{inCart}</span>}
                      </button>
                    );
                  })}
              </div>
            </section>
          ))}
          {menu.updatedAt && <p className="pub-foot">Availability updated {new Date(menu.updatedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</p>}
        </>
      )}
      <p className="pub-powered">Powered by TechPlug POS</p>

      {count > 0 && canOrder && !checkout && (
        <button className="pub-cartbar" onClick={() => setCheckout(true)}>
          <LuShoppingBasket aria-hidden="true" /> {count} item{count === 1 ? '' : 's'} · {money(sym, total)} <b>Order</b>
        </button>
      )}
      {picking && <AddOnPicker item={picking} menu={menu} onClose={() => setPicking(null)} onAdd={(x) => (add(picking, x), setPicking(null))} />}
      {checkout && <Checkout menu={menu} table={table} cart={cart} setCart={setCart} onClose={() => setCheckout(false)} />}
    </div>
  );
}

function AddOnPicker({ item, menu, onClose, onAdd }: { item: PubItem; menu: PubMenu; onClose: () => void; onAdd: (extras: string[]) => void }) {
  const [sel, setSel] = useState<string[]>([]);
  const offered = item.addOnIds.map((id) => menu.addOns.find((a) => a.id === id)).filter((a): a is PubAddOn => !!a && a.available);
  return (
    <div className="pub-sheet-wrap" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="pub-sheet" role="dialog" aria-label={item.name}>
        <header>
          <b>{item.name}</b>
          <button onClick={onClose} aria-label="Close"><LuX /></button>
        </header>
        <p className="muted">Anything extra?</p>
        {offered.map((a) => (
          <label key={a.id} className="pub-check">
            <input type="checkbox" checked={sel.includes(a.id)} onChange={(e) => setSel((s) => (e.target.checked ? [...s, a.id] : s.filter((x) => x !== a.id)))} />
            <span>{a.name}</span>
            <span>{a.price ? `+${money(menu.symbol, a.price)}` : 'free'}</span>
          </label>
        ))}
        <button className="pub-btn" onClick={() => onAdd(sel)}>Add to order</button>
      </div>
    </div>
  );
}

function Checkout({ menu, table, cart, setCart, onClose }: { menu: PubMenu; table?: string; cart: CartLine[]; setCart: (f: (c: CartLine[]) => CartLine[]) => void; onClose: () => void }) {
  const [name, setName] = useState(() => localStorage.getItem('techplug.name') ?? '');
  const [phone, setPhone] = useState(() => localStorage.getItem('techplug.phone') ?? '');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const sym = menu.symbol;
  const total = cart.reduce((a, l) => a + l.qty * l.unit, 0);
  const send = async () => {
    if (!name.trim()) return setError('Type your name, so we can call you.');
    if (phone.replace(/\D/g, '').length < 9) return setError('Type your phone number.');
    setError('');
    setBusy(true);
    try {
      const lines = cart.map((l, i) => ({ itemId: l.itemId, qty: l.qty, extras: l.extras, ...(i === 0 && note.trim() ? { note: note.trim() } : {}) }));
      const r = await rpc<{ number: number; token: string; total: number }>('place_online_order', {
        p_slug: menu.slug, p_name: name.trim(), p_phone: phone.trim(), p_mode: table ? 'table' : 'pickup', p_lines: lines, p_table: table ?? null, p_address: null,
      });
      try {
        localStorage.setItem('techplug.name', name.trim());
        localStorage.setItem('techplug.phone', phone.trim());
        const mine = JSON.parse(localStorage.getItem(MINE_KEY) || '[]');
        localStorage.setItem(MINE_KEY, JSON.stringify([{ token: r.token, slug: menu.slug, at: Date.now() }, ...mine].slice(0, 10)));
      } catch { /* ignore */ }
      location.hash = `#/o/${r.token}`;
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="pub-sheet-wrap" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="pub-sheet" role="dialog" aria-label="Your order">
        <header>
          <b>Your order{table ? ` · Table ${table}` : ''}</b>
          <button onClick={onClose} aria-label="Close"><LuX /></button>
        </header>
        <ul className="pub-lines">
          {cart.map((l) => (
            <li key={l.key}>
              <span className="grow">
                {l.name}
                {l.extras.length ? <small> + {l.extras.map((id) => menu.addOns.find((a) => a.id === id)?.name).join(', ')}</small> : null}
              </span>
              <span className="pub-step">
                <button aria-label="One less" onClick={() => setCart((c) => c.flatMap((x) => (x.key === l.key ? (x.qty > 1 ? [{ ...x, qty: x.qty - 1 }] : []) : [x])))}><LuMinus /></button>
                <b>{l.qty}</b>
                <button aria-label="One more" onClick={() => setCart((c) => c.map((x) => (x.key === l.key ? { ...x, qty: Math.min(20, x.qty + 1) } : x)))}><LuPlus /></button>
              </span>
              <span>{money(sym, l.qty * l.unit)}</span>
            </li>
          ))}
        </ul>
        <div className="pub-total">Total <b>{money(sym, total)}</b></div>
        <label className="pub-field">Your name<input value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" /></label>
        <label className="pub-field">Phone number<input value={phone} onChange={(e) => setPhone(e.target.value)} inputMode="tel" autoComplete="tel" placeholder="e.g. 0772 123 456" /></label>
        <label className="pub-field">Note for the kitchen (optional)<input value={note} onChange={(e) => setNote(e.target.value)} maxLength={120} placeholder="e.g. no greens" /></label>
        <p className="muted small">{table ? 'Your food comes to your table. You pay before you leave.' : 'Pick-up: you pay at the counter when you collect.'}</p>
        {error && <div className="pub-error">{error}</div>}
        <button className="pub-btn" onClick={send} disabled={busy || cart.length === 0}>{busy ? 'Sending…' : `Send order · ${money(sym, total)}`}</button>
      </div>
    </div>
  );
}

interface Status { number: number; status: string; readyMinutes: number | null; total: number; lines: { name: string; qty: number; unitPrice: number }[]; mode: string; restaurant: string; createdAt: string; updatedAt: string }

export function OrderStatusPage({ token }: { token: string }) {
  const [s, setS] = useState<Status | null | undefined>(undefined);
  const [cancelling, setCancelling] = useState(false);
  const slug = useMemo(() => {
    try {
      return (JSON.parse(localStorage.getItem(MINE_KEY) || '[]') as { token: string; slug: string }[]).find((x) => x.token === token)?.slug;
    } catch {
      return undefined;
    }
  }, [token]);
  useEffect(() => {
    let alive = true;
    const load = () => rpc<Status | null>('online_order_status', { p_token: token }).then((x) => alive && setS(x)).catch(() => undefined);
    void load();
    const t = setInterval(load, 6000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, [token]);
  useEffect(() => {
    if (s?.restaurant) document.title = `Order ${s.number} — ${s.restaurant}`;
  }, [s?.number, s?.restaurant]);
  if (s === undefined) return <div className="pub"><div className="pub-wait">Loading your order…</div></div>;
  if (!s) return <div className="pub"><div className="pub-wait">Order not found.</div></div>;
  const ready = s.status === 'ready';
  const step = { new: 0, accepted: 1, ready: 2, collected: 3 }[s.status as 'new'] ?? -1;
  const readyBy = s.readyMinutes ? new Date(Date.parse(s.updatedAt) + s.readyMinutes * 60000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : null;
  return (
    <div className="pub">
      <div className={`pub-status ${s.status}`}>
        <p className="muted">{s.restaurant}</p>
        <div className="pub-big">WEB {s.number}</div>
        {s.status === 'new' && <><b>Waiting for the restaurant to accept…</b><p>Keep this page open. It updates by itself.</p></>}
        {s.status === 'accepted' && <><LuChefHat aria-hidden="true" /><b>Accepted — being prepared</b>{readyBy && <p>Ready at about <b>{readyBy}</b></p>}</>}
        {ready && <><LuCircleCheck aria-hidden="true" /><b>Your food is ready!</b><p>{s.mode === 'table' ? 'It is on its way to your table.' : 'Come to the counter, say your order number and pay there.'}</p></>}
        {s.status === 'collected' && <><LuCircleCheck aria-hidden="true" /><b>Paid and collected. Enjoy your meal!</b></>}
        {s.status === 'declined' && <><b>Sorry — the restaurant could not take this order.</b><p>Please order at the counter or try again later.</p></>}
        {s.status === 'cancelled' && <b>This order was cancelled.</b>}
      </div>
      {step >= 0 && (
        <ol className="pub-steps">
          {['Sent', 'Accepted', 'Ready', 'Collected'].map((l, i) => <li key={l} className={i <= step ? 'on' : ''}>{l}</li>)}
        </ol>
      )}
      <ul className="pub-lines static">
        {s.lines.map((l, i) => <li key={i}><span className="grow">{l.qty} × {l.name}</span><span>{(l.qty * l.unitPrice).toFixed(2)}</span></li>)}
      </ul>
      <div className="pub-total">Total <b>{Number(s.total).toFixed(2)}</b> · pay at the counter</div>
      {s.status === 'new' && (
        <button className="pub-btn ghost" disabled={cancelling} onClick={async () => { setCancelling(true); await rpc('cancel_online_order', { p_token: token }).catch(() => undefined); setS({ ...s, status: 'cancelled' }); }}>
          Cancel my order
        </button>
      )}
      {slug && <a className="pub-btn ghost" href={`#/r/${slug}`}>Back to the menu</a>}
      <p className="pub-powered">Powered by TechPlug POS</p>
    </div>
  );
}
