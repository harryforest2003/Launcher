import type { CSSProperties } from "react";
import "./ui.css";

type Props = {
  width?: CSSProperties["width"];
  height?: CSSProperties["height"];
  /** A run of text lines (the last one shorter). */
  lines?: number;
  /** text (default), block (a picture or card), circle (an avatar). */
  shape?: "text" | "block" | "circle";
  className?: string;
};

/* A grey stand-in, gently shimmering, while something loads, in the shape of what's coming. */
export default function Skeleton({ width, height, lines, shape = "text", className }: Props) {
  if (lines && lines > 1) {
    return (
      <span className={["ui-skeleton-lines", className].filter(Boolean).join(" ")} aria-hidden="true">
        {Array.from({ length: lines }, (_, i) => (
          <span key={i} className="ui-skeleton ui-skeleton--text" style={{ width: i === lines - 1 ? "60%" : width ?? "100%" }} />
        ))}
      </span>
    );
  }
  return <span aria-hidden="true" className={["ui-skeleton", `ui-skeleton--${shape}`, className].filter(Boolean).join(" ")} style={{ width, height }} />;
}
