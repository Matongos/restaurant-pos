import { useState } from 'react';
import { removeExampleHistory, resetDemo, updateSettings, upsertCurrency, upsertMenuItem, useStore } from '../store/store';
import type { Currency, MenuItem, NumberMode } from '../domain/types';
import { compressLogo, compressPhoto } from '../components/photo';
import { Dialog, TopBar, toast } from '../components/ui';
import { fmt } from '../domain/money';
import { uid } from '../domain/rules';

type Tab = 'general' | 'numbers' | 'currencies' | 'menu' | 'kitchen' | 'demo';

export default function SettingsScreen() {
  const [tab, setTab] = useState<Tab>('general');
  const tabs: [Tab, string][] = [
    ['general', 'Restaurant & branding'],
    ['numbers', 'Order numbers & printing'],
    ['currencies', 'Currencies'],
    ['menu', 'Menu & photos'],
    ['kitchen', 'Serving times'],
    ['demo', 'Demo data'],
  ];
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
          {s.logo ? <img src={s.logo} alt="" style={{ objectFit: 'contain' }} /> : <span>🏷️</span>}
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
            style={s.numberMode === m ? { borderColor: 'var(--brand)', background: '#f0fdf4' } : undefined}
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
      <div className="section-title">Printing</div>
      <label className="row">
        <input type="checkbox" checked={s.autoPrintKitchen} onChange={(e) => updateSettings({ autoPrintKitchen: e.target.checked })} />
        Print automatically when an order is confirmed
      </label>
      <p className="muted" style={{ fontSize: 13 }}>
        In this prototype printing opens the browser's print dialog. The desktop app prints straight to the 80 mm kitchen printer with no
        dialog.
      </p>
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
                    {m.photo ? <img src={m.photo} alt="" /> : m.emoji}
                  </div>
                </div>
              </td>
              <td>
                <b>{m.name}</b>
                <div className="muted" style={{ fontSize: 13 }}>
                  {categories.find((c) => c.id === m.categoryId)?.name}
                  {m.favourite ? ' · ★ favourite' : ''}
                </div>
              </td>
              <td>{fmt(m.price, base)}</td>
              <td style={{ textAlign: 'right' }}>
                <span className="btn">📷 {m.photo ? 'Change photo' : 'Add photo'}</span>
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
  const components = useStore((s) => s.components);
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
          {m.photo ? <img src={m.photo} alt="" /> : m.emoji}
        </div>
        <div>
          <label className="btn primary">
            📷 Take / upload photo
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
          Category
          <select value={m.categoryId} onChange={(e) => setM({ ...m, categoryId: e.target.value })}>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          Picture when no photo (emoji)
          <input value={m.emoji} onChange={(e) => setM({ ...m, emoji: e.target.value })} />
        </label>
      </div>
      <label className="row" style={{ marginTop: 12 }}>
        <input type="checkbox" checked={m.favourite} onChange={(e) => setM({ ...m, favourite: e.target.checked })} />
        Show in Favourites (first screen at the till)
      </label>
      <div className="section-title">Made with (hidden if any of these is sold out)</div>
      <div className="seg">
        {components.map((c) => {
          const on = m.componentIds.includes(c.id);
          return (
            <button
              key={c.id}
              className={on ? 'on' : ''}
              onClick={() =>
                setM({ ...m, componentIds: on ? m.componentIds.filter((x) => x !== c.id) : [...m.componentIds, c.id] })
              }
            >
              {c.name}
            </button>
          );
        })}
      </div>
    </Dialog>
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
      </div>
    </>
  );
}

function Demo() {
  const [sure, setSure] = useState(false);
  return (
    <>
      <p>This prototype keeps its data in this browser. Reset puts back the demo menu and removes all orders.</p>
      <p className="muted">
        The last 30 days of orders are generated examples (marked as training) so the graphs in Reports have something to show.
      </p>
      <button
        className="btn"
        style={{ marginBottom: 12 }}
        onClick={() => {
          removeExampleHistory();
          toast('Example history removed');
        }}
      >
        Remove example history
      </button>
      <br />
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
      <TopBar title="Menu & Photos" />
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
