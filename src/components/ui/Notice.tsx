import type { HTMLAttributes, ReactNode } from "react";
import { CircleCheck, CircleX, Info, TriangleAlert } from "lucide-react";
import "./ui.css";

type Props = HTMLAttributes<HTMLDivElement> & {
  tone?: "info" | "success" | "warning" | "danger";
  /** Buttons that fix the problem, shown at the end of the line. */
  actions?: ReactNode;
};

const ICONS = { info: Info, success: CircleCheck, warning: TriangleAlert, danger: CircleX };

/* A one-line message in the flow of the page: what happened and how to fix it. Errors use
   role="alert" so screen readers announce them; the rest are polite. */
export default function Notice({ tone = "info", actions, className, children, ...rest }: Props) {
  const Icon = ICONS[tone];
  return (
    <div
      role={tone === "danger" ? "alert" : "status"}
      className={["ui-notice", `ui-notice--${tone}`, className].filter(Boolean).join(" ")}
      {...rest}
    >
      <Icon className="ui-notice__icon" size={16} aria-hidden="true" />
      <div style={{ flex: 1, minWidth: 0 }}>{children}</div>
      {actions}
    </div>
  );
}
