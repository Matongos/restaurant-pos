import { useMemo, useState } from 'react';
import { LuDownload } from 'react-icons/lu';
import { useStore } from '../store/store';
import { kitchenDays, readyItems, yieldOf, yieldText } from '../domain/kitchen';
import { countUnit } from '../domain/stock';
import { todayISO } from '../domain/rules';
import BarChart from './BarChart';
import { downloadCsv } from './exportCsv';

const num = (n: number) => n.toLocaleString('en-US', { maximumFractionDigits: 1 });

/**
 * Reports → Kitchen: ready portions made, sold, wasted and missing per day, the yields the system has
 * learnt from Today's cooking, and this week against last week.
 */
export default function KitchenReport({ start, end }: { start: Date; end: Date }) {
  const st = useStore((s) => s);
  const ready = readyItems(st);
  const [pick, setPick] = useState(ready.find((i) => i.countMade !== false)?.id ?? ready[0]?.id ?? '');
  const fromDay = todayISO(start);
  const toDay = todayISO(new Date(Math.min(Date.now(), end.getTime() - 1)));
  const rows = useMemo(() => kitchenDays(st, fromDay, toDay), [st, fromDay, toDay]);
  const days = useMemo(() => {
    const out: string[] = [];
    for (let d = new Date(start); todayISO(d) <= toDay; d.setDate(d.getDate() + 1)) out.push(todayISO(d));
    return out;
  }, [start, toDay]);

  if (!ready.length)
    return (
      <div className="card empty" style={{ padding: 24 }}>
        Nothing to show yet. Set up ready portions under <b>Today's cooking → Ready portions</b> (e.g. Chicken portion made from Chicken), enter what the kitchen
        prepares each day, and this page shows portions made, sold, wasted and missing.
      </div>
    );

  const anyCut = rows.some((r) => r.cut > 0);
  const total = (id: string, key: 'made' | 'sold' | 'waste' | 'missing' | 'rawUsed' | 'cut') => rows.filter((r) => r.item.id === id).reduce((t, r) => t + r[key], 0);
  const now = Date.now();
  const weekAgo = now - 7 * 864e5;
  const item = ready.find((i) => i.id === pick) ?? ready[0];
  const chartLabels = days.map((d) => (days.length > 10 ? `${Number(d.slice(8))}/${Number(d.slice(5, 7))}` : new Date(d + 'T12:00').toLocaleDateString(undefined, { weekday: 'short' })));
  const byDay = (key: 'made' | 'sold') => days.map((d) => rows.find((r) => r.day === d && r.item.id === item.id)?.[key] ?? 0);

  const download = () => {
    const out: (string | number)[][] = [['Date', 'Ready portion', 'Raw used', 'Raw unit', 'Made', 'Sold', 'Cut up', 'Waste', 'Missing']];
    for (const r of rows) {
      const raw = st.stockItems.find((x) => x.id === r.item.madeFrom);
      out.push([r.day, r.item.name, r.rawUsed, raw ? countUnit(raw) : '', r.item.countMade === false ? '' : r.made, r.sold, r.cut, r.waste, r.missing]);
    }
    downloadCsv(`kitchen_${fromDay === toDay ? fromDay : `${fromDay}_to_${toDay}`}.csv`, out);
  };

  return (
    <>
      <div className="row wrap" style={{ justifyContent: 'flex-end', marginBottom: 8 }}>
        <button className="btn" style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }} onClick={download} disabled={!rows.length}>
          <LuDownload aria-hidden="true" /> Download kitchen report (Excel)
        </button>
      </div>
      <div className="stats">
        {ready
          .filter((i) => i.countMade !== false)
          .slice(0, 4)
          .map((i) => {
            const raw = st.stockItems.find((x) => x.id === i.madeFrom);
            const thisW = yieldOf(st, i, { days: 7, now });
            const lastW = yieldOf(st, i, { days: 7, now: weekAgo });
            const d = thisW.perRaw !== null && lastW.perRaw !== null ? Math.round((thisW.perRaw - lastW.perRaw) * 10) / 10 : null;
            return (
              <div key={i.id} className="card stat">
                <div className="muted lbl">{i.name} sold</div>
                <div className="val">{num(total(i.id, 'sold'))}</div>
                <div className="muted sub">
                  {thisW.perRaw === null ? 'yield: shown after the first cooking entry' : yieldText(i, raw, thisW.perRaw)}
                  {d !== null && d !== 0 && <span className={d < 0 ? 'warn-t' : 'good-t'}> · {d > 0 ? '▲' : '▼'} {Math.abs(d)} vs last week</span>}
                </div>
              </div>
            );
          })}
      </div>

      <div className="section-title">Summary for the period</div>
      <div style={{ overflowX: 'auto' }}>
        <table className="list">
          <thead>
            <tr>
              <th>Ready portion</th>
              <th className="num">Raw used</th>
              <th className="num">Made</th>
              <th className="num">Sold</th>
              {anyCut && <th className="num">Cut up</th>}
              <th className="num">Waste</th>
              <th className="num">Missing</th>
              <th>Yield (learnt, 4 weeks)</th>
              <th>This week vs last</th>
            </tr>
          </thead>
          <tbody>
            {ready.map((i) => {
              const raw = st.stockItems.find((x) => x.id === i.madeFrom);
              const y = yieldOf(st, i);
              const thisW = yieldOf(st, i, { days: 7, now }).perRaw;
              const lastW = yieldOf(st, i, { days: 7, now: weekAgo }).perRaw;
              const d = thisW !== null && lastW !== null ? Math.round((thisW - lastW) * 10) / 10 : null;
              return (
                <tr key={i.id}>
                  <td>
                    <b>{i.name}</b>
                    {i.countMade === false && <div className="muted small">plates counted from sales</div>}
                  </td>
                  <td className="num">
                    {num(total(i.id, 'rawUsed'))} {raw ? countUnit(raw) : ''}
                  </td>
                  <td className="num">{i.countMade === false ? '—' : num(total(i.id, 'made'))}</td>
                  <td className="num">{num(total(i.id, 'sold'))}</td>
                  {anyCut && <td className="num">{total(i.id, 'cut') ? num(total(i.id, 'cut')) : '—'}</td>}
                  <td className="num">{i.countMade === false ? '—' : num(total(i.id, 'waste'))}</td>
                  <td className={`num ${total(i.id, 'missing') > 0 ? 'bad' : ''}`}>{i.countMade === false ? '—' : num(total(i.id, 'missing'))}</td>
                  <td>{yieldText(i, raw, y.perRaw)}</td>
                  <td className={d === null || d === 0 ? 'muted' : d < 0 ? 'warn-t' : 'good-t'}>{d === null ? '—' : d === 0 ? 'same' : `${d > 0 ? '▲' : '▼'} ${Math.abs(d)}`}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="section-title">Day by day</div>
      <div style={{ overflowX: 'auto' }}>
        <table className="list">
          <thead>
            <tr>
              <th>Day</th>
              <th>Ready portion</th>
              <th className="num">Made</th>
              <th className="num">Sold</th>
              {anyCut && <th className="num">Cut up</th>}
              <th className="num">Waste</th>
              <th className="num">Missing</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr>
                <td colSpan={6} className="muted">
                  Nothing cooked or sold from ready portions in this period.
                </td>
              </tr>
            )}
            {rows
              .slice()
              .reverse()
              .map((r) => (
                <tr key={r.day + r.item.id}>
                  <td>{new Date(r.day + 'T12:00').toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' })}</td>
                  <td>{r.item.name}</td>
                  <td className="num">{r.item.countMade === false ? `${num(r.rawUsed)} used` : num(r.made)}</td>
                  <td className="num">{num(r.sold)}</td>
                  {anyCut && <td className="num">{r.cut ? num(r.cut) : '—'}</td>}
                  <td className="num">{num(r.waste)}</td>
                  <td className={`num ${r.missing > 0 ? 'bad' : ''}`}>{num(r.missing)}</td>
                </tr>
              ))}
          </tbody>
        </table>
      </div>
      <div className="section-title">Chart</div>
      {ready.length > 1 && (
        <div className="seg small" style={{ margin: '12px 0 4px' }}>
          {ready.map((i) => (
            <button key={i.id} className={item.id === i.id ? 'on' : ''} onClick={() => setPick(i.id)}>
              {i.name}
            </button>
          ))}
        </div>
      )}
      <BarChart
        grouped
        caption={`${item.name} per day — ${item.countMade === false ? 'plates sold' : 'made and sold'}`}
        labels={chartLabels}
        series={
          item.countMade === false
            ? [{ name: 'Sold', color: '#116a57', values: byDay('sold') }]
            : [
                { name: 'Made', color: '#f47b20', values: byDay('made') },
                { name: 'Sold', color: '#116a57', values: byDay('sold') },
              ]
        }
        format={(v) => num(v)}
      />

      <p className="muted small">
        Sold = what the sales used (a plate with 2 pieces counts 2). Missing = shortfall found in closing counts. Yield = what one raw unit gave, learnt from Today's
        cooking (for rice-style items: plates sold per unit used).
      </p>
    </>
  );
}
