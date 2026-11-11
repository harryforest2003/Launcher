import type { CSSProperties } from "react";

export const panelStyle: CSSProperties = {
  // A little see-through, like the cards on other pages, so the logo shows faintly behind.
  background: "rgba(22, 22, 22, 0.85)",
  border: "1px solid #2b2140",
  borderRadius: 14,
  padding: 18,
};

export const fieldStyle: CSSProperties = {
  width: "100%",
  padding: "10px 12px",
  borderRadius: 10,
  border: "1px solid #6d28d9",
  background: "#1a1a1a",
  color: "white",
  fontSize: 14,
  boxSizing: "border-box",
};

export const CHECKERBOARD = "repeating-conic-gradient(#2a2a2a 0 25%, #1c1c1c 0 50%) 0 0 / 16px 16px";
