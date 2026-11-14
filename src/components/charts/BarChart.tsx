import { useEffect, useState, type ReactNode } from "react";
import ChartTooltip, { type TooltipRow } from "./ChartTooltip";
import { SERIES_ACCENT } from "./colors";
import { useWidth } from "./useWidth";
import "./charts.css";

export type BarItem = {
  id: string;
  label: string;
  value: number;
  /** The value in words, shown at the end of the row ("3 h 20 min"). */
  valueLabel: string;
  /** Overrides the series colour for this bar (rarely: a one-series chart keeps one colour). */
  color?: string;
  /** Something to put before the label (a small picture). */
  lead?: ReactNode;
  /** A quiet line under the bar ("9 sessions, played yesterday"). */
  sub?: string;
};

type Props = {
  items: BarItem[];
  /** What the chart shows, for screen readers. */
  label: string;
  /** Extra tooltip lines for an item (the value line is added for you). */
  describe?: (item: BarItem) => TooltipRow[];
  color?: string;
  /** Called when a row is chosen (click or Enter). */
  onSelect?: (item: BarItem) => void;
};

/* Ranked horizontal bars, one series: name and value on a line, a thin bar under it growing from
   a shared baseline. Each row is a hover and focus target with its own tooltip. Bars grow in on
   first show and glide to new lengths when the data changes (instant with reduced motion). */
export default function BarChart({ items, label, describe, color = SERIES_ACCENT, onSelect }: Props) {
  const [box, width] = useWidth<HTMLDivElement>();
  const [grown, setGrown] = useState(false);
  const [active, setActive] = useState<{ id: string; y: number } | null>(null);

  useEffect(() => {
    const frame = requestAnimationFrame(() => setGrown(true));
    return () => cancelAnimationFrame(frame);
  }, []);

  const max = Math.max(...items.map((i) => i.value), 1);
  const activeItem = active ? items.find((i) => i.id === active.id) : null;

  return (
    <div className="chart chart-bars" ref={box} role="list" aria-label={label}>
      {items.map((item) => {
        const share = item.value / max;
        const show = (el: HTMLElement) => setActive({ id: item.id, y: el.offsetTop + 4 });
        return (
          <div
            key={item.id}
            role="listitem"
            tabIndex={0}
            aria-label={`${item.label}: ${item.valueLabel}${item.sub ? `. ${item.sub}` : ""}`}
            className={`chart-bar-row${active?.id === item.id ? " is-active" : ""}${onSelect ? " is-link" : ""}`}
            onPointerEnter={(e) => show(e.currentTarget)}
            onPointerLeave={() => setActive(null)}
            onFocus={(e) => show(e.currentTarget)}
            onBlur={() => setActive(null)}
            onClick={() => onSelect?.(item)}
            onKeyDown={(e) => {
              if (onSelect && (e.key === "Enter" || e.key === " ")) {
                e.preventDefault();
                onSelect(item);
              }
            }}
          >
            <div className="chart-bar-row__text">
              {item.lead}
              <span className="chart-bar-row__label">{item.label}</span>
              <span className="chart-bar-row__value">{item.valueLabel}</span>
            </div>
            <div className="chart-bar-track" aria-hidden="true">
              <div
                className="chart-bar"
                style={{ width: grown ? `${Math.max(share * 100, item.value > 0 ? 1.5 : 0)}%` : 0, background: item.color ?? color }}
              />
            </div>
            {item.sub && <div className="chart-bar-row__sub">{item.sub}</div>}
          </div>
        );
      })}

      {activeItem && active && (
        <ChartTooltip
          x={width / 2}
          y={active.y}
          bounds={width}
          title={activeItem.label}
          rows={[{ key: "value", color: activeItem.color ?? color, label: "played", value: activeItem.valueLabel }, ...(describe?.(activeItem) ?? [])]}
        />
      )}
    </div>
  );
}
