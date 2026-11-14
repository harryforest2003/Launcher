import type { ButtonHTMLAttributes, ReactNode } from "react";
import "./ui.css";

type Props = ButtonHTMLAttributes<HTMLButtonElement> & {
  /** primary: the one main action on a screen (solid accent). secondary: everyday actions.
      ghost: low-key actions in toolbars and rows. danger: something that can't be undone. */
  variant?: "primary" | "secondary" | "ghost" | "danger";
  size?: "sm" | "md" | "lg";
  /** An icon before the label (a lucide-react icon, say). Icon-only buttons need aria-label. */
  icon?: ReactNode;
};

/* The launcher's button. Defaults to type="button" so it never submits a form by accident. */
export default function Button({ variant = "secondary", size = "md", icon, className, children, type = "button", ...rest }: Props) {
  const classes = ["ui-button", `ui-button--${variant}`, size !== "md" && `ui-button--${size}`, className].filter(Boolean).join(" ");
  return (
    <button type={type} className={classes} {...rest}>
      {icon}
      {children}
    </button>
  );
}
