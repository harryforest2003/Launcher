import { useEffect, useState, type ReactNode } from "react";
import "./charts.css";

export type DonutSlice = { id: string; label: string; value: number; valueLabel: string; color: string };

type Props = {
  slices: DonutSlice[];
  /** The big words in the middle when nothing is hovered (the total). */
  center: ReactNode;
  centerLabel: string;
  /** What the chart shows, for screen readers. */
  label: string;
  size?: number;
  formatShare: (value: number, total: number) => string;
};

const STROKE = 14;
const GAP = 2;

/* Part of a whole, at a glance: at most four slices (three named and "Other") with a 2px gap
   between them, and a legend that names each with its value and share, so colour is never the
   only way to tell them apart. Hovering or focusing a slice or its legend row lifts it and puts
   its numbers in the middle. Slices sweep in on first show and glide when the data changes. */
export default function DonutChart({ slices, center, centerLabel, label, size = 148, formatShare }: Props) {
  const [active, setActive] = useState<string | null>(null);
  const [grown, setGrown] = useState(false);
  useEffect(() => {
    const frame = requestAnimationFrame(() => setGrown(true));
    return () => cancelAnimationFrame(frame);
  }, []);

  const total = slices.reduce((n, s) => n + s.value, 0);
  const r = (size - STROKE - 6) / 2;
  const circumference = 2 * Math.PI * r;
  const shown = slices.filter((s) => s.value > 0);
  const gap = shown.length > 1 ? GAP : 0;

  // Each slice starts where the ones before it end.
  const lengths = shown.map((s) => (total ? (s.value / total) * circumference : 0));
  const arcs = shown.map((s, i) => ({
    ...s,
    dash: Math.max(lengths[i] - gap, 0.5),
    offset: lengths.slice(0, i).reduce((n, l) => n + l, 0),
  }));

  const hovered = shown.find((s) => s.id === active);

  return (
    <div className="chart chart-donut">
      <div className="chart-donut__ring" style={{ width: size, height: size }}>
        <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} role="img" aria-label={label}>
          <g transform={`rotate(-90 ${size / 2} ${size / 2})`}>
            <circle className="chart-donut__track" cx={size / 2} cy={size / 2} r={r} strokeWidth={STROKE} fill="none" />
            {arcs.map((a) => (
              <circle
                key={a.id}
                className={`chart-donut__slice${active === a.id ? " is-active" : ""}${active && active !== a.id ? " is-dim" : ""}`}
                cx={size / 2}
                cy={size / 2}
                r={r}
                fill="none"
                stroke={a.color}
                strokeWidth={STROKE}
                strokeDasharray={grown ? `${a.dash} ${circumference - a.dash}` : `0 ${circumference}`}
                strokeDashoffset={-a.offset}
                onPointerEnter={() => setActive(a.id)}
                onPointerLeave={() => setActive(null)}
              />
            ))}
          </g>
        </svg>
        <div className="chart-donut__center" aria-hidden="true">
          <strong>{hovered ? hovered.valueLabel : center}</strong>
          <span>{hovered ? `${hovered.label}, ${formatShare(hovered.value, total)}` : centerLabel}</span>
        </div>
      </div>

      <ul className="chart-legend">
        {slices.map((s) => (
          <li
            key={s.id}
            tabIndex={0}
            className={`chart-legend__item${active === s.id ? " is-active" : ""}`}
            onPointerEnter={() => setActive(s.id)}
            onPointerLeave={() => setActive(null)}
            onFocus={() => setActive(s.id)}
            onBlur={() => setActive(null)}
            aria-label={`${s.label}: ${s.valueLabel}, ${formatShare(s.value, total)}`}
          >
            <span className="chart-swatch" style={{ background: s.color }} aria-hidden="true" />
            <span className="chart-legend__label">{s.label}</span>
            <span className="chart-legend__value">{formatShare(s.value, total)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
