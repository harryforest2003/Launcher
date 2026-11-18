import { useEffect, useRef } from "react";
import { useTheme } from "./runtime.ts";
import "./reading.css";

/*
 * Settings > Reading > Reading guide: a band that follows the pointer to keep your place in a
 * line of text, either tinted ("line") or with everything else dimmed ("focus"). It never takes
 * a click, and hides when the pointer leaves the window. Also brings in reading.css, which the
 * font and spacing choices need, so it is always mounted.
 */
export default function ReadingGuide() {
  const { settings } = useTheme();
  const band = useRef<HTMLDivElement>(null);
  const on = settings.guide !== "off";

  useEffect(() => {
    if (!on) return;
    let frame = 0;
    let y = 0;
    const show = (shown: boolean) => {
      if (band.current) band.current.dataset.shown = String(shown);
    };
    const move = (event: PointerEvent) => {
      y = event.clientY;
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        band.current?.style.setProperty("--guide-y", `${y}px`);
        show(true);
      });
    };
    const leave = () => show(false);
    window.addEventListener("pointermove", move, { passive: true });
    document.documentElement.addEventListener("pointerleave", leave);
    window.addEventListener("blur", leave);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("pointermove", move);
      document.documentElement.removeEventListener("pointerleave", leave);
      window.removeEventListener("blur", leave);
    };
  }, [on]);

  if (!on) return null;
  return <div ref={band} className={`reading-guide reading-guide--${settings.guide}`} data-shown="false" aria-hidden="true" />;
}
