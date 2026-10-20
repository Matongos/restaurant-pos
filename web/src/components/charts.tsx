import { useState } from 'react';

/* ------------------------------------------------------------ shared scale */

export function niceTicks(max: number): number[] {
  if (!(max > 0)) return [0, 1];
  const raw = max / 4;
  const mag = Math.pow(10, Math.floor(Math.log10(raw)));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw) ?? 10 * mag;
  const out: number[] = [];
  for (let v = 0; v < max + step; v += step) {
    out.push(Math.round(v * 1000) / 1000);
    if (v >= max) break;
  }
  return out;
}

/* ------------------------------------------------------------ line chart */

/**
 * Area + line for the chosen metric, with the previous period as a quiet dashed line
 * (like X analytics). Crosshair tooltip on hover/tap. Gaps where there is no value.
 */
export function TrendChart({
  labels,
  values,
  compare,
  format,
  tickFormat = format,
  caption,
  color = 'var(--brand)',
  height = 260,
}: {
  labels: string[];
  values: (number | null)[];
  compare?: (number | null)[];
  format: (v: number) => string;
  /** Shorter format for the y-axis, e.g. $2k. */
  tickFormat?: (v: number) => string;
  caption: string;
  color?: string;
  height?: number;
}) {
  const [hover, setHover] = useState<number | null>(null);
  const W = 760;
  const padL = 54, padR = 14, padT = 16, padB = 28;
  const plotW = W - padL - padR;
  const plotH = height - padT - padB;
  const n = values.length;
  const all = [...values, ...(compare ?? [])].filter((v): v is number => v !== null);
  const ticks = niceTicks(Math.max(0, ...all));
  const top = ticks[ticks.length - 1] || 1;
  const x = (i: number) => padL + (n <= 1 ? plotW / 2 : (i / (n - 1)) * plotW);
  const y = (v: number) => padT + plotH - (v / top) * plotH;
  const every = Math.max(1, Math.ceil(n / 8));

  const path = (vs: (number | null)[]) => {
    let d = '';
    let pen = false;
    vs.forEach((v, i) => {
      if (v === null) return void (pen = false);
      d += `${pen ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)}`;
      pen = true;
    });
    return d;
  };
  const area = (vs: (number | null)[]) => {
    // One closed shape per unbroken run of values.
    let d = '';
    let run: number[] = [];
    const flush = () => {
      if (run.length) {
        d += `M${x(run[0])},${y(0)}` + run.map((i) => `L${x(i)},${y(vs[i]!)}`).join('') + `L${x(run[run.length - 1])},${y(0)}Z`;
      }
      run = [];
    };
    vs.forEach((v, i) => (v === null ? flush() : run.push(i)));
    flush();
    return d;
  };
  const lastIdx = [...values].map((v, i) => (v === null ? -1 : i)).filter((i) => i >= 0).pop();

  return (
    <figure className="chart" aria-label={caption}>
      <figcaption className="chart-head">
        <span>{caption}</span>
        {compare && (
          <span className="row" style={{ gap: 12 }}>
            <span className="legend-item">
              <span className="line-key" style={{ background: color }} />
              This period
            </span>
            <span className="legend-item">
              <span className="line-key dashed" />
              Previous period
            </span>
          </span>
        )}
      </figcaption>
      <div className="chart-box" onMouseLeave={() => setHover(null)}>
        <svg viewBox={`0 0 ${W} ${height}`} width="100%" role="img" aria-label={caption}>
          {ticks.map((t) => (
            <g key={t}>
              <line x1={padL} x2={W - padR} y1={y(t)} y2={y(t)} stroke="var(--chart-grid)" />
              <text x={padL - 8} y={y(t) + 4} textAnchor="end" className="tick">
                {tickFormat(t)}
              </text>
            </g>
          ))}
          {labels.map((l, i) =>
            i % every === 0 || (i === n - 1 && (n - 1) % every > every / 2) ? (
              <text key={i} x={x(i)} y={height - 8} textAnchor={i === 0 ? 'start' : i === n - 1 ? 'end' : 'middle'} className="tick">
                {l}
              </text>
            ) : null,
          )}
          {compare && <path d={path(compare)} fill="none" stroke="var(--chart-compare)" strokeWidth={2} strokeDasharray="5 5" strokeLinecap="round" />}
          <path d={area(values)} fill={color} opacity={0.1} />
          <path d={path(values)} fill="none" stroke={color} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
          {lastIdx !== undefined && hover === null && (
            <circle cx={x(lastIdx)} cy={y(values[lastIdx]!)} r={4.5} fill={color} stroke="var(--panel)" strokeWidth={2} />
          )}
          {hover !== null && (
            <g>
              <line x1={x(hover)} x2={x(hover)} y1={padT} y2={padT + plotH} stroke="var(--chart-axis)" />
              {values[hover] !== null && <circle cx={x(hover)} cy={y(values[hover]!)} r={5} fill={color} stroke="var(--panel)" strokeWidth={2} />}
              {compare?.[hover] != null && <circle cx={x(hover)} cy={y(compare[hover]!)} r={4} fill="var(--chart-compare)" stroke="var(--panel)" strokeWidth={2} />}
            </g>
          )}
          {values.map((_, i) => (
            <rect
              key={i}
              x={x(i) - (n > 1 ? plotW / (n - 1) / 2 : plotW / 2)}
              y={padT}
              width={n > 1 ? plotW / (n - 1) : plotW}
              height={plotH}
              fill="transparent"
              onMouseEnter={() => setHover(i)}
              onClick={() => setHover(i)}
            />
          ))}
        </svg>
        {hover !== null && (
          <div className="chart-tip" style={{ left: `${Math.min(84, Math.max(16, (x(hover) / W) * 100))}%` }}>
            <b>{labels[hover]}</b>
            <div>
              <span className="swatch" style={{ background: color }} /> This period: <b>{values[hover] === null ? '—' : format(values[hover]!)}</b>
            </div>
            {compare && (
              <div>
                <span className="swatch" style={{ background: 'var(--chart-compare)' }} /> Previous: <b>{compare[hover] == null ? '—' : format(compare[hover]!)}</b>
              </div>
            )}
          </div>
        )}
      </div>
    </figure>
  );
}

/* ------------------------------------------------------------ sparkline */

export function Sparkline({ values, color = 'var(--brand)' }: { values: (number | null)[]; color?: string }) {
  const W = 120, H = 30;
  const vs = values.map((v) => v ?? 0);
  const max = Math.max(...vs, 0) || 1;
  const n = vs.length;
  if (n < 2) return null;
  const pts = vs.map((v, i) => `${((i / (n - 1)) * (W - 4) + 2).toFixed(1)},${(H - 3 - (v / max) * (H - 6)).toFixed(1)}`);
  return (
    <svg viewBox={`0 0 ${W} ${H}`} width={W} height={H} aria-hidden="true" className="spark">
      <polyline points={pts.join(' ')} fill="none" stroke={color} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}

/* ------------------------------------------------------------ heat map */

/** Weekday × hour grid, one hue light → dark. Values printed in each cell. */
export function Heatmap({
  rows,
  cols,
  values,
  format,
  caption,
  cellTitle,
}: {
  rows: string[];
  cols: string[];
  values: number[][];
  format: (v: number) => string;
  caption: string;
  cellTitle: (r: number, c: number) => string;
}) {
  const max = Math.max(0.0001, ...values.flat());
  return (
    <figure className="chart heat" aria-label={caption}>
      <figcaption className="chart-head">
        <span>{caption}</span>
        <span className="heat-legend">
          Quiet <span className="heat-scale" /> Busy
        </span>
      </figcaption>
      <div style={{ overflowX: 'auto' }}>
        <table className="heat-table">
          <thead>
            <tr>
              <th></th>
              {cols.map((c) => (
                <th key={c}>{c}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r, ri) => (
              <tr key={r}>
                <th>{r}</th>
                {cols.map((c, ci) => {
                  const v = values[ri][ci];
                  const t = v / max;
                  return (
                    <td
                      key={c}
                      title={cellTitle(ri, ci)}
                      style={{
                        background: v > 0 ? `color-mix(in srgb, var(--brand) ${Math.round(8 + t * 87)}%, #fff)` : 'var(--soft)',
                        color: t > 0.5 ? '#fff' : 'var(--ink)',
                      }}
                    >
                      {v >= 0.5 ? format(v) : ''}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </figure>
  );
}
