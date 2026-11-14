import type { ButtonHTMLAttributes, ReactNode } from "react";
import { ArrowLeft } from "lucide-react";
import logoMark from "../../assets/logo-mark.png";
import Monogram from "./Monogram";
import "./ui.css";

/*
 * The pieces every sidebar is built from, so the launcher's, Minecraft's and each game's
 * sidebars read as one system:
 *
 *   <Sidebar label="Minecraft">
 *     <SidebarExit onClick={...}>Back to Launcher</SidebarExit>
 *     <SidebarSection name="Minecraft" sub="Java Edition" />
 *     <SidebarNav label="Minecraft pages">
 *       <NavItem icon={<House size={16} />} label="Home" current onClick={...} />
 *       <NavGroup> ... </NavGroup>
 *     </SidebarNav>
 *     <SidebarFooter> account, Settings </SidebarFooter>
 *   </Sidebar>
 *
 * The wordmark sits on one line at the top; the current page has the accent rail; the footer
 * (account, Settings) stays at the bottom in the normal flow, so nothing overlaps.
 */

export function Sidebar({ label, children }: { label: string; children: ReactNode }) {
  return (
    <aside className="ui-sidebar" aria-label={label} data-testid="sidebar">
      <SidebarBrand />
      {children}
    </aside>
  );
}

/** The logo and "Unity Launcher" on one line. */
export function SidebarBrand() {
  return (
    <div className="ui-sidebar__brand">
      <img className="ui-sidebar__mark" src={logoMark} alt="" draggable={false} />
      <span className="ui-sidebar__wordmark">Unity Launcher</span>
    </div>
  );
}

/** Leaves this game's section for the launcher. One per sidebar, at the top. */
export function SidebarExit({ children, ...rest }: ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button type="button" className="ui-sidebar__exit" {...rest}>
      <ArrowLeft size={16} aria-hidden="true" />
      <span>{children}</span>
    </button>
  );
}

/** Which game's section this is: its tile and name. */
export function SidebarSection({ name, sub }: { name: string; sub?: ReactNode }) {
  return (
    <div className="ui-sidebar__section">
      <Monogram name={name || "?"} size={36} />
      <div className="ui-sidebar__section-text">
        <div className="ui-sidebar__section-name">{name || " "}</div>
        {sub && <div className="ui-sidebar__section-sub">{sub}</div>}
      </div>
    </div>
  );
}

export function SidebarNav({ label, children }: { label: string; children: ReactNode }) {
  return (
    <nav className="ui-sidebar__nav" aria-label={label}>
      {children}
    </nav>
  );
}

/** A run of related nav items; groups are set apart by space, not labels. */
export function NavGroup({ children }: { children: ReactNode }) {
  return <div className="ui-nav-group">{children}</div>;
}

/** Account and Settings, at the bottom of the sidebar. */
export function SidebarFooter({ children }: { children: ReactNode }) {
  return <div className="ui-sidebar__footer">{children}</div>;
}

type NavItemProps = Omit<ButtonHTMLAttributes<HTMLButtonElement>, "children"> & {
  label: string;
  /** A 16px icon (lucide-react). */
  icon?: ReactNode;
  /** This is the page on screen. */
  current?: boolean;
  /** The page on screen is inside this one (a mod's page inside Discover). */
  parent?: boolean;
  /** At the end of the row: a count ("3") drawn as an accent tag, or any element as it is
      (a <Badge tone="warning">2 updates</Badge>, say). */
  badge?: ReactNode;
  /** Not ready yet: says why on hover and when pressed, and does nothing else. */
  soon?: string;
};

/** A page in the sidebar: icon, label, and the accent rail when it's the current page. */
export function NavItem({ label, icon, current = false, parent = false, badge, soon, className, onClick, ...rest }: NavItemProps) {
  const classes = ["ui-nav-item", parent && !current && "is-parent", soon && "is-soon", className].filter(Boolean).join(" ");
  return (
    <button
      type="button"
      className={classes}
      aria-current={current ? "page" : parent ? "true" : undefined}
      aria-disabled={soon ? true : undefined}
      data-tip={soon}
      onClick={soon ? undefined : onClick}
      {...rest}
    >
      {icon && <span className="ui-nav-item__icon">{icon}</span>}
      <span className="ui-nav-item__label">{label}</span>
      {soon ? (
        <span className="ui-nav-item__soon">Soon</span>
      ) : typeof badge === "string" || typeof badge === "number" ? (
        <span className="ui-nav-item__badge">{badge}</span>
      ) : (
        badge
      )}
    </button>
  );
}

/** Back out of something opened inside the current page (a mod's page back to the results),
    drawn under that page's nav item so it's clear what it goes back to. */
export function NavBack({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button type="button" className="ui-nav-back" onClick={onClick}>
      <ArrowLeft size={14} aria-hidden="true" />
      <span>{label}</span>
    </button>
  );
}
