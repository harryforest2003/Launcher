import { useEffect, useId, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { CircleCheck } from "lucide-react";
import "../theme/appearance.css";

export type SettingsCategory = {
  id: string;
  label: string;
  icon: ReactNode;
  /** A small heading above this category and the ones after it, until the next group. */
  group?: string;
  /** The category's content, shown under its heading in its own section of the page. */
  content: ReactNode;
};

type Props = {
  label: string;
  categories: SettingsCategory[];
  initial?: string;
};

/*
 * The slim header every settings page opens with: the title, one truncating line of lead (the full
 * text is its tooltip) and the save status, quiet, on the right. `status` replaces the standing
 * words for a moment ("Saving...").
 */
export function SettingsHeader({ title, lead, status }: { title: string; lead?: string; status?: string | null }) {
  return (
    <header className="set-topbar">
      <h1 className="set-topbar-title">{title}</h1>
      {lead && (
        <p className="set-topbar-lead" title={lead}>
          {lead}
        </p>
      )}
      <span className="set-topbar-status" role="status" aria-live="polite">
        <CircleCheck size={14} aria-hidden="true" />
        {status || "Changes save as you make them"}
      </span>
    </header>
  );
}

/*
 * Settings as one scrolling page: every category is a section stacked in order, and the list down
 * the left is a set of jump links that follows the scroll (the way Modrinth and CurseForge lay
 * theirs out). Arrow keys move between the links.
 */
export default function SettingsLayout({ label, categories, initial }: Props) {
  const [current, setCurrent] = useState(initial ?? categories[0]?.id);
  const base = useId();
  const root = useRef<HTMLDivElement>(null);
  const panes = useRef<HTMLDivElement>(null);
  // A link just chosen keeps the highlight until the reader scrolls by hand.
  const pinned = useRef(false);

  // The page's own scrolling box: .app-page on most pages, a plain overflow box on game pages.
  const scrollerOf = (el: HTMLElement | null) => {
    for (let node = el?.parentElement ?? null; node; node = node.parentElement) {
      if (/auto|scroll/.test(getComputedStyle(node).overflowY)) return node;
    }
    return null;
  };
  const sectionOf = (id: string) => document.getElementById(`${base}-pane-${id}`);
  const reduced = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  const jump = (id: string, smooth = true) => {
    pinned.current = true;
    setCurrent(id);
    sectionOf(id)?.scrollIntoView({ behavior: smooth && !reduced() ? "smooth" : "auto", block: "start" });
  };

  const choose = (id: string) => {
    jump(id);
    document.getElementById(`${base}-tab-${id}`)?.focus({ preventScroll: true });
  };

  // A deep link opens already scrolled to its section.
  useEffect(() => {
    if (!initial || initial === categories[0]?.id) return;
    pinned.current = true;
    sectionOf(initial)?.scrollIntoView({ behavior: "auto", block: "start" });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // The highlighted link follows the section at the top of the scrolling page.
  useEffect(() => {
    const box = scrollerOf(root.current);
    if (!box) return;
    const release = () => {
      pinned.current = false;
    };
    const spy = () => {
      if (pinned.current) return;
      const line = box.getBoundingClientRect().top + 96;
      let found = categories[0]?.id;
      for (const category of categories) {
        const el = sectionOf(category.id);
        if (el && el.getBoundingClientRect().top <= line) found = category.id;
      }
      if (box.scrollTop + box.clientHeight >= box.scrollHeight - 2) found = categories[categories.length - 1]?.id;
      setCurrent(found);
    };
    box.addEventListener("scroll", spy, { passive: true });
    for (const name of ["wheel", "touchstart", "pointerdown"]) box.addEventListener(name, release, { passive: true });
    return () => {
      box.removeEventListener("scroll", spy);
      for (const name of ["wheel", "touchstart", "pointerdown"]) box.removeEventListener(name, release);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [categories.map((category) => category.id).join("|")]);

  // A short last section can still be jumped to the top: the page ends with just enough room for it.
  useEffect(() => {
    const box = scrollerOf(root.current);
    const list = panes.current;
    if (!box || !list) return;
    const fit = () => {
      const last = list.lastElementChild as HTMLElement | null;
      if (!last) return;
      const pad = parseFloat(list.style.paddingBottom) || 0;
      const margin = parseFloat(getComputedStyle(last).scrollMarginTop) || 0;
      const top = last.getBoundingClientRect().top - box.getBoundingClientRect().top - box.clientTop + box.scrollTop;
      const below = box.scrollHeight - pad - top;
      const next = Math.max(0, Math.ceil(box.clientHeight - margin - below));
      if (next !== pad) list.style.paddingBottom = next ? `${next}px` : "";
    };
    const watch = new ResizeObserver(fit);
    watch.observe(box);
    watch.observe(list);
    return () => watch.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [categories.map((category) => category.id).join("|")]);

  const onKey = (event: KeyboardEvent, index: number) => {
    const step = event.key === "ArrowDown" || event.key === "ArrowRight" ? 1 : event.key === "ArrowUp" || event.key === "ArrowLeft" ? -1 : 0;
    if (!step) return;
    event.preventDefault();
    choose(categories[(index + step + categories.length) % categories.length].id);
  };

  return (
    <div className="set-shell" ref={root}>
      <div className="set-grid">
        <nav className="set-nav" aria-label={label}>
          {categories.map((category, index) => (
            <div key={category.id} className="set-nav-item">
              {category.group && <p className="set-nav-group">{category.group}</p>}
              <button
                type="button"
                id={`${base}-tab-${category.id}`}
                className="set-nav-link"
                title={category.label}
                aria-current={current === category.id ? "location" : undefined}
                tabIndex={current === category.id ? 0 : -1}
                onClick={() => choose(category.id)}
                onKeyDown={(event) => onKey(event, index)}
              >
                {category.icon}
                <span className="set-nav-label">{category.label}</span>
              </button>
            </div>
          ))}
        </nav>

        <div className="set-panes" ref={panes}>
          {categories.map((category) => (
            <section key={category.id} id={`${base}-pane-${category.id}`} className="set-pane" aria-labelledby={`${base}-head-${category.id}`}>
              <h2 id={`${base}-head-${category.id}`} className="set-sec-title">
                {category.icon}
                {category.label}
              </h2>
              {category.content}
            </section>
          ))}
        </div>
      </div>
    </div>
  );
}
