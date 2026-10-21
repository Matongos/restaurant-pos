import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { useRoute, go } from '../router';
import { setLiveCart, useCurrentUser, useStore, type PlaceOrderSuccess } from '../store/store';
import { comesWith, isSellable, mealInitials, nextFreeCard, todayISO } from '../domain/rules';
import { fmt, fromBase, round2 } from '../domain/money';
import type { MenuItem, OrderLine } from '../domain/types';
import { Dialog, MoreMenu, TopBar } from '../components/ui';
import PayDialog from './PayDialog';
import OrderDoneDialog from './OrderDoneDialog';
import CollectChangeDialog from '../components/CollectChangeDialog';
import { LuArrowRight, LuArrowRightLeft, LuCheck, LuChevronDown, LuChevronRight, LuChevronUp, LuCreditCard, LuHandCoins, LuMessageSquarePlus, LuMinus, LuPackage, LuPlus, LuSearch, LuStar, LuTrash2, LuUtensils, LuX } from 'react-icons/lu';


const TILL_ID = 'till-1';
const FAV = '__fav';
const ALL = '__all';

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
  const catGone = cat === ALL ? false : cat === FAV ? !showFav : !visibleCats.some((c) => c.id === cat);
  useEffect(() => {
    if (catGone) setCat(firstCat());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [catGone]);
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
    if (cat === ALL) return sellable;
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

  // Parts that have run out (e.g. coslo) are left out automatically and shown on the line.
  const finishedParts = (m: MenuItem) => comesWith(m, components).filter((c) => !c.available).map((c) => c.name);
  const sameWithout = (a?: string[], b?: string[]) => [...(a ?? [])].sort().join('|') === [...(b ?? [])].sort().join('|');

  const add = (m: MenuItem) => {
    const auto = finishedParts(m);
    const existing = lines.find((l) => l.itemId === m.id && !l.note && sameWithout(l.without, auto));
    if (existing) {
      setLines((ls) => ls.map((l) => (l.id === existing.id ? { ...l, qty: l.qty + 1 } : l)));
      setLastLine(existing.id);
    } else {
      const id = crypto.randomUUID();
      setLines((ls) => [...ls, { id, itemId: m.id, name: m.name, qty: 1, unitPrice: m.price, without: auto.length ? auto : undefined }]);
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
  /** One tap: "Coslo" ⇄ "No coslo" for this line. */
  const toggleWithout = (id: string, part: string) =>
    setLines((ls) =>
      ls.map((l) => {
        if (l.id !== id) return l;
        const has = l.without?.includes(part);
        const without = has ? l.without!.filter((w) => w !== part) : [...(l.without ?? []), part];
        return { ...l, without: without.length ? without : undefined };
      }),
    );

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
  };

  // The number this customer will get (card or slip), shown on the order like a ticket number.
  const settings = useStore((s) => s.settings);
  const dayCounter = useStore((s) => s.dayCounter);
  const nextNumber = parent
    ? parent.number
    : settings.numberMode === 'slip'
      ? (dayCounter.date === todayISO() ? dayCounter.lastSlip : 0) + 1
      : nextFreeCard(orders, settings.cardFrom, settings.cardTo);
  const altCurrencies = currencies.filter((c) => c.enabled && c.code !== baseCode);
  const listTitle = search ? `Results` : cat === ALL ? 'All meals' : cat === FAV ? 'Favourites' : categories.find((c) => c.id === cat)?.name ?? '';
  const [sheet, setSheet] = useState(false);
  const orderNo = nextNumber ? `#${String(nextNumber).padStart(4, '0')}` : '';
  // Phones: categories stay on one line; a › button appears while more are hidden to the right.
  const chipsRef = useRef<HTMLDivElement>(null);
  const [chipsMore, setChipsMore] = useState(false);
  const checkChips = () => {
    const el = chipsRef.current;
    setChipsMore(!!el && el.scrollWidth - el.scrollLeft - el.clientWidth > 4);
  };
  useEffect(() => {
    checkChips();
    window.addEventListener('resize', checkChips);
    return () => window.removeEventListener('resize', checkChips);
  }, [visibleCats.length, showFav]);
  const typeIcon = (id: string) => (id === 'take_away' ? <LuPackage aria-hidden="true" /> : <LuUtensils aria-hidden="true" />);

  const lineRows = (inSheet: boolean) =>
    lines.map((l) => {
      const m = menu.find((x) => x.id === l.itemId);
      return (
        <div key={l.id} data-line={inSheet ? undefined : l.id} className={`line-row ${lastLine === l.id ? 'just' : ''}`}>
          <span className="line-thumb" style={{ '--cat': catColor(m?.categoryId ?? '') } as CSSProperties} aria-hidden="true">
            {m?.photo ? <img src={m.photo} alt="" /> : mealInitials(l.name)}
          </span>
          <div className="line-main">
            <div className="nm-row">
              <span className="nm">{l.name}</span>
              <button className={`note-btn ${l.note ? 'has' : ''}`} onClick={() => setNoteFor(l)} aria-label={l.note ? `Note: ${l.note}. Tap to change` : `Add a note for ${l.name}`} title={l.note ? 'Change note' : 'Add note'}>
                <LuMessageSquarePlus aria-hidden="true" />
              </button>
            </div>
            <div className="line-opts">
              <span className="pr">{fmt(l.qty * l.unitPrice, base)}</span>
              {comesWith(m, components).map((c) => {
                const off = l.without?.includes(c.name);
                return (
                  <button
                    key={c.id}
                    className={`opt-chip ${off ? 'off' : ''}`}
                    onClick={() => c.available && toggleWithout(l.id, c.name)}
                    aria-pressed={!off}
                    aria-label={off ? `No ${c.name} — tap to include` : `With ${c.name} — tap for no ${c.name}`}
                    disabled={!c.available}
                  >
                    {off ? <LuX aria-hidden="true" /> : <LuCheck aria-hidden="true" />}
                    {off ? `No ${c.name.toLowerCase()}` : c.name}
                    {!c.available && ' · finished'}
                  </button>
                );
              })}
              {l.note && (
                <button className="nt" onClick={() => setNoteFor(l)}>
                  {l.note}
                </button>
              )}
            </div>
          </div>
          <div className="qty">
            <button onClick={() => changeQty(l.id, -1)} aria-label={`One less ${l.name}`}>
              <LuMinus aria-hidden="true" />
            </button>
            <span>{l.qty}</span>
            <button onClick={() => changeQty(l.id, 1)} aria-label={`One more ${l.name}`}>
              <LuPlus aria-hidden="true" />
            </button>
          </div>
          <button className="line-del" onClick={() => changeQty(l.id, -l.qty)} aria-label={`Remove ${l.name}`}>
            <LuTrash2 aria-hidden="true" />
          </button>
        </div>
      );
    });

  return (
    <div className="app">
      <TopBar title={addonFor ? `Add to #${parent?.number ?? ''}` : 'Sell'}>
        <button className="btn collect-btn" onClick={() => setCollecting(true)}>
          <LuArrowRightLeft aria-hidden="true" />
          <span>Collect change</span>
        </button>
      </TopBar>
      <div className="till">
        {/* ---------------- menu */}
        <section className="menu-panel" aria-label="Menu">
          <div className="menu-tools">
            <label className="search">
              <LuSearch aria-hidden="true" />
              <input
                id="menu-search"
                placeholder="Search meals, drinks…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                onKeyDown={(e) => e.key === 'Escape' && setSearch('')}
                aria-label="Search meals and drinks"
              />
              {search && (
                <button className="search-close" onClick={() => setSearch('')} aria-label="Clear search">
                  <LuX aria-hidden="true" />
                </button>
              )}
            </label>
            <div className="chips-wrap">
            <div className="chips" role="tablist" aria-label="Categories" ref={chipsRef} onScroll={checkChips}>
              {showFav && (
                <button role="tab" aria-selected={cat === FAV && !search} className={`chip ${cat === FAV && !search ? 'on' : ''}`} onClick={() => pickCat(FAV)}>
                  <LuStar aria-hidden="true" />
                  Favourites
                </button>
              )}
              {visibleCats.map((c) => (
                <button key={c.id} role="tab" aria-selected={cat === c.id && !search} className={`chip ${cat === c.id && !search ? 'on' : ''}`} onClick={() => pickCat(c.id)}>
                  <span className="dot" style={{ background: c.color }} aria-hidden="true" />
                  {c.name}
                </button>
              ))}
            </div>
            {chipsMore && (
              <button className="chips-next" onClick={() => chipsRef.current?.scrollBy({ left: 160, behavior: 'smooth' })} aria-label="More categories">
                <LuChevronRight aria-hidden="true" />
              </button>
            )}
            </div>
          </div>
          <div className="items-head">
            <h2>
              {listTitle} <span className="n-paren">({shown.length})</span>
              <span className="n-dot">· {shown.length}</span>
            </h2>
            {!search && cat !== ALL && (
              <button className="view-all" onClick={() => pickCat(ALL)}>
                View all <LuArrowRight aria-hidden="true" />
              </button>
            )}
          </div>
          <div className="items">
            {shown.map((m) => {
              const q = qtyOf(m.id);
              return (
                <button
                  key={m.id}
                  className={`item ${m.photo ? 'has-photo' : ''}`}
                  onClick={() => add(m)}
                  style={{ '--cat': catColor(m.categoryId) } as CSSProperties}
                  aria-label={`${m.name}, ${fmt(m.price, base)}${q ? `, ${q} in order` : ''}`}
                >
                  <div className="item-top">
                    <span className="mono" aria-hidden="true">
                      {mealInitials(m.name)}
                    </span>
                    {m.photo && <img className="item-photo" src={m.photo} alt="" />}
                  </div>
                  {q > 0 && <span className="qty-badge">{q}</span>}
                  <div className="meta">
                    <div className="nm">{m.name}</div>
                    <div className="pr-row">
                      <span className="pr">{fmt(m.price, base)}</span>
                      <span className="add-dot" aria-hidden="true">
                        <LuPlus />
                      </span>
                    </div>
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

        {/* ---------------- current order: a card on the right; docked at the bottom on phones */}
        <section className="ticket-panel" aria-label="Current order">
          <div className="order-top">
            <h2>{parent ? 'Add to order' : 'Order'}</h2>
            {orderNo && <span className="order-no">{orderNo}</span>}
            <MoreMenu
              down
              vertical
              label="Order options"
              items={[
                { label: 'Collect change', icon: <LuHandCoins aria-hidden="true" />, onClick: () => setCollecting(true) },
                ...(lines.length ? [{ label: 'Clear order', icon: <LuTrash2 aria-hidden="true" />, danger: true, onClick: clear }] : []),
              ]}
            />
          </div>
          {lines.length > 0 && (
            <div className="mini-order">
              <button className="mini-head" onClick={() => setSheet(true)} aria-label="Show the order">
                <span>
                  <b>Order {orderNo}</b>
                  <small>
                    {itemCount} {itemCount === 1 ? 'item' : 'items'}
                  </small>
                </span>
                <b className="mini-total">{fmt(total, base)}</b>
                <LuChevronUp aria-hidden="true" />
              </button>
              <div className="mini-strip">
                {lines.map((l) => {
                  const m = menu.find((x) => x.id === l.itemId);
                  return (
                    <button key={l.id} className={`mini-card ${lastLine === l.id ? 'just' : ''}`} onClick={() => setSheet(true)} style={{ '--cat': catColor(m?.categoryId ?? '') } as CSSProperties} aria-label={`${l.qty} ${l.name}`}>
                      <span className="mono">{mealInitials(l.name)}</span>
                      {m?.photo && <img src={m.photo} alt="" />}
                      {l.qty > 1 && <span className="mini-qty">{l.qty}</span>}
                      {!!l.without?.length && <span className="mini-no">no {l.without.join(', ').toLowerCase()}</span>}
                      <span className="mini-pr">{fmt(l.qty * l.unitPrice, base)}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          )}
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
                  {typeIcon(t.id)}
                  <span>
                    {t.name}
                    <small>{t.packaging}</small>
                  </span>
                </button>
              ))}
            </div>
          )}
          <div className="lines" ref={linesRef}>
            {lines.length === 0 && <div className="empty">Tap a meal to add it.</div>}
            {lineRows(false)}
          </div>
          <div className="totals">
            <div className="sum-rows">
              <div>
                <span>
                  Subtotal ({itemCount} {itemCount === 1 ? 'item' : 'items'})
                </span>
                <b>{fmt(total, base)}</b>
              </div>
            </div>
            <div className="total-row">
              <span>Total</span>
              <span className="total-amt">
                {fmt(total, base)}
                {altCurrencies.length > 0 && total > 0 && <small>{altCurrencies.map((c) => fmt(fromBase(total, c), c)).join(' · ')}</small>}
              </span>
            </div>
            <div className="actions">
              <button className="phone-total" onClick={() => lines.length && setSheet(true)} aria-label={`Total ${fmt(total, base)}. ${itemCount} items. Show order`}>
                <span className="lbl">
                  Total
                  {itemCount > 0 && (
                    <span className="count">
                      · {itemCount} <LuChevronUp aria-hidden="true" />
                    </span>
                  )}
                </span>
                <b>{fmt(total, base)}</b>
              </button>
              <button className="btn big icon-only clear-order" onClick={clear} disabled={!lines.length} aria-label="Clear order" title="Clear order">
                <LuTrash2 aria-hidden="true" />
              </button>
              <button className="btn big primary pay-btn" onClick={() => setPaying(true)} disabled={!lines.length}>
                <LuCreditCard aria-hidden="true" />
                Pay {fmt(total, base)}
                <LuArrowRight aria-hidden="true" className="pay-arrow" />
              </button>
            </div>
          </div>
        </section>
      </div>

      {/* Phone: the order list opens as a sheet from the total */}
      {sheet && (
        <>
          <div className="sheet-scrim" onClick={() => setSheet(false)} />
          <div className="order-sheet" role="dialog" aria-label="Order">
            <div className="sheet-head">
              <h2>
                Order <span className="muted">· {itemCount} {itemCount === 1 ? 'item' : 'items'}</span>
              </h2>
              <button className="btn ghost icon-only" onClick={() => setSheet(false)} aria-label="Close order">
                <LuChevronDown aria-hidden="true" />
              </button>
            </div>
            <div className="lines">{lineRows(true)}</div>
            <div className="sheet-foot">
              <button className="btn big" onClick={() => setSheet(false)}>
                Add more
              </button>
              <button className="btn big primary" onClick={() => { setSheet(false); setPaying(true); }} disabled={!lines.length}>
                <LuCreditCard aria-hidden="true" />
                Pay {fmt(total, base)}
              </button>
            </div>
          </div>
        </>
      )}

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
