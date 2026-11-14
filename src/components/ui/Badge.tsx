import type { HTMLAttributes } from "react";
import "./ui.css";

export type Tone = "neutral" | "accent" | "success" | "warning" | "danger" | "info";

type Props = HTMLAttributes<HTMLSpanElement> & { tone?: Tone };

/* A short status label: "Up to date", "Needs a key", "3 updates". Words carry the meaning;
   the colour only backs them up. */
export default function Badge({ tone = "neutral", className, ...rest }: Props) {
  const classes = ["ui-badge", tone !== "neutral" && `ui-badge--${tone}`, className].filter(Boolean).join(" ");
  return <span className={classes} {...rest} />;
}
