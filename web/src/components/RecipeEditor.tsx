import { LuPlus, LuX } from 'react-icons/lu';
import { useStore } from '../store/store';
import { countUnit } from '../domain/stock';
import type { RecipeLine } from '../domain/types';

/**
 * "Stock used per plate": which stock items one plate (or one add-on) uses and how much,
 * in each item's count unit. Every sale takes this off stock.
 */
export default function RecipeEditor({ value, onChange, what = 'plate' }: { value?: RecipeLine[]; onChange: (v: RecipeLine[] | undefined) => void; what?: string }) {
  const items = useStore((s) => s.stockItems);
  const rows = value ?? [];
  const sorted = items.slice().sort((a, b) => Number(!!b.track) - Number(!!a.track) || a.name.localeCompare(b.name));
  const set = (i: number, patch: Partial<RecipeLine>) => onChange(rows.map((r, k) => (k === i ? { ...r, ...patch } : r)));
  const remove = (i: number) => {
    const next = rows.filter((_, k) => k !== i);
    onChange(next.length ? next : undefined);
  };
  const add = () => {
    const free = sorted.find((it) => it.track && !rows.some((r) => r.stockItemId === it.id)) ?? sorted[0];
    if (free) onChange([...rows, { stockItemId: free.id, qty: 0 }]);
  };
  return (
    <>
      <div className="section-title">Stock used per {what}</div>
      <p className="hint" style={{ marginTop: -4 }}>
        Taken off stock with every sale, so the Stock screen knows what is left. Leave empty for things you do not count.
      </p>
      <div className="recipe-rows">
        {rows.map((r, i) => {
          const it = items.find((x) => x.id === r.stockItemId);
          return (
            <div key={i} className="recipe-row">
              <select value={r.stockItemId} onChange={(e) => set(i, { stockItemId: e.target.value })} aria-label="Stock item">
                {sorted.map((x) => (
                  <option key={x.id} value={x.id}>
                    {x.name}
                    {x.track ? '' : ' (not counted)'}
                  </option>
                ))}
              </select>
              <input
                type="number"
                inputMode="decimal"
                min={0}
                step="any"
                value={r.qty || ''}
                placeholder="0"
                onChange={(e) => set(i, { qty: Math.max(0, Number(e.target.value) || 0) })}
                aria-label={`Amount of ${it?.name ?? 'item'} per ${what}`}
              />
              <span className="muted recipe-unit">{it ? countUnit(it) : ''}</span>
              <button className="btn icon-only" onClick={() => remove(i)} aria-label={`Remove ${it?.name ?? 'item'}`}>
                <LuX aria-hidden="true" />
              </button>
            </div>
          );
        })}
      </div>
      <button className="btn" onClick={add} disabled={!items.length}>
        <LuPlus aria-hidden="true" />
        Add stock item
      </button>
    </>
  );
}
