import type { CSSProperties } from "react";

export const panelStyle: CSSProperties = {
  // A little see-through, like the cards on other pages, so the logo shows faintly behind.
  background: "var(--color-surface)",
  border: "1px solid var(--color-border)",
  borderRadius: 14,
  padding: 18,
};

export const fieldStyle: CSSProperties = {
  width: "100%",
  padding: "10px 12px",
  borderRadius: 10,
  border: "1px solid var(--color-border)",
  background: "var(--color-surface)",
  color: "var(--color-text)",
  fontSize: 14,
  boxSizing: "border-box",
};

export const CHECKERBOARD = "repeating-conic-gradient(var(--color-surface-raised) 0 25%, var(--color-surface-sunken) 0 50%) 0 0 / 16px 16px";
