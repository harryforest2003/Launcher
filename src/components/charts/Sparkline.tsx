import { SERIES_ACCENT } from "./colors";
import "./charts.css";

type Props = { values: number[]; width?: number; height?: number; color?: string };

/* A word-sized trend beside a number: no axes, the last point marked. Decorative (the number
   next to it says the value), so it's hidden from screen readers. */
export default function Sparkline({ values, width = 96, height = 28, color = SERIES_ACCENT }: Props) {
  if (values.length < 2) return null;
  const max = Math.max(...values, 1);
  const pad = 3;
  const x = (i: number) => pad + (i / (values.length - 1)) * (width - pad * 2);
  const y = (v: number) => pad + (height - pad * 2) * (1 - v / max);
  const d = values.map((v, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join("");
  const last = values.length - 1;
  return (
    <svg className="chart-spark" width={width} height={height} aria-hidden="true">
      <path className="chart-spark__line" d={d} stroke={color} />
      <circle className="chart-dot" cx={x(last)} cy={y(values[last])} r={3} fill={color} />
    </svg>
  );
}
