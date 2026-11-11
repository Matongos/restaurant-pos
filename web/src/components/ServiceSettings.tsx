import { useState } from 'react';
import { LuPlus, LuTrash2 } from 'react-icons/lu';
import { saveTables, updateSettings, useStore } from '../store/store';
import { uid } from '../domain/rules';
import { openTabs } from '../domain/tables';
import type { DiningTable, ServiceMode } from '../domain/types';
import { toast } from './ui';

const MODES: [ServiceMode, string, string][] = [
  ['counter', 'Counter only', 'Pay first at the till and take a numbered card. The kitchen gets the order once it is paid. (How the system works without tables.)'],
  ['tables', 'Tables only', 'Guests sit, order, and pay at the end. Orders go to the kitchen in rounds; the bill is printed and can be split.'],
  ['both', 'Both', 'Tables for eating in; the counter for Take Away and Delivery. The till shows Table / Take Away / Delivery.'],
];

/** Settings → How you serve (owner): counter, tables or both; the tables; and the table rules. */
export default function ServiceSettings() {
  const settings = useStore((s) => s.settings);
  const orders = useStore((s) => s.orders);
  const mode = settings.serviceMode ?? 'counter';
  const open = openTabs(orders);
  const [tables, setTables] = useState<DiningTable[]>(settings.tables ?? []);
  const [sc, setSc] = useState(String(settings.serviceChargePct ?? 0));
  const dirty = JSON.stringify(tables) !== JSON.stringify(settings.tables ?? []);

  const pick = (m: ServiceMode) => {
    if (m === mode) return;
    if (m === 'counter' && open.length) return toast(`${open.length} table${open.length === 1 ? ' has' : 's have'} an open bill (${open.map((o) => o.table!.name).join(', ')}). Close them first.`);
    updateSettings({ serviceMode: m });
    toast(m === 'counter' ? 'Table service is off' : m === 'tables' ? 'Tables only: orders are taken at tables' : 'Tables and counter are both on');
  };
  const nextName = (list: DiningTable[]) => {
    let n = list.length + 1;
    while (list.some((t) => t.name.toLowerCase() === `t${n}`)) n++;
    return `T${n}`;
  };
  const add = (count: number) =>
    setTables((list) => {
      const next = [...list];
      for (let i = 0; i < count; i++) next.push({ id: uid('tb-'), name: nextName(next), area: list[list.length - 1]?.area ?? 'Inside', seats: 4 });
      return next;
    });
  const patch = (id: string, p: Partial<DiningTable>) => setTables((list) => list.map((t) => (t.id === id ? { ...t, ...p } : t)));
  const save = () => {
    const r = saveTables(tables);
    if (!r.ok) return toast(r.error);
    toast('Tables saved');
  };

  return (
    <>
      <div className="section-title" style={{ marginTop: 0 }}>
        How customers are served
      </div>
      <div className="mode-cards" role="radiogroup" aria-label="How customers are served">
        {MODES.map(([m, title, text]) => (
          <button key={m} role="radio" aria-checked={mode === m} className={`mode-card ${mode === m ? 'on' : ''}`} onClick={() => pick(m)}>
            {mode === m && <span className="use">IN USE</span>}
            <b>{title}</b>
            <small>{text}</small>
          </button>
        ))}
      </div>

      <div className="section-title">
        Tables <span className="muted section-sub">— {tables.length} tables{open.length ? `, ${open.length} with an open bill` : ''}</span>
      </div>
      {mode === 'counter' && <p className="hint" style={{ marginTop: -4 }}>Only used when table service is on. You can set them up now.</p>}
      <div className="table-list">
        {tables.length > 0 && (
          <div className="table-row table-head muted">
            <span>Name</span>
            <span>Area</span>
            <span>Seats</span>
            <span />
          </div>
        )}
        {tables.map((t) => {
          const busy = open.some((o) => o.table!.tableId === t.id);
          return (
            <div key={t.id} className="table-row">
              <input aria-label="Table name" value={t.name} onChange={(e) => patch(t.id, { name: e.target.value })} />
              <input aria-label="Area" value={t.area ?? ''} placeholder="Area, e.g. Inside" onChange={(e) => patch(t.id, { area: e.target.value })} />
              <input aria-label="Seats" type="number" min={1} inputMode="numeric" value={t.seats ?? ''} placeholder="Seats" onChange={(e) => patch(t.id, { seats: e.target.value ? Math.max(1, Number(e.target.value)) : undefined })} />
              <button className="btn icon-only" disabled={busy} title={busy ? 'This table has an open bill' : `Remove ${t.name}`} aria-label={`Remove ${t.name}`} onClick={() => setTables((list) => list.filter((x) => x.id !== t.id))}>
                <LuTrash2 aria-hidden="true" />
              </button>
            </div>
          );
        })}
      </div>
      <div className="row" style={{ marginTop: 10, gap: 8, flexWrap: 'wrap' }}>
        <button className="btn" onClick={() => add(1)}>
          <LuPlus aria-hidden="true" />
          Add table
        </button>
        <button className="btn" onClick={() => add(10)}>
          <LuPlus aria-hidden="true" />
          Add 10 tables at once
        </button>
        <button className={`btn ${dirty ? 'primary' : ''}`} disabled={!dirty} onClick={save} style={{ marginLeft: 'auto' }}>
          Save tables
        </button>
      </div>

      <div className="section-title">Rules</div>
      <div className="cat-list">
        <div className={`cat-edit-row ${settings.askGuests === false ? 'off' : ''}`}>
          <div className="grow">
            <b>Ask how many guests when a table is opened</b>
            <div className="muted cat-sub">Shown on the table and the kitchen ticket.</div>
          </div>
          <button className={`switch ${settings.askGuests === false ? '' : 'on'}`} onClick={() => updateSettings({ askGuests: settings.askGuests === false })} aria-pressed={settings.askGuests !== false} aria-label="Ask how many guests">
            <span />
          </button>
        </div>
        <div className="cat-edit-row">
          <div className="grow">
            <b>Service charge on table bills</b>
            <div className="muted cat-sub">Added to the bill when it is printed. 0 = none.</div>
          </div>
          <div className="row" style={{ gap: 6 }}>
            <input
              className="pct-input"
              type="number"
              min={0}
              max={30}
              step="0.5"
              inputMode="decimal"
              value={sc}
              aria-label="Service charge percent"
              onChange={(e) => setSc(e.target.value)}
              onBlur={() => {
                const v = Math.min(30, Math.max(0, Number(sc) || 0));
                setSc(String(v));
                updateSettings({ serviceChargePct: v });
              }}
            />
            <span className="muted">%</span>
          </div>
        </div>
      </div>
    </>
  );
}
