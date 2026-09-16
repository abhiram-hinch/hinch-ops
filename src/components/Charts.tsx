import { useState } from "react";

/**
 * Fixed-order categorical palette (dataviz skill default instance) — validated
 * colorblind-safe in this order. Assign by index, never reassign on filter.
 */
const CATEGORICAL = [
  "#2a78d6",
  "#eb6834",
  "#1baf7a",
  "#eda100",
  "#e87ba4",
  "#008300",
  "#4a3aa7",
  "#e34948",
];

export const categoricalColor = (i: number) => CATEGORICAL[i % CATEGORICAL.length];

/** Single-series trend line with a hover crosshair + tooltip. */
export function TrendLine({
  data,
  color = "#635BFF",
  formatValue = (v: number) => String(v),
  height = 160,
}: {
  data: { label: string; value: number }[];
  color?: string;
  formatValue?: (v: number) => string;
  height?: number;
}) {
  const [hover, setHover] = useState<number | null>(null);
  const width = 600;
  const padL = 4;
  const padR = 4;
  const padT = 12;
  const padB = 22;
  const innerW = width - padL - padR;
  const innerH = height - padT - padB;
  const n = data.length;
  const max = Math.max(1, ...data.map((d) => d.value));

  if (n === 0) {
    return <p className="py-8 text-center text-[13px] text-muted">No data for this period.</p>;
  }

  const x = (i: number) => padL + (n <= 1 ? innerW / 2 : (i / (n - 1)) * innerW);
  const y = (v: number) => padT + innerH - (v / max) * innerH;
  const path = data.map((d, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(1)},${y(d.value).toFixed(1)}`).join(" ");
  const gridVals = [0, max / 2, max];

  function onMove(e: React.MouseEvent<SVGSVGElement>) {
    const rect = e.currentTarget.getBoundingClientRect();
    const px = ((e.clientX - rect.left) / rect.width) * width;
    let idx = 0;
    let best = Infinity;
    data.forEach((_, i) => {
      const d = Math.abs(x(i) - px);
      if (d < best) {
        best = d;
        idx = i;
      }
    });
    setHover(idx);
  }

  return (
    <div className="relative">
      <svg
        viewBox={`0 0 ${width} ${height}`}
        className="w-full touch-none"
        onMouseMove={onMove}
        onMouseLeave={() => setHover(null)}
      >
        {gridVals.map((g, i) => (
          <line
            key={i}
            x1={padL}
            x2={width - padR}
            y1={y(g)}
            y2={y(g)}
            stroke="#E7EAF0"
            strokeWidth={1}
          />
        ))}
        <path d={path} fill="none" stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
        {hover !== null && (
          <>
            <line
              x1={x(hover)}
              x2={x(hover)}
              y1={padT}
              y2={height - padB}
              stroke="#CBD5E1"
              strokeWidth={1}
            />
            <circle cx={x(hover)} cy={y(data[hover].value)} r={4} fill={color} stroke="#fff" strokeWidth={1.5} />
          </>
        )}
        <text x={padL} y={height - 6} fontSize="10" fill="#94A3B8">
          {data[0].label}
        </text>
        <text x={width - padR} y={height - 6} fontSize="10" fill="#94A3B8" textAnchor="end">
          {data[n - 1].label}
        </text>
      </svg>
      {hover !== null && (
        <div
          className="pointer-events-none absolute -translate-x-1/2 -translate-y-[calc(100%+8px)] whitespace-nowrap rounded bg-ink px-2 py-1 text-micro font-medium text-white shadow-raised"
          style={{ left: `${(x(hover) / width) * 100}%`, top: `${(y(data[hover].value) / height) * 100}%` }}
        >
          {data[hover].label} · {formatValue(data[hover].value)}
        </div>
      )}
    </div>
  );
}

/** Horizontal bar rows, each optionally split into stacked segments (e.g. fresh vs aged). */
export function BarRows({
  rows,
  formatValue = (v: number) => String(v),
  legend,
}: {
  rows: { label: string; segments: { value: number; color: string }[] }[];
  formatValue?: (v: number) => string;
  legend?: { label: string; color: string }[];
}) {
  const max = Math.max(1, ...rows.map((r) => r.segments.reduce((s, seg) => s + seg.value, 0)));

  if (rows.length === 0) {
    return <p className="py-6 text-center text-[13px] text-muted">No data for this period.</p>;
  }

  return (
    <div className="space-y-2.5">
      {legend && legend.length > 1 && (
        <div className="flex flex-wrap items-center gap-3 text-micro text-muted">
          {legend.map((l) => (
            <span key={l.label} className="flex items-center gap-1.5">
              <span className="h-2 w-2 rounded-full" style={{ background: l.color }} />
              {l.label}
            </span>
          ))}
        </div>
      )}
      {rows.map((r) => {
        const total = r.segments.reduce((s, seg) => s + seg.value, 0);
        return (
          <div key={r.label} className="flex items-center gap-3">
            <span className="w-32 shrink-0 truncate text-[13px] text-ink" title={r.label}>
              {r.label}
            </span>
            <div className="h-5 flex-1 rounded bg-raised">
              <div className="flex h-full gap-[2px]" style={{ width: `${(total / max) * 100}%` }}>
                {r.segments.map((seg, i) => (
                  <div
                    key={i}
                    style={{ width: `${(seg.value / (total || 1)) * 100}%`, background: seg.color }}
                    className={`h-full ${i === 0 ? "rounded-l" : ""} ${
                      i === r.segments.length - 1 ? "rounded-r" : ""
                    }`}
                  />
                ))}
              </div>
            </div>
            <span className="num w-24 shrink-0 text-right text-[13px] font-medium text-ink">
              {formatValue(total)}
            </span>
          </div>
        );
      })}
    </div>
  );
}
