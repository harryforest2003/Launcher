import { useEffect, useRef, useState } from "react";

/* The rendered width of an element, kept up to date, so charts draw at their real size
   (text stays its own size instead of scaling with a viewBox). */
export function useWidth<T extends HTMLElement>(fallback = 480) {
  const ref = useRef<T | null>(null);
  const [width, setWidth] = useState(fallback);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const observer = new ResizeObserver((entries) => {
      const w = Math.round(entries[0]?.contentRect.width ?? 0);
      if (w > 0) setWidth(w);
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  return [ref, width] as const;
}
