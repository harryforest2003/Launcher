import { useLayoutEffect, useRef } from "react";

const positions = new Map<string, number>();

/** Restore only after the page's content is available; keep positions in this session. */
export function useScrollMemory(key: string, ready = true) {
  const ref = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    const node = ref.current;
    if (!node || !ready) return;
    node.scrollTop = positions.get(key) ?? 0;
    const remember = () => positions.set(key, node.scrollTop);
    node.addEventListener("scroll", remember, { passive: true });
    return () => {
      remember();
      node.removeEventListener("scroll", remember);
    };
  }, [key, ready]);

  return ref;
}
