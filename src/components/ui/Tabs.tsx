import { useLayoutEffect, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import "./ui.css";

type Tab<T extends string> = { value: T; label: string; count?: number; icon?: ReactNode };

type Props<T extends string> = {
  label: string;
  value: T;
  tabs: Tab<T>[];
  onChange: (value: T) => void;
  /** Id prefix for tab/panel wiring: the panel for tab X should have id `${idBase}-panel-X`. */
  idBase?: string;
};

/*
 * A row of tabs with an underline that slides to the chosen one. Arrow keys move between tabs
 * (and choose), Home/End jump. Put each panel in role="tabpanel" with the matching id.
 */
export default function Tabs<T extends string>({ label, value, tabs, onChange, idBase = "tabs" }: Props<T>) {
  const refs = useRef<Record<string, HTMLButtonElement | null>>({});
  const listRef = useRef<HTMLDivElement>(null);
  const [bar, setBar] = useState<{ left: number; width: number } | null>(null);

  // Equal-width tabs change size with the window, so the underline is measured again then too.
  useLayoutEffect(() => {
    const measure = () => {
      const el = refs.current[value];
      setBar(el ? { left: el.offsetLeft, width: el.offsetWidth } : null);
    };
    measure();
    const list = listRef.current;
    if (!list || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    observer.observe(list);
    return () => observer.disconnect();
  }, [value, tabs]);

  const onKeyDown = (event: KeyboardEvent, index: number) => {
    const last = tabs.length - 1;
    const to =
      event.key === "ArrowRight" ? (index + 1) % tabs.length : event.key === "ArrowLeft" ? (index - 1 + tabs.length) % tabs.length : event.key === "Home" ? 0 : event.key === "End" ? last : -1;
    if (to < 0) return;
    event.preventDefault();
    onChange(tabs[to].value);
    refs.current[tabs[to].value]?.focus();
  };

  return (
    <div ref={listRef} role="tablist" aria-label={label} className="ui-tabs">
      {tabs.map((tab, index) => {
        const on = tab.value === value;
        return (
          <button
            key={tab.value}
            ref={(el) => {
              refs.current[tab.value] = el;
            }}
            type="button"
            role="tab"
            id={`${idBase}-tab-${tab.value}`}
            data-testid={`${idBase}-${tab.value}`}
            aria-selected={on}
            aria-controls={`${idBase}-panel-${tab.value}`}
            tabIndex={on ? 0 : -1}
            className="ui-tabs__tab"
            onClick={() => onChange(tab.value)}
            onKeyDown={(event) => onKeyDown(event, index)}
          >
            {tab.icon}
            {tab.label}
            {tab.count != null && <span className="ui-tabs__count">{tab.count}</span>}
          </button>
        );
      })}
      <span className="ui-tabs__bar" aria-hidden="true" style={bar ? { transform: `translateX(${bar.left}px)`, width: bar.width } : { opacity: 0 }} />
    </div>
  );
}
