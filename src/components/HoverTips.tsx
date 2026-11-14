import { useEffect, useLayoutEffect, useRef, useState } from "react";
import "./ui/ui.css";

/*
 * What a button shown only as an icon does, in a small box just above the cursor while it's
 * over the button. It works for every such button in the app, from what the button already
 * says about itself: a data-tip, else its title or aria-label. A button with words on it
 * doesn't need one. Moving onto one with the keyboard (Tab) shows its tip too, above it;
 * Escape hides a tip. Mounted once, beside the app.
 */

const DELAY = 250; // ms of hovering before a tip shows...
const FOLLOW_ON = 400; // ...unless one was showing this recently, when it shows at once.
const TARGETS = "[data-tip], button, [role='button'], [role='switch'], a, [title]";

/* Only an icon, or a symbol like ×: nothing a person would read as words or a number. */
const iconOnly = (el: HTMLElement) => !/[\p{L}\p{N}]/u.test(el.innerText ?? el.textContent ?? "");

function tipFor(el: HTMLElement): string | null {
  if (el.dataset.tip) return el.dataset.tip;
  if (!iconOnly(el)) return null;
  return el.dataset.tipTitle || el.getAttribute("title") || el.getAttribute("aria-label") || null;
}

type Point = { x: number; y: number; below?: number };

/* Above the cursor (or the focused control), kept inside the window (below it, at the very top). */
function place(el: HTMLElement | null, { x, y, below }: Point) {
  if (!el) return;
  const { width, height } = el.getBoundingClientRect();
  const left = Math.min(Math.max(x - width / 2, 6), window.innerWidth - width - 6);
  const top = y - height - 14 >= 6 ? y - height - 14 : (below ?? y + 22);
  el.style.transform = `translate(${Math.round(left)}px, ${Math.round(top)}px)`;
}

export default function HoverTips() {
  const [text, setText] = useState<string | null>(null);
  const box = useRef<HTMLDivElement>(null);
  const cursor = useRef<Point>({ x: 0, y: 0 });

  useEffect(() => {
    let current: HTMLElement | null = null;
    let timer = 0;
    let lastShown = 0;

    // The browser's own tooltip would show as well, so a title is set aside while hovered.
    const release = () => {
      if (current?.dataset.tipTitle !== undefined) {
        current.setAttribute("title", current.dataset.tipTitle);
        delete current.dataset.tipTitle;
      }
      current = null;
    };

    const hide = () => {
      window.clearTimeout(timer);
      if (current) lastShown = Date.now();
      release();
      setText(null);
    };

    const take = (el: HTMLElement) => {
      current = el;
      if (el.hasAttribute("title")) {
        el.dataset.tipTitle = el.getAttribute("title") ?? "";
        el.removeAttribute("title");
      }
    };

    const over = (event: PointerEvent) => {
      const el = (event.target as Element | null)?.closest?.(TARGETS) as HTMLElement | null;
      if (el === current) return;
      hide();
      if (!el) return;
      const tip = tipFor(el);
      if (!tip) return;
      take(el);
      cursor.current = { x: event.clientX, y: event.clientY };
      const show = () => setText(tip);
      if (Date.now() - lastShown < FOLLOW_ON) show();
      else timer = window.setTimeout(show, DELAY);
    };

    // Pressed before the tip came up (an unavailable button says why): show it now.
    const press = () => {
      if (!current) return;
      window.clearTimeout(timer);
      const tip = tipFor(current);
      if (tip) setText(tip);
    };

    const move = (event: PointerEvent) => {
      cursor.current = { x: event.clientX, y: event.clientY };
      if (!current) return;
      // What it says can change while hovered (Reset asks to be clicked again).
      const tip = tipFor(current);
      if (tip === null) hide();
      else setText((shown) => (shown === null ? null : tip));
      place(box.current, cursor.current);
    };

    // Reached with the keyboard: the tip goes just above the control, straight away.
    const focus = (event: FocusEvent) => {
      const el = (event.target as Element | null)?.closest?.(TARGETS) as HTMLElement | null;
      if (!el || el === current || !el.matches(":focus-visible")) return;
      const tip = tipFor(el);
      if (!tip) return;
      hide();
      take(el);
      const box = el.getBoundingClientRect();
      cursor.current = { x: box.left + box.width / 2, y: box.top + 4, below: box.bottom + 8 };
      setText(tip);
    };

    const blur = (event: FocusEvent) => {
      if (event.target === current) hide();
    };

    const key = (event: KeyboardEvent) => {
      if (event.key === "Escape" && current) hide();
    };

    document.addEventListener("pointerover", over);
    document.addEventListener("focusin", focus);
    document.addEventListener("focusout", blur);
    document.addEventListener("keydown", key);
    document.addEventListener("pointermove", move);
    document.addEventListener("pointerdown", press);
    document.addEventListener("pointerleave", hide);
    window.addEventListener("blur", hide);
    window.addEventListener("scroll", hide, true);
    return () => {
      hide();
      document.removeEventListener("pointerover", over);
      document.removeEventListener("focusin", focus);
      document.removeEventListener("focusout", blur);
      document.removeEventListener("keydown", key);
      document.removeEventListener("pointermove", move);
      document.removeEventListener("pointerdown", press);
      document.removeEventListener("pointerleave", hide);
      window.removeEventListener("blur", hide);
      window.removeEventListener("scroll", hide, true);
    };
  }, []);

  // Placed before it's drawn, once it has a size; a new text can change its width.
  useLayoutEffect(() => {
    if (text) place(box.current, cursor.current);
  }, [text]);

  if (!text) return null;
  return (
    <div ref={box} role="tooltip" data-testid="hover-tip" className="ui-tip">
      {text}
    </div>
  );
}
