import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { useRoute, go } from '../router';
import { setLiveCart, useCurrentUser, useStore, type PlaceOrderSuccess } from '../store/store';
import { isSellable, mealInitials } from '../domain/rules';
import { fmt, fromBase, round2 } from '../domain/money';
import type { MenuItem, OrderLine } from '../domain/types';
import { Dialog, TopBar } from '../components/ui';
import PayDialog from './PayDialog';
import OrderDoneDialog from './OrderDoneDialog';
import CollectChangeDialog from '../components/CollectChangeDialog';
import { LuHandCoins, LuMinus, LuPlus, LuSearch, LuStar, LuTrash2, LuX } from 'react-icons/lu';


const TILL_ID = 'till-1';
const FAV = '__fav';

export default function Till() {
  const { query } = useRoute();
  const addonFor = query.get('addon') ?? undefined;
  const user = useCurrentUser()!;
  const menu = useStore((s) => s.menu);
  const components = useStore((s) => s.components);
  const categories = useStore((s) => s.categories);
  const orderTypes = useStore((s) => s.orderTypes);
  const currencies = useStore((s) => s.currencies);
  const baseCode = useStore((s) => s.settings.baseCurrency);
  const orders = useStore((s) => s.orders);
  const showFav = useStore((s) => s.settings.showFavourites !== false);

  const parent = addonFor ? orders.find((o) => o.id === addonFor) : undefined;
  const enabledTypes = useMemo(() => orderTypes.filter((t) => t.enabled), [orderTypes]);
  const base = currencies.find((c) => c.code === baseCode)!;

  const [typeId, setTypeId] = useState<string>(parent?.orderTypeId ?? enabledTypes[0]?.id ?? 'eat_in');
  const [lines, setLines] = useState<OrderLine[]>([]);
  const visibleCats = useMemo(() => categories.filter((c) => !c.hidden).sort((a, b) => a.sort - b.sort), [categories]);
  const firstCat = () => {
    if (addonFor && visibleCats.some((c) => c.id === 'drinks')) return 'drinks';
    return showFav ? FAV : visibleCats[0]?.id ?? FAV;
  };
  const [cat, setCat] = useState<string>(firstCat);
  // If the chosen button is switched off in Settings, fall back to the first one still shown.
  const catGone = cat === FAV ? !showFav : !visibleCats.some((c) => c.id === cat);
  useEffect(() => {
    if (catGone) setCat(firstCat());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [catGone]);
  const [searchOpen, setSearchOpen] = useState(false);
  const [lastLine, setLastLine] = useState<string | null>(null);
  const linesRef = useRef<HTMLDivElement>(null);
  const [search, setSearch] = useState('');
  const [paying, setPaying] = useState(false);
  const [done, setDone] = useState<PlaceOrderSuccess | null>(null);
  const [noteFor, setNoteFor] = useState<OrderLine | null>(null);
  const [collecting, setCollecting] = useState(false);

  const total = round2(lines.reduce((s, l) => s + l.qty * l.unitPrice, 0));

  const sellable = useMemo(() => menu.filter((m) => isSellable(m, { components })), [menu, components]);
  const hiddenCount = menu.length - sellable.length;

  const shown = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (q) return sellable.filter((m) => m.name.toLowerCase().includes(q));
    if (cat === FAV) return showFav ? sellable.filter((m) => m.favourite) : [];
    return sellable.filter((m) => m.categoryId === cat);
  }, [sellable, cat, search, showFav]);

  // Mirror the order on the customer display while it is being entered.
  useEffect(() => {
    if (done) return;
    if (lines.length === 0) setLiveCart(TILL_ID, null);
    else setLiveCart(TILL_ID, { orderTypeId: typeId, lines, total });
  }, [lines, typeId, total, done]);

  useEffect(() => () => setLiveCart(TILL_ID, null), []);

  const add = (m: MenuItem) => {
    const existing = lines.find((l) => l.itemId === m.id && !l.note);
    if (existing) {
      setLines((ls) => ls.map((l) => (l.id === existing.id ? { ...l, qty: l.qty + 1 } : l)));
      setLastLine(existing.id);
    } else {
      const id = crypto.randomUUID();
      setLines((ls) => [...ls, { id, itemId: m.id, name: m.name, qty: 1, unitPrice: m.price }]);
      setLastLine(id);
    }
  };

  // Keep the line just added or changed in view, so the cashier sees every tap land.
  useEffect(() => {
    if (!lastLine) return;
    const el = linesRef.current?.querySelector<HTMLElement>(`[data-line="${lastLine}"]`);
    el?.scrollIntoView({ block: 'nearest' });
    const t = setTimeout(() => setLastLine(null), 600);
    return () => clearTimeout(t);
  }, [lastLine, lines]);
  const changeQty = (id: string, d: number) =>
    setLines((ls) => ls.flatMap((l) => (l.id !== id ? [l] : l.qty + d <= 0 ? [] : [{ ...l, qty: l.qty + d }])));

  const clear = () => setLines([]);

  const finish = (r: PlaceOrderSuccess) => {
    setPaying(false);
    setDone(r);
  };

  const newOrder = () => {
    setDone(null);
    setLines([]);
    setLiveCart(TILL_ID, null);
    if (addonFor) go('/orders');
  };

  const catColor = (id: string) => categories.find((c) => c.id === id)?.color ?? '#999';

  const itemCount = lines.reduce((n, l) => n + l.qty, 0);
  const qtyOf = (id: string) => lines.filter((l) => l.itemId === id).reduce((n, l) => n + l.qty, 0);
  const pickCat = (id: string) => {
    setCat(id);
    setSearch('');
    setSearchOpen(false);
  };
  const closeSearch = () => {
    setSearch('');
    setSearchOpen(false);
  };

  return (
    <div className="app">
      <TopBar title={addonFor ? `Add to order #${parent?.number ?? ''}` : 'Sell'}>
        <button className="btn" onClick={() => setCollecting(true)}>
          <LuHandCoins aria-hidden="true" />
          Collect change
        </button>
      </TopBar>
      <div className="till">
        {/* ---------------- menu (centre) */}
        <section className="menu-panel" aria-label="Menu">
          <div className={`cat-bar ${searchOpen ? 'searching' : ''}`}>
            <label className="search">
              <LuSearch aria-hidden="true" />
              <input
                id="menu-search"
                placeholder="Search meals"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                onKeyDown={(e) => e.key === 'Escape' && closeSearch()}
                aria-label="Search meals"
                autoFocus={searchOpen}
              />
              {searchOpen && (
                <button className="search-close" onClick={closeSearch} aria-label="Close search">
                  <LuX aria-hidden="true" />
                </button>
              )}
            </label>
            <button className="search-open" onClick={() => setSearchOpen(true)} aria-label="Search meals">
              <LuSearch aria-hidden="true" />
            </button>
            {showFav && (
              <button className={`chip ${cat === FAV && !search ? 'on' : ''}`} onClick={() => pickCat(FAV)}>
                <LuStar aria-hidden="true" />
                Favourites
              </button>
            )}
            {visibleCats.map((c) => (
              <button key={c.id} className={`chip ${cat === c.id && !search ? 'on' : ''}`} onClick={() => pickCat(c.id)}>
                <span className="dot" style={{ background: c.color }} aria-hidden="true" />
                {c.name}
              </button>
            ))}
          </div>
          <div className="items">
            {shown.map((m) => {
              const q = qtyOf(m.id);
              return (
                <button
                  key={m.id}
                  className="item"
                  onClick={() => add(m)}
                  style={{ '--cat': catColor(m.categoryId) } as CSSProperties}
                  aria-label={`${m.name}, ${fmt(m.price, base)}${q ? `, ${q} in order` : ''}`}
                >
                  <div className="ph">
                    {m.photo ? (
                      <img src={m.photo} alt="" />
                    ) : (
                      <span className="mono" aria-hidden="true">
                        {mealInitials(m.name)}
                      </span>
                    )}
                  </div>
                  {q > 0 && <span className="qty-badge">{q}</span>}
                  <div className="meta">
                    <div className="nm">{m.name}</div>
                    <div className="pr">{fmt(m.price, base)}</div>
                  </div>
                </button>
              );
            })}
            {shown.length === 0 && (
              <div className="empty" style={{ gridColumn: '1/-1' }}>
                {search ? `No meal matches “${search}”.` : 'Nothing available here right now.'}
              </div>
            )}
          </div>
          {hiddenCount > 0 && <div className="hidden-note">{hiddenCount} meal(s) hidden because they are sold out.</div>}
        </section>

        {/* ---------------- current order (right; docked under the meals on phones) */}
        <section className="ticket-panel" aria-label="Current order">
          <div className="order-head">
            <h2>
              {parent ? `Adding to #${parent.number}` : 'Order'}
              {itemCount > 0 && <span className="muted"> · {itemCount} {itemCount === 1 ? 'item' : 'items'}</span>}
            </h2>
          </div>
          {parent ? (
            <div className="addon-banner">
              <span>
                Drinks or extras for card <b>#{parent.number}</b> ({orderTypes.find((t) => t.id === parent.orderTypeId)?.name})
              </span>
              <button className="btn" onClick={() => go('/till')}>
                Cancel
              </button>
            </div>
          ) : (
            <div className="type-toggle" role="radiogroup" aria-label="Order type">
              {enabledTypes.map((t) => (
                <button key={t.id} role="radio" aria-checked={typeId === t.id} className={`${t.id} ${typeId === t.id ? 'on' : ''}`} onClick={() => setTypeId(t.id)}>
                  {t.name}
                  <small>{t.packaging}</small>
                </button>
              ))}
            </div>
          )}
          <div className="lines" ref={linesRef}>
            {lines.length === 0 && <div className="empty">Tap a meal to add it.</div>}
            {lines.map((l) => (
              <div key={l.id} data-line={l.id} className={`line-row ${lastLine === l.id ? 'just' : ''}`}>
                <div className="qty">
                  <button onClick={() => changeQty(l.id, -1)} aria-label={`One less ${l.name}`}>
                    <LuMinus aria-hidden="true" />
                  </button>
                  <span>{l.qty}</span>
                  <button onClick={() => changeQty(l.id, 1)} aria-label={`One more ${l.name}`}>
                    <LuPlus aria-hidden="true" />
                  </button>
                </div>
                <div>
                  <div className="nm">{l.name}</div>
                  <button className="note-btn" onClick={() => setNoteFor(l)}>
                    {l.note ? <span className="nt">{l.note}</span> : '+ Note'}
                  </button>
                </div>
                <div className="pr">{fmt(l.qty * l.unitPrice, base)}</div>
              </div>
            ))}
          </div>
          <div className="totals">
            <div className="total-row">
              <span>Total{itemCount > 0 && <span className="count"> · {itemCount} {itemCount === 1 ? 'item' : 'items'}</span>}</span>
              <span>{fmt(total, base)}</span>
            </div>
            <div className="alt">
              {currencies
                .filter((c) => c.enabled && c.code !== baseCode)
                .map((c) => (
                  <span key={c.code}>{fmt(fromBase(total, c), c)}</span>
                ))}
            </div>
            <div className="actions">
              <button className="btn big icon-only" onClick={clear} disabled={!lines.length} aria-label="Clear order" title="Clear order">
                <LuTrash2 aria-hidden="true" />
              </button>
              <button className="btn big primary" onClick={() => setPaying(true)} disabled={!lines.length}>
                Pay {fmt(total, base)}
              </button>
            </div>
          </div>
        </section>
      </div>

      {paying && (
        <PayDialog
          tillId={TILL_ID}
          total={total}
          orderTypeId={parent?.orderTypeId ?? typeId}
          lines={lines}
          parentOrderId={parent?.id}
          cashierId={user.id}
          onCancel={() => {
            setPaying(false);
            setLiveCart(TILL_ID, { orderTypeId: typeId, lines, total });
          }}
          onDone={finish}
        />
      )}
      {done && <OrderDoneDialog result={done} onNew={newOrder} />}
      {collecting && <CollectChangeDialog onClose={() => setCollecting(false)} />}
      {noteFor && (
        <NoteDialog
          line={noteFor}
          onClose={() => setNoteFor(null)}
          onSave={(note) => {
            setLines((ls) => ls.map((l) => (l.id === noteFor.id ? { ...l, note: note || undefined } : l)));
            setNoteFor(null);
          }}
        />
      )}
    </div>
  );
}

const QUICK_NOTES = ['No gravy', 'Extra gravy', 'No greens', 'Soft sadza', 'Spicy', 'Well done'];

function NoteDialog({ line, onClose, onSave }: { line: OrderLine; onClose: () => void; onSave: (n: string) => void }) {
  const [note, setNote] = useState(line.note ?? '');
  return (
    <Dialog
      title={`Note for ${line.name}`}
      onClose={onClose}
      width={520}
      footer={
        <>
          <button className="btn" onClick={onClose}>
            Cancel
          </button>
          <button className="btn primary" onClick={() => onSave(note.trim())}>
            Save note
          </button>
        </>
      }
    >
      <div className="seg">
        {QUICK_NOTES.map((q) => (
          <button key={q} onClick={() => setNote((n) => (n ? `${n}, ${q}` : q))}>
            {q}
          </button>
        ))}
      </div>
      <label className="field">
        Note (prints on the kitchen ticket)
        <input autoFocus value={note} onChange={(e) => setNote(e.target.value)} />
      </label>
    </Dialog>
  );
}
