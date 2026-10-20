import { useEffect, useMemo, useState, type CSSProperties } from 'react';
import { useRoute, go } from '../router';
import { setLiveCart, useCurrentUser, useStore, type PlaceOrderSuccess } from '../store/store';
import { isSellable } from '../domain/rules';
import { fmt, fromBase, round2 } from '../domain/money';
import type { MenuItem, OrderLine } from '../domain/types';
import { Dialog, TopBar } from '../components/ui';
import PayDialog from './PayDialog';
import OrderDoneDialog from './OrderDoneDialog';

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

  const parent = addonFor ? orders.find((o) => o.id === addonFor) : undefined;
  const enabledTypes = useMemo(() => orderTypes.filter((t) => t.enabled), [orderTypes]);
  const base = currencies.find((c) => c.code === baseCode)!;

  const [typeId, setTypeId] = useState<string>(parent?.orderTypeId ?? enabledTypes[0]?.id ?? 'eat_in');
  const [lines, setLines] = useState<OrderLine[]>([]);
  const [cat, setCat] = useState<string>(addonFor ? 'drinks' : FAV);
  const [search, setSearch] = useState('');
  const [paying, setPaying] = useState(false);
  const [done, setDone] = useState<PlaceOrderSuccess | null>(null);
  const [noteFor, setNoteFor] = useState<OrderLine | null>(null);

  const total = round2(lines.reduce((s, l) => s + l.qty * l.unitPrice, 0));

  const sellable = useMemo(() => menu.filter((m) => isSellable(m, { components })), [menu, components]);
  const hiddenCount = menu.length - sellable.length;

  const shown = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (q) return sellable.filter((m) => m.name.toLowerCase().includes(q));
    if (cat === FAV) return sellable.filter((m) => m.favourite);
    return sellable.filter((m) => m.categoryId === cat);
  }, [sellable, cat, search]);

  // Mirror the order on the customer display while it is being entered.
  useEffect(() => {
    if (done) return;
    if (lines.length === 0) setLiveCart(TILL_ID, null);
    else setLiveCart(TILL_ID, { orderTypeId: typeId, lines, total });
  }, [lines, typeId, total, done]);

  useEffect(() => () => setLiveCart(TILL_ID, null), []);

  const add = (m: MenuItem) => {
    setLines((ls) => {
      const existing = ls.find((l) => l.itemId === m.id && !l.note);
      if (existing) return ls.map((l) => (l === existing ? { ...l, qty: l.qty + 1 } : l));
      return [...ls, { id: crypto.randomUUID(), itemId: m.id, name: m.name, qty: 1, unitPrice: m.price }];
    });
  };
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

  return (
    <div className="app">
      <TopBar title={addonFor ? 'Add to order' : 'New Order'} />
      <div className="till">
        <section className="ticket-panel">
          {parent ? (
            <div className="addon-banner" style={{ marginTop: 12 }}>
              <span>
                Adding to order <b>#{parent.number}</b> ({orderTypes.find((t) => t.id === parent.orderTypeId)?.name})
              </span>
              <button className="btn" onClick={() => go('/till')}>
                Cancel
              </button>
            </div>
          ) : (
            <div className="type-toggle">
              {enabledTypes.map((t) => (
                <button key={t.id} className={`${t.id} ${typeId === t.id ? 'on' : ''}`} onClick={() => setTypeId(t.id)}>
                  {t.name}
                  <small>{t.packaging}</small>
                </button>
              ))}
            </div>
          )}
          <div className="lines">
            {lines.length === 0 && <div className="empty">Tap a meal to add it</div>}
            {lines.map((l) => (
              <div key={l.id} className="line-row">
                <div className="qty">
                  <button onClick={() => changeQty(l.id, -1)} aria-label="Less">
                    −
                  </button>
                  <span>{l.qty}</span>
                  <button onClick={() => changeQty(l.id, 1)} aria-label="More">
                    +
                  </button>
                </div>
                <div>
                  <div className="nm">{l.name}</div>
                  {l.note && <div className="nt">» {l.note}</div>}
                  <div className="nm">
                    <button onClick={() => setNoteFor(l)}>{l.note ? 'Edit note' : '+ Note'}</button>
                  </div>
                </div>
                <div className="pr">{fmt(l.qty * l.unitPrice, base)}</div>
              </div>
            ))}
          </div>
          <div className="totals">
            <div className="big">
              <span>Total</span>
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
              <button className="btn big danger" onClick={clear} disabled={!lines.length}>
                Clear
              </button>
              <button className="btn big primary" onClick={() => setPaying(true)} disabled={!lines.length}>
                Pay {fmt(total, base)}
              </button>
            </div>
          </div>
        </section>

        <section className="menu-panel">
          <div className="cat-bar">
            <button
              className={cat === FAV && !search ? 'on' : ''}
              style={cat === FAV && !search ? { background: 'var(--ink)', borderColor: 'var(--ink)' } : undefined}
              onClick={() => {
                setCat(FAV);
                setSearch('');
              }}
            >
              ★ Favourites
            </button>
            {categories
              .slice()
              .sort((a, b) => a.sort - b.sort)
              .map((c) => (
                <button
                  key={c.id}
                  className={cat === c.id && !search ? 'on' : ''}
                  style={cat === c.id && !search ? { background: c.color, borderColor: c.color } : undefined}
                  onClick={() => {
                    setCat(c.id);
                    setSearch('');
                  }}
                >
                  {c.name}
                </button>
              ))}
            <input placeholder="Search…" value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>
          <div className="items">
            {shown.map((m) => (
              <button key={m.id} className="item" onClick={() => add(m)} style={{ '--cat': catColor(m.categoryId) } as CSSProperties}>
                <div className="ph">{m.photo ? <img src={m.photo} alt="" /> : <span>{m.emoji}</span>}</div>
                <div className="meta">
                  <div className="nm">{m.name}</div>
                  <div className="pr">{fmt(m.price, base)}</div>
                </div>
              </button>
            ))}
            {shown.length === 0 && <div className="empty" style={{ gridColumn: '1/-1' }}>Nothing available here.</div>}
          </div>
          {hiddenCount > 0 && <div className="hidden-note">{hiddenCount} item(s) hidden because they are sold out.</div>}
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
