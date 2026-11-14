import type { ReactNode } from "react";
import "./charts.css";

export type TooltipRow = { key: string; color?: string; label: ReactNode; value: ReactNode };

type Props = {
  /** Where it points, in px from the chart box's top-left; it sits above that point. */
  x: number;
  y: number;
  title?: ReactNode;
  rows: TooltipRow[];
  /** The chart box's width, so the tooltip never leaves it. */
  bounds?: number;
};

/* One tooltip for every chart: values lead (strong), names follow, each row keyed by a short
   stroke of its series colour. It never takes the pointer, so hover keeps tracking. */
export default function ChartTooltip({ x, y, title, rows, bounds }: Props) {
  // Keep it inside the chart: shift its anchor near either edge.
  const shift = bounds ? (x < 90 ? "0%" : x > bounds - 90 ? "-100%" : "-50%") : "-50%";
  return (
    <div className="chart-tooltip" role="presentation" style={{ left: x, top: y, transform: `translate(${shift}, calc(-100% - 10px))` }}>
      {title && <div className="chart-tooltip__title">{title}</div>}
      {rows.map((row) => (
        <div key={row.key} className="chart-tooltip__row">
          {row.color && <span className="chart-key" style={{ background: row.color }} aria-hidden="true" />}
          <strong>{row.value}</strong>
          <span>{row.label}</span>
        </div>
      ))}
    </div>
  );
}
