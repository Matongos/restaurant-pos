import { useMemo, useState } from 'react';

export interface Series {
  name: string;
  color: string;
  values: number[];
}

/**
 * Stacked column chart drawn in SVG, sized to its container.
 * Thin columns with rounded tops, a 2px gap between stacked parts, hairline grid,
 * legend for 2+ series, hover tooltip per column, and a table view for screen readers.
 */
export default function BarChart({
  labels,
  series,
  height = 240,
  format = (v: number) => String(Math.round(v)),
  unit = '',
  highlight,
  caption,
}: {
  labels: string[];
  series: Series[];
  height?: number;
  format?: (v: number) => string;
  unit?: string;
  /** Index of the column to call out with its total (e.g. the busiest hour). */
  highlight?: number;
  caption: string;
}) {
  const [hover, setHover] = useState<number | null>(null);
  const [table, setTable] = useState(false);

  const W = 720;
  const padL = 36, padR = 8, padT = 22, padB = 26;
  const plotW = W - padL - padR;
  const plotH = height - padT - padB;
  const n = labels.length;
  const totals = useMemo(() => labels.map((_, i) => series.reduce((s, se) => s + (se.values[i] ?? 0), 0)), [labels, series]);
  const max = Math.max(1, ...totals);
  const ticks = niceTicks(max);
  const top = ticks[ticks.length - 1];
  const y = (v: number) => padT + plotH - (v / top) * plotH;
  const band = plotW / n;
  const barW = Math.min(24, band * 0.6);
  const cx = (i: number) => padL + band * i + band / 2;
  const labelEvery = n > 16 ? Math.ceil(n / 12) : 1;

  return (
    <figure className="chart">
      <figcaption className="chart-head">
        <span>{caption}</span>
        <span className="row" style={{ gap: 12 }}>
          {series.length > 1 &&
            series.map((s) => (
              <span key={s.name} className="legend-item">
                <span className="swatch" style={{ background: s.color }} />
                {s.name}
              </span>
            ))}
          <button className="link-btn" onClick={() => setTable((t) => !t)}>
            {table ? 'Show chart' : 'Show table'}
          </button>
        </span>
      </figcaption>
      {!table ? (
        <div className="chart-box" onMouseLeave={() => setHover(null)}>
          <svg viewBox={`0 0 ${W} ${height}`} width="100%" role="img" aria-label={caption}>
            {ticks.map((t) => (
              <g key={t}>
                <line x1={padL} x2={W - padR} y1={y(t)} y2={y(t)} stroke="var(--chart-grid)" strokeWidth={1} />
                <text x={padL - 6} y={y(t) + 4} textAnchor="end" className="tick">
                  {format(t)}
                </text>
              </g>
            ))}
            {labels.map((lab, i) => {
              let acc = 0;
              const parts = series
                .map((s) => ({ s, v: s.values[i] ?? 0 }))
                .filter((p) => p.v > 0);
              return (
                <g key={lab}>
                  {parts.map((p, k) => {
                    const y0 = y(acc);
                    acc += p.v;
                    const y1 = y(acc);
                    const isTop = k === parts.length - 1;
                    const gap = k > 0 ? 2 : 0; // surface gap between stacked parts
                    const h = Math.max(0, y0 - y1 - gap);
                    return (
                      <path
                        key={p.s.name}
                        d={roundedTop(cx(i) - barW / 2, y1, barW, h, isTop ? Math.min(4, h) : 0)}
                        fill={p.s.color}
                        opacity={hover === null || hover === i ? 1 : 0.55}
                      />
                    );
                  })}
                  {highlight === i && totals[i] > 0 && (
                    <text x={cx(i)} y={y(totals[i]) - 6} textAnchor="middle" className="peak">
                      {format(totals[i])}
                    </text>
                  )}
                  {i % labelEvery === 0 && (
                    <text x={cx(i)} y={height - 8} textAnchor="middle" className="tick">
                      {lab}
                    </text>
                  )}
                  {/* Hover target: the whole column band, larger than the bar. */}
                  <rect x={padL + band * i} y={padT} width={band} height={plotH} fill="transparent" onMouseEnter={() => setHover(i)} onClick={() => setHover(i)} />
                </g>
              );
            })}
            <line x1={padL} x2={W - padR} y1={y(0)} y2={y(0)} stroke="var(--chart-axis)" strokeWidth={1} />
          </svg>
          {hover !== null && (
            <div className="chart-tip" style={{ left: `${Math.min(86, Math.max(14, (cx(hover) / W) * 100))}%` }}>
              <b>{labels[hover]}</b>
              {series.map((s) => (
                <div key={s.name}>
                  <span className="swatch" style={{ background: s.color }} /> {s.name}: <b>{format(s.values[hover] ?? 0)}</b>
                </div>
              ))}
              {series.length > 1 && (
                <div className="tip-total">
                  Total: <b>{format(totals[hover])}</b> {unit}
                </div>
              )}
            </div>
          )}
        </div>
      ) : (
        <div style={{ overflowX: 'auto' }}>
          <table className="list">
            <thead>
              <tr>
                <th></th>
                {series.map((s) => (
                  <th key={s.name}>{s.name}</th>
                ))}
                {series.length > 1 && <th>Total</th>}
              </tr>
            </thead>
            <tbody>
              {labels.map((lab, i) => (
                <tr key={lab}>
                  <td>{lab}</td>
                  {series.map((s) => (
                    <td key={s.name} className="num">
                      {format(s.values[i] ?? 0)}
                    </td>
                  ))}
                  {series.length > 1 && (
                    <td className="num">
                      <b>{format(totals[i])}</b>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </figure>
  );
}

function roundedTop(x: number, y: number, w: number, h: number, r: number): string {
  if (h <= 0) return '';
  if (r <= 0) return `M${x},${y}h${w}v${h}h${-w}z`;
  return `M${x},${y + h}V${y + r}Q${x},${y} ${x + r},${y}H${x + w - r}Q${x + w},${y} ${x + w},${y + r}V${y + h}z`;
}

/** 0 and 3–5 clean steps up to at least max. */
function niceTicks(max: number): number[] {
  const raw = max / 4;
  const mag = Math.pow(10, Math.floor(Math.log10(raw)));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw) ?? 10 * mag;
  const out: number[] = [];
  for (let v = 0; v <= max + step * 0.001 || out.length < 2; v += step) out.push(Math.round(v * 100) / 100);
  if (out[out.length - 1] < max) out.push(out[out.length - 1] + step);
  return out;
}
