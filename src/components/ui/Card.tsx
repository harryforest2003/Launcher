import type { HTMLAttributes, ReactNode } from "react";
import "./ui.css";

type Props = Omit<HTMLAttributes<HTMLElement>, "title"> & {
  /** A heading in the card's top row. */
  title?: ReactNode;
  /** Small muted text beside the title (a count, a date). */
  meta?: ReactNode;
  /** Controls at the end of the top row ("See all", a menu). */
  actions?: ReactNode;
  /** Lifts a little on hover: for cards that open something (give it onClick and a role/tabIndex, or wrap a button). */
  interactive?: boolean;
  /** Inner padding: md 16px (default), sm 12px, none (media cards). */
  padding?: "md" | "sm" | "none";
  as?: "section" | "div" | "article" | "li";
};

/*
 * The launcher's card: a translucent, layered surface with a hairline edge, for dashboard
 * tiles, instances, mods and groups of settings. Panel is the same look with a title and lead.
 */
export default function Card({ title, meta, actions, interactive, padding = "md", as: Tag = "div", className, children, ...rest }: Props) {
  const classes = ["ui-card", interactive && "ui-card--interactive", padding !== "md" && `ui-card--pad-${padding}`, className].filter(Boolean).join(" ");
  return (
    <Tag className={classes} {...rest}>
      {(title || actions || meta) && (
        <div className="ui-card__head">
          {title && <h3 className="ui-card__title">{title}</h3>}
          {meta && <span className="ui-card__meta">{meta}</span>}
          {actions && <div className="ui-card__actions">{actions}</div>}
        </div>
      )}
      {children}
    </Tag>
  );
}
