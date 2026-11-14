import type { HTMLAttributes, ReactNode } from "react";
import "./ui.css";

type Props = Omit<HTMLAttributes<HTMLElement>, "title"> & {
  title?: ReactNode;
  /** One or two sentences under the title saying what the panel is for. */
  lead?: ReactNode;
  /** sunken: set into the page (a well), for groups inside another panel. */
  tone?: "raised" | "sunken";
  as?: "section" | "div";
};

/* A tonal panel with the launcher's cut top-right corner. Use for a group of related things. */
export default function Panel({ title, lead, tone = "raised", as: Tag = "section", className, children, ...rest }: Props) {
  const classes = ["ui-panel", tone === "sunken" && "ui-panel--sunken", className].filter(Boolean).join(" ");
  return (
    <Tag className={classes} {...rest}>
      {title && <h2 className="ui-panel__title">{title}</h2>}
      {lead && <p className="ui-panel__lead">{lead}</p>}
      {children}
    </Tag>
  );
}
