import { useEffect, useRef, useState } from "react";
import "./ui.css";

export type IndexEntry = { id: string; label: string; sub?: boolean };

type Props = {
  label: string;
  entries: IndexEntry[];
  /** The scrolling element the sections are in (defaults to the window). */
  scroller?: HTMLElement | null;
};

/*
 * A page's table of contents, down its left side. Clicking an entry scrolls its section into
 * view and moves keyboard focus there; the entry for the section on screen is marked.
 */
export default function SectionIndex({ label, entries, scroller }: Props) {
  const [current, setCurrent] = useState(entries[0]?.id);

  // The section on screen is the last one whose top has passed a line a third of the way down.
  // A click pins its entry until the scroll it started settles, so the mark doesn't flicker.
  const pinnedUntil = useRef(0);

  useEffect(() => {
    const target: HTMLElement | Window = scroller ?? window;
    let frame = 0;
    const update = () => {
      frame = 0;
      if (Date.now() < pinnedUntil.current) return;
      const top = scroller ? scroller.getBoundingClientRect().top : 0;
      const height = scroller ? scroller.clientHeight : window.innerHeight;
      const line = top + height / 3;
      let found = entries[0]?.id;
      for (const entry of entries) {
        const el = document.getElementById(entry.id);
        if (el && el.getBoundingClientRect().top <= line) found = entry.id;
      }
      setCurrent(found);
    };
    const onScroll = () => {
      if (!frame) frame = requestAnimationFrame(update);
    };
    target.addEventListener("scroll", onScroll, { passive: true });
    update();
    return () => {
      target.removeEventListener("scroll", onScroll);
      cancelAnimationFrame(frame);
    };
  }, [entries, scroller]);

  return (
    <nav aria-label={label} className="ui-index-nav">
      <ul className="ui-index">
        {entries.map((entry) => (
          <li key={entry.id}>
            <a
              href={`#${entry.id}`}
              className={`ui-index__link${entry.sub ? " ui-index__link--sub" : ""}`}
              aria-current={current === entry.id ? "location" : undefined}
              onClick={(event) => {
                event.preventDefault();
                const target = document.getElementById(entry.id);
                if (!target) return;
                setCurrent(entry.id);
                pinnedUntil.current = Date.now() + 900;
                target.scrollIntoView({ behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth", block: "start" });
                if (!target.hasAttribute("tabindex")) target.setAttribute("tabindex", "-1");
                target.focus({ preventScroll: true });
              }}
            >
              {entry.label}
            </a>
          </li>
        ))}
      </ul>
    </nav>
  );
}
