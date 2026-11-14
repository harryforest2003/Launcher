import { useEffect, useId, useRef, useState, type CSSProperties, type KeyboardEvent, type ReactNode } from "react";
import "./ui.css";

export type MenuItem =
  | { label: string; icon?: ReactNode; onSelect: () => void; danger?: boolean; disabled?: boolean }
  | "separator";

type Props = {
  /** The button that opens it: its content (icon and/or words). */
  trigger: ReactNode;
  /** Its name for screen readers (needed when the trigger is only an icon). */
  label: string;
  items: MenuItem[];
  /** Which edge of the trigger the menu lines up with. */
  align?: "start" | "end";
  triggerClassName?: string;
  /** Laid over the page, so a card or panel that hides what overflows it doesn't cut it off. Closes on scroll. */
  floating?: boolean;
};

/*
 * A drop-down menu of actions (the "more" menu at the end of a row). Arrow keys move, Enter
 * picks, Escape or a click outside closes it and focus returns to the button.
 */
export default function Menu({ trigger, label, items, align = "end", triggerClassName, floating = false }: Props) {
  const [open, setOpen] = useState(false);
  // Where a floating list goes: under the button, lined up with the same edge.
  const [place, setPlace] = useState<CSSProperties | undefined>(undefined);
  const id = useId();
  const box = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const refs = useRef<(HTMLButtonElement | null)[]>([]);

  useEffect(() => {
    if (!open) return;
    refs.current.find((el) => el && !el.disabled)?.focus({ preventScroll: floating });
    const away = (event: PointerEvent) => {
      if (!box.current?.contains(event.target as Node)) setOpen(false);
    };
    // A floating list would stay put while its button scrolls away.
    const shut = () => setOpen(false);
    document.addEventListener("pointerdown", away);
    if (floating) {
      window.addEventListener("scroll", shut, true);
      window.addEventListener("resize", shut);
    }
    return () => {
      document.removeEventListener("pointerdown", away);
      window.removeEventListener("scroll", shut, true);
      window.removeEventListener("resize", shut);
    };
  }, [open, floating]);

  const close = () => {
    setOpen(false);
    button.current?.focus();
  };

  const onKeyDown = (event: KeyboardEvent) => {
    const enabled = refs.current.filter((el): el is HTMLButtonElement => Boolean(el && !el.disabled));
    const at = enabled.indexOf(document.activeElement as HTMLButtonElement);
    if (event.key === "Escape") {
      event.preventDefault();
      close();
    } else if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      const step = event.key === "ArrowDown" ? 1 : -1;
      enabled[(at + step + enabled.length) % enabled.length]?.focus();
    } else if (event.key === "Home" || event.key === "End") {
      event.preventDefault();
      enabled[event.key === "Home" ? 0 : enabled.length - 1]?.focus();
    } else if (event.key === "Tab") {
      setOpen(false);
    }
  };

  return (
    <div className="ui-menu" ref={box}>
      <button
        ref={button}
        type="button"
        className={triggerClassName ?? "ui-menu__trigger"}
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? id : undefined}
        onClick={() => {
          const r = button.current?.getBoundingClientRect();
          if (floating && r && !open) {
            const edge = align === "end" ? { right: window.innerWidth - r.right, left: "auto" } : { left: r.left, right: "auto" };
            setPlace({ position: "fixed", top: r.bottom + 4, ...edge });
          }
          setOpen((now) => !now);
        }}
      >
        {trigger}
      </button>
      {open && (
        <div id={id} role="menu" aria-label={label} className={`ui-menu__list ui-menu__list--${align}`} style={floating ? place : undefined} onKeyDown={onKeyDown}>
          {items.map((item, index) =>
            item === "separator" ? (
              <div key={`sep-${index}`} role="separator" className="ui-menu__sep" />
            ) : (
              <button
                key={item.label}
                ref={(el) => {
                  refs.current[index] = el;
                }}
                type="button"
                role="menuitem"
                disabled={item.disabled}
                className={`ui-menu__item${item.danger ? " ui-menu__item--danger" : ""}`}
                onClick={() => {
                  close();
                  item.onSelect();
                }}
              >
                {item.icon && <span className="ui-menu__icon">{item.icon}</span>}
                {item.label}
              </button>
            )
          )}
        </div>
      )}
    </div>
  );
}
