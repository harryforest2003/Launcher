import type { ReactNode } from "react";
import "./ui.css";

type Props = {
  icon?: ReactNode;
  title: string;
  /** One or two sentences: why it's empty and what to do. */
  body?: ReactNode;
  /** The way forward: a Button or two. */
  actions?: ReactNode;
  /** compact: for a card or a narrow column. */
  size?: "md" | "compact";
};

/* Nothing here yet, said plainly, with the next step. */
export default function EmptyState({ icon, title, body, actions, size = "md" }: Props) {
  return (
    <div className={`ui-empty${size === "compact" ? " ui-empty--compact" : ""}`}>
      {icon && <div className="ui-empty__icon" aria-hidden="true">{icon}</div>}
      <div className="ui-empty__title">{title}</div>
      {body && <div className="ui-empty__body">{body}</div>}
      {actions && <div className="ui-empty__actions">{actions}</div>}
    </div>
  );
}
