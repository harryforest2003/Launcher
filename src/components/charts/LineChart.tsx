import { useId, useMemo, useState, type KeyboardEvent, type PointerEvent, type ReactNode } from "react";
import ChartTooltip, { type TooltipRow } from "./ChartTooltip";
import { SERIES_ACCENT } from "./colors";
import { useWidth } from "./useWidth";
import "./charts.css";

export type LinePoint = { x: string; y: number };

type Props = {
  points: LinePoint[];
  series?: { id: string; color: string; values: number[] }[];
  /** Tick values for the y axis, lowest first (0 at the bottom). */
  ticks: number[];
  formatTick: (value: number) => string;
  formatX: (x: string) => string;
  /** The tooltip's lines for a point. */
  describe: (point: LinePoint, index: number) => { title: ReactNode; rows: TooltipRow[] };
  /** What the chart shows, for screen readers ("Play time per day, last 30 days"). */
  label: string;
  height?: number;
  color?: string;
  /** Changing it replays the drawing animation (a new date range, say). */
  animationKey?: string;
};

const PAD = { top: 10, right: 12, bottom: 22, left: 40 };

/* A single-series trend: 2px line over a faint wash, solid hairline grid, a crosshair that snaps
   to the nearest day (pointer or arrow keys) with one tooltip, and a hidden table for screen
   readers. It draws itself in once; with reduced motion it simply appears. */
export default function LineChart({ points, series, ticks, formatTick, formatX, describe, label, height = 200, color = SERIES_ACCENT, animationKey }: Props) {
  const [box, width] = useWidth<HTMLDivElement>();
  const [active, setActive] = useState<number | null>(null);
  const gradient = useId();

  const max = ticks[ticks.length - 1] || 1;
  const innerW = Math.max(10, width - PAD.left - PAD.right);
  const innerH = Math.max(10, height - PAD.top - PAD.bottom);
  const xAt = (i: number) => PAD.left + (points.length <= 1 ? innerW / 2 : (i / (points.length - 1)) * innerW);
  const yAt = (v: number) => PAD.top + innerH - (Math.min(v, max) / max) * innerH;

  const { line, area } = useMemo(() => {
    if (!points.length) return { line: "", area: "" };
    const coords = points.map((p, i) => [xAt(i), yAt(p.y)] as const);
    const line = coords.map(([x, y], i) => `${i ? "L" : "M"}${x.toFixed(1)},${y.toFixed(1)}`).join("");
    const base = PAD.top + innerH;
    const area = `${line}L${coords[coords.length - 1][0].toFixed(1)},${base}L${coords[0][0].toFixed(1)},${base}Z`;
    return { line, area };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [points, width, height, max]);

  // About five dates along the bottom, always the first and last.
  const xLabels = useMemo(() => {
    const n = points.length;
    if (n === 0) return [];
    const want = Math.max(2, Math.min(6, Math.floor(innerW / 90)));
    const step = Math.max(1, Math.round((n - 1) / (want - 1)));
    const idx: number[] = [];
    for (let i = 0; i < n; i += step) idx.push(i);
    if (idx[idx.length - 1] !== n - 1) {
      if (n - 1 - idx[idx.length - 1] < step / 2) idx.pop();
      idx.push(n - 1);
    }
    return idx;
  }, [points.length, innerW]);

  function pick(event: PointerEvent<SVGSVGElement>) {
    const rect = event.currentTarget.getBoundingClientRect();
    const x = event.clientX - rect.left - PAD.left;
    const i = Math.round((x / innerW) * (points.length - 1));
    setActive(Math.max(0, Math.min(points.length - 1, i)));
  }

  function keys(event: KeyboardEvent<SVGSVGElement>) {
    if (!points.length) return;
    const now = active ?? points.length - 1;
    const next =
      event.key === "ArrowLeft" ? now - 1 : event.key === "ArrowRight" ? now + 1 : event.key === "Home" ? 0 : event.key === "End" ? points.length - 1 : null;
    if (next === null) return;
    event.preventDefault();
    setActive(Math.max(0, Math.min(points.length - 1, next)));
  }

  const tip = active !== null && points[active] ? describe(points[active], active) : null;

  return (
    <div className="chart" ref={box} style={{ height }}>
      <svg
        width={width}
        height={height}
        role="img"
        aria-label={`${label}. Use the arrow keys to read each day.`}
        tabIndex={0}
        onPointerMove={pick}
        onPointerLeave={() => setActive(null)}
        onFocus={() => setActive((a) => a ?? points.length - 1)}
        onBlur={() => setActive(null)}
        onKeyDown={keys}
      >
        <defs>
          <linearGradient id={gradient} x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity="0.22" />
            <stop offset="100%" stopColor={color} stopOpacity="0.02" />
          </linearGradient>
        </defs>

        <g className="chart-grid" aria-hidden="true">
          {ticks.map((t) => (
            <g key={t}>
              <line x1={PAD.left} x2={width - PAD.right} y1={yAt(t)} y2={yAt(t)} />
              <text className="chart-axis" x={PAD.left - 8} y={yAt(t)} dy="0.32em" textAnchor="end">
                {formatTick(t)}
              </text>
            </g>
          ))}
          {xLabels.map((i) => (
            <text
              key={i}
              className="chart-axis"
              x={xAt(i)}
              y={height - 6}
              textAnchor={i === 0 ? "start" : i === points.length - 1 ? "end" : "middle"}
            >
              {formatX(points[i].x)}
            </text>
          ))}
        </g>

        <g key={animationKey} aria-hidden="true">
          {series ? series.map(({ id, color: stroke, values }) => (
            <path key={id} className="chart-line" d={values.map((value, i) =>
              `${i ? "L" : "M"}${xAt(i).toFixed(1)},${yAt(value).toFixed(1)}`).join("")} stroke={stroke} pathLength={1} />
          )) : (
            <>
              <path className="chart-area" d={area} fill={`url(#${gradient})`} />
              <path className="chart-line" d={line} stroke={color} pathLength={1} />
            </>
          )}
        </g>

        {active !== null && points[active] && (
          <g aria-hidden="true">
            <line className="chart-crosshair" x1={xAt(active)} x2={xAt(active)} y1={PAD.top} y2={PAD.top + innerH} />
            {series ? series.map((line) => (
              <circle key={line.id} className="chart-dot" cx={xAt(active)} cy={yAt(line.values[active])} r={4} fill={line.color} />
            )) : <circle className="chart-dot" cx={xAt(active)} cy={yAt(points[active].y)} r={4.5} fill={color} />}
          </g>
        )}
      </svg>

      {tip && active !== null && (
        <ChartTooltip x={xAt(active)} y={yAt(series ? Math.max(0, ...series.map((line) => line.values[active])) : points[active].y)} title={tip.title} rows={tip.rows} bounds={width} />
      )}

      <table className="u-visually-hidden">
        <caption>{label}</caption>
        <tbody>
          {points.map((p, i) => {
            const d = describe(p, i);
            return (
              <tr key={p.x}>
                <th scope="row">{d.title}</th>
                {d.rows.map((row) => <td key={row.key}>{row.label}: {row.value}</td>)}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
