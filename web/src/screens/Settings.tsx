import { useState } from 'react';
import { addComponent, setExampleHistory, resetDemo, updatePaymentMethod, updateSettings, upsertCurrency, upsertMenuItem, useCurrentUser, useStore } from '../store/store';
import type { Currency, MenuItem, NumberMode, PrintWhen } from '../domain/types';
import { compressLogo, compressPhoto } from '../components/photo';
import { Dialog, TopBar, toast } from '../components/ui';
import { fmt } from '../domain/money';
import { can, mealInitials, uid } from '../domain/rules';
import { LuCamera, LuStore } from 'react-icons/lu';
import CategoryEditor from '../components/CategoryEditor';

type Tab = 'general' | 'numbers' | 'payments' | 'currencies' | 'menu' | 'kitchen' | 'demo';

/** Tabs a manager may change: how the till runs day to day. Everything else is the owner's. */
const MANAGER_TABS: Tab[] = ['numbers', 'kitchen'];

export default function SettingsScreen() {
  const user = useCurrentUser()!;
  const owner = can(user.role, 'settings');
  const [tab, setTab] = useState<Tab>(owner ? 'general' : 'numbers');
  const allTabs: [Tab, string][] = [
    ['general', 'Restaurant & branding'],
    ['numbers', 'Numbers & printing'],
    ['payments', 'Payment methods'],
    ['currencies', 'Currencies'],
    ['menu', 'Menu & categories'],
    ['kitchen', 'Serving times'],
    ['demo', 'Demo data'],
  ];
  const tabs = owner ? allTabs : allTabs.filter(([k]) => MANAGER_TABS.includes(k));
  return (
    <div className="app">
      <TopBar title="Settings" />
      <div className="page">
        <div className="page-narrow">
          <div className="tabs">
            {tabs.map(([k, label]) => (
              <button key={k} className={tab === k ? 'on' : ''} onClick={() => setTab(k)}>
                {label}
              </button>
            ))}
          </div>
          <div className="card" style={{ padding: 20 }}>
            {tab === 'general' && <General />}
            {tab === 'numbers' && <Numbers />}
            {tab === 'payments' && <PaymentMethods />}
            {tab === 'currencies' && <Currencies />}
            {tab === 'menu' && <MenuEditor />}
            {tab === 'kitchen' && <KitchenSettings />}
            {tab === 'demo' && <Demo />}
          </div>
        </div>
      </div>
    </div>
  );
}

function General() {
  const s = useStore((st) => st.settings);
  return (
    <>
      <div className="photo-edit">
        <div className="ph" style={{ width: 140 }}>
          {s.logo ? <img src={s.logo} alt="" style={{ objectFit: 'contain' }} /> : <LuStore aria-hidden="true" />}
        </div>
        <div>
          <label className="btn">
            Upload logo
            <input
              type="file"
              accept="image/*"
              hidden
              onChange={async (e) => {
                const f = e.target.files?.[0];
                if (f) updateSettings({ logo: await compressLogo(f) });
              }}
            />
          </label>{' '}
          {s.logo && (
            <button className="btn danger" onClick={() => updateSettings({ logo: undefined })}>
              Remove
            </button>
          )}
          <div className="muted" style={{ fontSize: 13, marginTop: 6 }}>
            Shown on the login screen, top bar, customer display and receipts.
          </div>
        </div>
      </div>
      <div className="form-grid">
        <label className="field">
          Restaurant name
          <input value={s.restaurantName} onChange={(e) => updateSettings({ restaurantName: e.target.value })} />
        </label>
        <label className="field">
          Tagline
          <input value={s.tagline} onChange={(e) => updateSettings({ tagline: e.target.value })} />
        </label>
        <label className="field">
          Brand colour
          <input type="color" value={s.brandColor} onChange={(e) => updateSettings({ brandColor: e.target.value })} style={{ height: 46 }} />
        </label>
        <label className="field">
          Address
          <input value={s.address} onChange={(e) => updateSettings({ address: e.target.value })} />
        </label>
        <label className="field">
          Phone
          <input value={s.phone} onChange={(e) => updateSettings({ phone: e.target.value })} />
        </label>
        <label className="field">
          Receipt footer
          <input value={s.receiptFooter} onChange={(e) => updateSettings({ receiptFooter: e.target.value })} />
        </label>
      </div>
    </>
  );
}

const PRINT_WHEN: [PrintWhen, string, string][] = [
  ['on_pay', 'Print straight away', 'Tickets print the moment the payment is confirmed. The kitchen never misses an order. Recommended when busy.'],
  ['on_next', 'Print & next customer', 'One button after each sale prints the tickets and goes back to Sell.'],
  ['button', 'Only when Print is pressed', 'Nothing prints unless someone presses Print. For when the kitchen works from the kitchen screen.'],
];

function Printing() {
  const s = useStore((st) => st.settings);
  const when = s.printWhen ?? 'on_pay';
  const kitchen = s.printKitchenTicket !== false;
  const changeSlip = s.printChangeSlip !== false;
  const auto = s.autoNextSeconds ?? 0;
  const slip = s.numberMode !== 'card';
  return (
    <>
      <div className="section-title">After a payment</div>
      <div className="toggle-list" role="radiogroup" aria-label="When tickets print">
        {PRINT_WHEN.map(([k, title, desc]) => (
          <button key={k} role="radio" aria-checked={when === k} className={`toggle ${when === k ? 'chosen' : ''}`} onClick={() => updateSettings({ printWhen: k })}>
            <span>
              {title}
              <span className="sub">{desc}</span>
            </span>
            {when === k && <span className="st">IN USE</span>}
          </button>
        ))}
      </div>

      <div className="section-title">What prints</div>
      <div className="switch-rows">
        <div className="switch-row">
          <div className="grow">
            <b>Kitchen ticket</b>
            <div className="muted">Off = the kitchen works from the kitchen screen only.</div>
          </div>
          <button className={`switch ${kitchen ? 'on' : ''}`} onClick={() => updateSettings({ printKitchenTicket: !kitchen })} aria-label="Print kitchen ticket" aria-pressed={kitchen}>
            <span />
          </button>
        </div>
        <div className="switch-row">
          <div className="grow">
            <b>Change slip</b>
            <div className="muted">When a customer leaves change: their name, amount and code to bring back.</div>
          </div>
          <button className={`switch ${changeSlip ? 'on' : ''}`} onClick={() => updateSettings({ printChangeSlip: !changeSlip })} aria-label="Print change slip" aria-pressed={changeSlip}>
            <span />
          </button>
        </div>
        <div className="switch-row">
          <div className="grow">
            <b>Customer number slip</b>
            <div className="muted">{slip ? 'Prints because customers get a printed number (set above).' : 'Not printed: customers get a physical card (set above).'}</div>
          </div>
        </div>
      </div>

      <div className="section-title">Go back to Sell by itself</div>
      <div className="seg" role="radiogroup" aria-label="Go back to Sell by itself">
        {[0, 3, 5, 10].map((n) => (
          <button key={n} role="radio" aria-checked={auto === n} className={auto === n ? 'on' : ''} onClick={() => updateSettings({ autoNextSeconds: n })}>
            {n === 0 ? 'Off — wait for the cashier' : `After ${n} seconds`}
          </button>
        ))}
      </div>
      <p className="muted" style={{ fontSize: 13 }}>
        The order number stays on screen for that long, then the till is ready for the next customer. Touching the screen stops the countdown.
      </p>
    </>
  );
}

function Numbers() {
  const s = useStore((st) => st.settings);
  const modes: [NumberMode, string, string][] = [
    ['card', 'Physical cards', 'Cashier hands over a numbered card. The system tracks which cards are out.'],
    ['slip', 'Printed slip', 'A slip with a big number prints for the customer. Numbers restart daily.'],
    ['both', 'Both', 'Card handed over and a slip printed with the same number.'],
  ];
  return (
    <>
      <div className="section-title" style={{ marginTop: 0 }}>
        How customers get their number
      </div>
      <div className="toggle-list">
        {modes.map(([m, title, desc]) => (
          <button
            key={m}
            className="toggle"
            style={s.numberMode === m ? { borderColor: 'var(--brand)', background: 'var(--brand-soft)' } : undefined}
            onClick={() => updateSettings({ numberMode: m })}
          >
            <span>
              {title}
              <span className="sub">{desc}</span>
            </span>
            {s.numberMode === m && <span className="st">IN USE</span>}
          </button>
        ))}
      </div>
      <div className="form-grid" style={{ marginTop: 8 }}>
        <label className="field">
          First card number
          <input type="number" value={s.cardFrom} onChange={(e) => updateSettings({ cardFrom: Math.max(1, Number(e.target.value)) })} />
        </label>
        <label className="field">
          Last card number
          <input type="number" value={s.cardTo} onChange={(e) => updateSettings({ cardTo: Math.max(s.cardFrom, Number(e.target.value)) })} />
        </label>
      </div>
      <Printing />
      <p className="muted" style={{ fontSize: 13 }}>
        In this prototype printing opens the browser's print dialog. The desktop app prints straight to the 80 mm kitchen printer with no
        dialog.
      </p>
    </>
  );
}

function PaymentMethods() {
  const methods = useStore((s) => s.paymentMethods);
  const onCount = methods.filter((m) => m.enabled).length;
  return (
    <>
      <p className="muted" style={{ marginTop: 0 }}>
        Switch off what this restaurant does not accept. It disappears from the payment screen and comes back exactly as it was when switched on
        again. Paying with a customer's kept change is always available.
      </p>
      <div className="toggle-list">
        {methods.map((m) => (
          <div key={m.id} className={`toggle ${m.enabled ? '' : 'off'}`}>
            <span>
              {m.name}
              <span className="sub">{m.isCash ? 'Cash — change can be given' : m.requiresReference ? 'Asks for a reference number' : 'Exact amount'}</span>
            </span>
            <button
              className={`switch ${m.enabled ? 'on' : ''}`}
              role="switch"
              aria-checked={m.enabled}
              aria-label={`Accept ${m.name}`}
              disabled={m.enabled && onCount === 1}
              onClick={() => updatePaymentMethod(m.id, { enabled: !m.enabled })}
            >
              <span />
            </button>
          </div>
        ))}
      </div>
      {!methods.some((m) => m.isCash && m.enabled) && (
        <p style={{ color: 'var(--warn)', fontWeight: 700 }}>Cash is switched off, so the till cannot give change.</p>
      )}
    </>
  );
}

function Currencies() {
  const currencies = useStore((s) => s.currencies);
  const baseCode = useStore((s) => s.settings.baseCurrency);
  const [adding, setAdding] = useState(false);
  return (
    <>
      <p className="muted" style={{ marginTop: 0 }}>
        Prices are set in the base currency ({baseCode}). Rates say how many units equal 1 {baseCode}. Example rates only — set today's
        real rate.
      </p>
      <table className="list">
        <thead>
          <tr>
            <th>Currency</th>
            <th>Symbol</th>
            <th>Rate per 1 {baseCode}</th>
            <th>Quick cash buttons</th>
            <th>Accept</th>
          </tr>
        </thead>
        <tbody>
          {currencies.map((c) => (
            <tr key={c.code}>
              <td>
                <b>{c.code}</b> <span className="muted">{c.name}</span>
              </td>
              <td>
                <input value={c.symbol} style={{ width: 60 }} onChange={(e) => upsertCurrency({ ...c, symbol: e.target.value })} />
              </td>
              <td>
                <input
                  type="number"
                  step="0.01"
                  disabled={c.code === baseCode}
                  value={c.rate}
                  style={{ width: 100 }}
                  onChange={(e) => upsertCurrency({ ...c, rate: Math.max(0.0001, Number(e.target.value)) })}
                />
              </td>
              <td>
                <input
                  value={c.quickCash.join(', ')}
                  style={{ width: 160 }}
                  onChange={(e) =>
                    upsertCurrency({
                      ...c,
                      quickCash: e.target.value
                        .split(',')
                        .map((x) => Number(x.trim()))
                        .filter((x) => x > 0),
                    })
                  }
                />
              </td>
              <td>
                <input
                  type="checkbox"
                  checked={c.enabled}
                  disabled={c.code === baseCode}
                  onChange={(e) => upsertCurrency({ ...c, enabled: e.target.checked })}
                />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <button className="btn" style={{ marginTop: 12 }} onClick={() => setAdding(true)}>
        + Add currency
      </button>
      {adding && <AddCurrency onClose={() => setAdding(false)} />}
    </>
  );
}

function AddCurrency({ onClose }: { onClose: () => void }) {
  const [c, setC] = useState<Currency>({ code: '', name: '', symbol: '', rate: 1, enabled: true, quickCash: [] });
  const ok = c.code.trim().length >= 2 && c.rate > 0;
  return (
    <Dialog
      title="Add currency"
      onClose={onClose}
      width={480}
      footer={
        <button
          className="btn primary"
          disabled={!ok}
          onClick={() => {
            upsertCurrency({ ...c, code: c.code.trim(), symbol: c.symbol || c.code.trim() });
            onClose();
          }}
        >
          Add
        </button>
      }
    >
      <label className="field">
        Code (e.g. BWP)
        <input value={c.code} onChange={(e) => setC({ ...c, code: e.target.value.toUpperCase() })} />
      </label>
      <label className="field">
        Name
        <input value={c.name} onChange={(e) => setC({ ...c, name: e.target.value })} />
      </label>
      <label className="field">
        Symbol
        <input value={c.symbol} onChange={(e) => setC({ ...c, symbol: e.target.value })} />
      </label>
      <label className="field">
        Rate per 1 base unit
        <input type="number" value={c.rate} onChange={(e) => setC({ ...c, rate: Number(e.target.value) })} />
      </label>
    </Dialog>
  );
}

export function MenuEditor() {
  const menu = useStore((s) => s.menu);
  const categories = useStore((s) => s.categories);
  const currencies = useStore((s) => s.currencies);
  const baseCode = useStore((s) => s.settings.baseCurrency);
  const base = currencies.find((c) => c.code === baseCode)!;
  const [editing, setEditing] = useState<MenuItem | null>(null);

  const blank = (): MenuItem => ({
    id: uid('m-'),
    name: '',
    categoryId: categories[0]?.id ?? '',
    price: 0,
    emoji: '🍽️',
    componentIds: [],
    available: true,
    isDrink: false,
    favourite: false,
    sort: 0,
  });

  return (
    <>
      <h3 className="sub-head" style={{ marginTop: 0 }}>Categories</h3>
      <CategoryEditor />
      <h3 className="sub-head">Meals and drinks</h3>
      <div className="row" style={{ marginBottom: 12 }}>
        <p className="muted grow" style={{ margin: 0 }}>
          Tap an item to change its photo, price or ingredients.
        </p>
        <button className="btn primary" onClick={() => setEditing(blank())}>
          + New item
        </button>
      </div>
      <table className="list">
        <tbody>
          {menu.map((m) => (
            <tr key={m.id} onClick={() => setEditing(m)} style={{ cursor: 'pointer' }}>
              <td style={{ width: 64 }}>
                <div className="photo-edit">
                  <div className="ph" style={{ width: 48, height: 48, fontSize: 24 }}>
                    {m.photo ? <img src={m.photo} alt="" /> : mealInitials(m.name || '?')}
                  </div>
                </div>
              </td>
              <td>
                <b>{m.name}</b>
                <div className="muted" style={{ fontSize: 13 }}>
                  {categories.find((c) => c.id === m.categoryId)?.name}
                  {m.favourite ? ' · favourite' : ''}
                </div>
              </td>
              <td>{fmt(m.price, base)}</td>
              <td style={{ textAlign: 'right' }}>
                <span className="btn">
                  <LuCamera aria-hidden="true" />
                  {m.photo ? 'Change photo' : 'Add photo'}
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {editing && <ItemDialog item={editing} onClose={() => setEditing(null)} />}
    </>
  );
}

function ItemDialog({ item, onClose }: { item: MenuItem; onClose: () => void }) {
  const categories = useStore((s) => s.categories);
  const [m, setM] = useState<MenuItem>(item);
  const valid = m.name.trim() && m.price >= 0;
  return (
    <Dialog
      title={item.name ? `Edit ${item.name}` : 'New item'}
      onClose={onClose}
      width={620}
      footer={
        <>
          <button className="btn" onClick={onClose}>
            Cancel
          </button>
          <button
            className="btn primary"
            disabled={!valid}
            onClick={() => {
              upsertMenuItem({ ...m, name: m.name.trim() });
              toast('Saved');
              onClose();
            }}
          >
            Save
          </button>
        </>
      }
    >
      <div className="photo-edit">
        <div className="ph" style={{ width: 110, height: 110, fontSize: 52 }}>
          {m.photo ? <img src={m.photo} alt="" /> : mealInitials(m.name || '?')}
        </div>
        <div>
          <label className="btn primary">
            <LuCamera aria-hidden="true" />
            Take or upload photo
            <input
              type="file"
              accept="image/*"
              capture="environment"
              hidden
              onChange={async (e) => {
                const f = e.target.files?.[0];
                if (f) setM({ ...m, photo: await compressPhoto(f) });
              }}
            />
          </label>
          {m.photo && (
            <button className="btn danger" style={{ marginLeft: 8 }} onClick={() => setM({ ...m, photo: undefined })}>
              Remove
            </button>
          )}
          <div className="muted" style={{ fontSize: 13, marginTop: 6 }}>
            Cropped square and shrunk automatically.
          </div>
        </div>
      </div>
      <div className="form-grid">
        <label className="field">
          Name
          <input value={m.name} onChange={(e) => setM({ ...m, name: e.target.value })} />
        </label>
        <label className="field">
          Price (base currency)
          <input type="number" step="0.05" value={m.price} onChange={(e) => setM({ ...m, price: Number(e.target.value) })} />
        </label>
        <label className="field">
          Cost to make one plate (optional)
          <input
            type="number"
            step="0.05"
            min={0}
            placeholder="e.g. 1.60"
            value={m.costPerPlate ?? ''}
            onChange={(e) => setM({ ...m, costPerPlate: e.target.value === '' ? undefined : Math.max(0, Number(e.target.value)) })}
          />
        </label>
        <label className="field">
          Category
          <select value={m.categoryId} onChange={(e) => setM({ ...m, categoryId: e.target.value })}>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </label>
      </div>
      <label className="row" style={{ marginTop: 12 }}>
        <input type="checkbox" checked={m.favourite} onChange={(e) => setM({ ...m, favourite: e.target.checked })} />
        Show in Favourites (first screen at the till)
      </label>
      <MadeWith m={m} setM={setM} />
    </Dialog>
  );
}

/**
 * What the meal is made of, in two groups:
 * - Main parts: if one is sold out the meal disappears from the till (no beef = no Rice & Beef).
 * - Comes with: the customer may say no (coslo, covo). If it runs out the meal stays on sale
 *   and orders are marked "no coslo".
 * Tap a part to move it: not used → main part → comes with → not used.
 */
function MadeWith({ m, setM }: { m: MenuItem; setM: (m: MenuItem) => void }) {
  const components = useStore((s) => s.components);
  const [newName, setNewName] = useState('');
  const optional = new Set(m.optionalIds ?? []);
  const state = (id: string) => (!m.componentIds.includes(id) ? 'none' : optional.has(id) ? 'optional' : 'main');
  const cycle = (id: string) => {
    const now = state(id);
    const ids = m.componentIds.filter((x) => x !== id);
    const opt = (m.optionalIds ?? []).filter((x) => x !== id);
    if (now === 'none') setM({ ...m, componentIds: [...ids, id], optionalIds: opt.length ? opt : undefined });
    else if (now === 'main') setM({ ...m, componentIds: [...ids, id], optionalIds: [...opt, id] });
    else setM({ ...m, componentIds: ids, optionalIds: opt.length ? opt : undefined });
  };
  const addNew = () => {
    const id = addComponent(newName);
    if (!id) return;
    setNewName('');
    if (!m.componentIds.includes(id)) setM({ ...m, componentIds: [...m.componentIds, id], optionalIds: [...(m.optionalIds ?? []), id] });
  };
  const mains = components.filter((c) => state(c.id) === 'main');
  const extras = components.filter((c) => state(c.id) === 'optional');
  return (
    <>
      <div className="section-title">What it is made of</div>
      <p className="hint" style={{ marginTop: -4 }}>
        Tap to switch between <b>not used</b>, <b>main part</b> and <b>comes with</b>.
      </p>
      <div className="seg made-with">
        {components.map((c) => {
          const st = state(c.id);
          return (
            <button key={c.id} className={`mw-${st}`} onClick={() => cycle(c.id)} aria-label={`${c.name}: ${st === 'none' ? 'not used' : st === 'main' ? 'main part' : 'comes with, customer can say no'}`}>
              {c.name}
              {st !== 'none' && <small>{st === 'main' ? 'main' : 'comes with'}</small>}
            </button>
          );
        })}
      </div>
      <div className="mw-summary">
        <div>
          <b>Main parts</b> — if one runs out, the meal is hidden:{' '}
          {mains.length ? mains.map((c) => c.name).join(', ') : <span className="muted">none</span>}
        </div>
        <div>
          <b>Comes with</b> — the cashier can tap “No …”; if it runs out the meal stays on sale:{' '}
          {extras.length ? extras.map((c) => c.name).join(', ') : <span className="muted">none</span>}
        </div>
      </div>
      <div className="row" style={{ marginTop: 10 }}>
        <input
          id="new-part"
          className="plain-input grow"
          style={{ marginTop: 0 }}
          placeholder="New ingredient or side, e.g. Coslo"
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && addNew()}
        />
        <button className="btn" onClick={addNew} disabled={!newName.trim()}>
          Add
        </button>
      </div>
    </>
  );
}

function KitchenSettings() {
  const s = useStore((st) => st.settings);
  return (
    <>
      <p className="muted" style={{ marginTop: 0 }}>
        The clock on each order starts when the cashier confirms it and runs until the food is served. These times also decide which
        orders count as late in Reports.
      </p>
      <div className="form-grid">
        <label className="field">
          Order is late after (minutes)
          <input
            id="late-after"
            type="number"
            min={1}
            value={s.lateAfterMinutes}
            onChange={(e) => {
              const late = Math.max(1, Number(e.target.value));
              updateSettings({ lateAfterMinutes: late, warnAfterMinutes: Math.min(s.warnAfterMinutes, late) });
            }}
          />
        </label>
        <label className="field">
          Warn (amber) after (minutes)
          <input
            id="warn-after"
            type="number"
            min={0}
            value={s.warnAfterMinutes}
            onChange={(e) => updateSettings({ warnAfterMinutes: Math.min(s.lateAfterMinutes, Math.max(0, Number(e.target.value))) })}
          />
        </label>
        <label className="field">
          One server handles (customers an hour)
          <input
            id="staff-capacity"
            type="number"
            min={1}
            value={s.customersPerStaffHour}
            onChange={(e) => updateSettings({ customersPerStaffHour: Math.max(1, Number(e.target.value)) })}
          />
        </label>
      </div>
      <div className="section-title">Parts of the day (used in Analytics)</div>
      <table className="list">
        <tbody>
          {s.mealPeriods.map((p, i) => (
            <tr key={p.id}>
              <td>
                <input
                  id={`period-name-${p.id}`}
                  value={p.name}
                  onChange={(e) => updateSettings({ mealPeriods: s.mealPeriods.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)) })}
                />
              </td>
              <td>
                from{' '}
                <input
                  id={`period-from-${p.id}`}
                  type="number"
                  min={0}
                  max={23}
                  style={{ width: 70 }}
                  value={p.from}
                  onChange={(e) => updateSettings({ mealPeriods: s.mealPeriods.map((x, j) => (j === i ? { ...x, from: Math.min(x.to - 1, Math.max(0, Number(e.target.value))) } : x)) })}
                />
                :00 to{' '}
                <input
                  id={`period-to-${p.id}`}
                  type="number"
                  min={1}
                  max={24}
                  style={{ width: 70 }}
                  value={p.to}
                  onChange={(e) => updateSettings({ mealPeriods: s.mealPeriods.map((x, j) => (j === i ? { ...x, to: Math.max(x.from + 1, Math.min(24, Number(e.target.value))) } : x)) })}
                />
                :00
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}

function ExampleToggle() {
  const on = useStore((s) => s.settings.showExampleHistory);
  return (
    <div className="toggle" style={{ marginBottom: 14 }}>
      <span>
        Example history (last 120 days)
        <span className="sub">Generated orders so Analytics has something to show. Marked as training; never saved.</span>
      </span>
      <button className={`switch ${on ? 'on' : ''}`} role="switch" aria-checked={on} aria-label="Show example history" onClick={() => setExampleHistory(!on)}>
        <span />
      </button>
    </div>
  );
}

function Demo() {
  const [sure, setSure] = useState(false);
  return (
    <>
      <p>This prototype keeps its data in this browser. Reset puts back the demo menu and removes all orders.</p>
      <ExampleToggle />
      {!sure ? (
        <button className="btn danger" onClick={() => setSure(true)}>
          Reset demo data
        </button>
      ) : (
        <div className="row wrap">
          <b>Remove all orders and settings?</b>
          <button className="btn" onClick={() => setSure(false)}>
            Keep them
          </button>
          <button
            className="btn primary"
            onClick={() => {
              resetDemo();
              setSure(false);
              toast('Demo data restored');
            }}
          >
            Yes, reset
          </button>
        </div>
      )}
    </>
  );
}

/** Stand-alone screen so managers can change meal photos and prices without full settings access. */
export function MenuScreen() {
  return (
    <div className="app">
      <TopBar title="Menu" />
      <div className="page">
        <div className="page-narrow">
          <div className="card" style={{ padding: 20 }}>
            <MenuEditor />
          </div>
        </div>
      </div>
    </div>
  );
}
