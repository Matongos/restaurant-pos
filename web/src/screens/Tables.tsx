import { useState } from 'react';
import { go } from '../router';
import { useCurrentUser, useStore } from '../store/store';
import { fmtDuration } from '../domain/rules';
import { fmt } from '../domain/money';
import { openTab, tableState, tabDue, tabTotal, type TableState } from '../domain/tables';
import type { DiningTable } from '../domain/types';
import { Dialog, TopBar, useNow } from '../components/ui';
import { LuClock, LuMinus, LuPackage, LuPlus, LuUserRound, LuUsers } from 'react-icons/lu';

const PILL: Record<TableState, string> = { free: 'FREE', ordering: 'ORDERING', ready: 'FOOD READY', eating: 'EATING', billed: 'BILL PRINTED' };

/** Every table at a glance: free, eating, food ready, or waiting to pay. Tap one to seat guests or add to its order. */
export default function TablesScreen() {
  const now = useNow(15000);
  const user = useCurrentUser()!;
  const tables = useStore((s) => s.settings.tables ?? []);
  const mode = useStore((s) => s.settings.serviceMode ?? 'counter');
  const askGuests = useStore((s) => s.settings.askGuests !== false);
  const orders = useStore((s) => s.orders);
  const staff = useStore((s) => s.staff);
  const base = useStore((s) => s.currencies.find((c) => c.code === s.settings.baseCurrency)!);
  const [area, setArea] = useState<string>('all');
  const [seating, setSeating] = useState<DiningTable | null>(null);

  const rows = tables.map((t) => {
    const tab = openTab(orders, t.id);
    return { t, tab, state: tableState(orders, tab) };
  });
  const areas = [...new Set(tables.map((t) => t.area).filter(Boolean))] as string[];
  const shown = rows.filter((r) => (area === 'all' ? true : area === 'mine' ? r.tab?.table?.waiterId === user.id : r.t.area === area));
  const n = (st: TableState | 'busy') => rows.filter((r) => (st === 'busy' ? r.state !== 'free' && r.state !== 'billed' : r.state === st)).length;
  const openTotal = rows.reduce((s, r) => s + (r.tab ? tabDue(orders, r.tab) : 0), 0);
  const waiter = (id?: string) => staff.find((s) => s.id === id)?.name.replace(/\s*\(.*\)\s*/g, '') ?? '';

  const open = (t: DiningTable, busy: boolean) => {
    if (busy) return go(`/till?table=${t.id}`);
    if (askGuests) setSeating(t);
    else go(`/till?table=${t.id}`);
  };

  return (
    <div className="app">
      <TopBar title="Tables">
        {mode === 'both' && (
          <button className="btn" onClick={() => go('/till')}>
            <LuPackage aria-hidden="true" />
            <span>Take-away order</span>
          </button>
        )}
      </TopBar>
      <div className="page">
        <div className="stats tables-stats">
          <div className="card stat">
            <div className="muted lbl">Free tables</div>
            <div className="val">{n('free')}</div>
          </div>
          <div className="card stat">
            <div className="muted lbl">Busy</div>
            <div className="val">{n('busy')}</div>
          </div>
          <div className="card stat">
            <div className="muted lbl">Waiting to pay</div>
            <div className="val" style={n('billed') ? { color: 'var(--warn)' } : undefined}>
              {n('billed')}
            </div>
          </div>
          <div className="card stat">
            <div className="muted lbl">Open bills</div>
            <div className="val">{fmt(openTotal, base)}</div>
          </div>
        </div>

        <div className="area-chips">
          <button className={area === 'all' ? 'on' : ''} onClick={() => setArea('all')}>
            All ({tables.length})
          </button>
          {areas.map((a) => (
            <button key={a} className={area === a ? 'on' : ''} onClick={() => setArea(a)}>
              {a} ({tables.filter((t) => t.area === a).length})
            </button>
          ))}
          <button className={area === 'mine' ? 'on' : ''} onClick={() => setArea('mine')}>
            Mine
          </button>
        </div>

        {tables.length === 0 && <div className="empty">No tables set up yet. The owner adds them in Settings → How you serve.</div>}
        <div className="table-grid">
          {shown.map(({ t, tab, state }) => {
            const seated = tab ? now - Date.parse(tab.createdAt) : 0;
            return (
              <button key={t.id} className={`tcard ${state} ${seated > 60 * 60000 ? 'long' : ''}`} onClick={() => open(t, !!tab)} aria-label={`${t.name}, ${PILL[state].toLowerCase()}`}>
                <span className="tn">{t.name}</span>
                <span className="pill">{PILL[state]}</span>
                {tab ? (
                  <>
                    {tab.table?.guests && (
                      <span className="ts">
                        <LuUsers aria-hidden="true" />
                        {tab.table.guests} guest{tab.table.guests === 1 ? '' : 's'}
                      </span>
                    )}
                    <span className="ts clock">
                      <LuClock aria-hidden="true" />
                      {fmtDuration(seated)}
                    </span>
                    <span className="ts">
                      <LuUserRound aria-hidden="true" />
                      {waiter(tab.table?.waiterId)}
                    </span>
                    <span className="amt">{fmt(tabTotal(orders, tab), base)}</span>
                  </>
                ) : (
                  <span className="ts">
                    <LuUsers aria-hidden="true" />
                    {t.seats ? `${t.seats} seats` : 'Free'}
                    {t.area && areas.length > 1 ? ` · ${t.area}` : ''}
                  </span>
                )}
              </button>
            );
          })}
        </div>
        <div className="table-legend">
          <span>
            <i className="free" />
            Free — tap to seat guests
          </span>
          <span>
            <i className="busy" />
            Ordering / eating
          </span>
          <span>
            <i className="ready" />
            Food ready to take out
          </span>
          <span>
            <i className="billed" />
            Bill printed, waiting to pay
          </span>
        </div>
      </div>
      {seating && <SeatDialog table={seating} onClose={() => setSeating(null)} />}
    </div>
  );
}

/** "How many guests at T2?" — big buttons, then straight to the order. */
function SeatDialog({ table, onClose }: { table: DiningTable; onClose: () => void }) {
  const [n, setN] = useState(Math.min(table.seats ?? 2, 2) || 2);
  const seat = (g: number) => go(`/till?table=${table.id}&guests=${g}`);
  return (
    <Dialog
      title={`Seat guests at ${table.name}`}
      onClose={onClose}
      width={460}
      footer={
        <>
          <button className="btn" onClick={onClose}>
            Cancel
          </button>
          <button className="btn primary" onClick={() => seat(n)}>
            Seat {n} and take the order
          </button>
        </>
      }
    >
      <p className="muted" style={{ marginTop: 0 }}>
        How many guests?
      </p>
      <div className="split-pick">
        {[1, 2, 3, 4, 5, 6].map((k) => (
          <button key={k} className={n === k ? 'all' : ''} onClick={() => seat(k)}>
            {k}
          </button>
        ))}
      </div>
      <div className="guest-stepper">
        <span>More:</span>
        <button className="btn icon-only" onClick={() => setN((x) => Math.max(1, x - 1))} aria-label="One less">
          <LuMinus aria-hidden="true" />
        </button>
        <b>{n}</b>
        <button className="btn icon-only" onClick={() => setN((x) => Math.min(40, x + 1))} aria-label="One more">
          <LuPlus aria-hidden="true" />
        </button>
      </div>
    </Dialog>
  );
}
