import type { CSSProperties, HTMLAttributes, ReactNode } from "react";
import { initials } from "./initials";
import "./ui.css";

type Props = Omit<HTMLAttributes<HTMLSpanElement>, "children"> & {
  /** What it stands for: "Minecraft", "All the Mods 9", "GTA V". */
  name: string;
  /** Side length in px (default 32). The letters scale with it. */
  size?: number;
  /** Shown instead of the letters (an icon for "nobody yet", say). */
  icon?: ReactNode;
};

/*
 * The first letter(s) of a name on an accent tile with the cut corner: the stand-in picture
 * for anything without art of its own (an instance, a game, a mod with no icon). Decorative,
 * so it is hidden from screen readers; the name is always written beside it.
 */
export default function Monogram({ name, size = 32, icon, className, style, ...rest }: Props) {
  const letters = initials(name);
  const scale = letters.length > 2 ? 0.34 : letters.length > 1 ? 0.4 : 0.5;
  const sized: CSSProperties = { width: size, height: size, fontSize: Math.round(size * scale), ...style };
  return (
    <span aria-hidden="true" className={["ui-monogram", className].filter(Boolean).join(" ")} style={sized} {...rest}>
      {icon ?? letters}
    </span>
  );
}
