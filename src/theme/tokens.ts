/*
 * Typed names for the design tokens in tokens.css, for inline styles:
 *
 *   import { color, space, radius, font } from "../theme/tokens";
 *   <p style={{ color: color.textMuted, fontSize: font.size.sm, marginTop: space[2] }}>
 *
 * Every value is a var(--...) reference, so it follows the colour the user picked, live.
 * Never write a colour literal in a component: pick the token for the job (theme-guide.md).
 */

const v = <T extends string>(name: T) => `var(--${name})` as const;

export const color = {
  /** The window's background. */
  bg: v("color-bg"),
  /** Sidebars, title bars, nav rails: the frame around the content. */
  chrome: v("color-chrome"),
  /** Panels and tiles that sit on the background. */
  surface: v("color-surface"),
  /** Menus, popovers, dialogs, tooltips, and a hovered filled control. */
  surfaceRaised: v("color-surface-raised"),
  /** Inputs, wells, code blocks, progress tracks: set into the surface. */
  surfaceSunken: v("color-surface-sunken"),
  /** Translucent layer for a transparent control being hovered (works on any surface). */
  hover: v("color-hover"),
  /** Translucent layer for a transparent control being pressed. */
  pressed: v("color-pressed"),
  /** Decorative lines: dividers, panel outlines. Never the only sign that something is a control. */
  border: v("color-border"),
  /** Outlines that identify a control: inputs, checkboxes, unselected toggles (3:1 or more). */
  borderStrong: v("color-border-strong"),
  text: v("color-text"),
  textSecondary: v("color-text-secondary"),
  /** Helper text, captions, placeholders, metadata. Still 4.5:1 everywhere. */
  textMuted: v("color-text-muted"),
  /** Disabled controls only. */
  textDisabled: v("color-text-disabled"),
  /** The one solid action colour (Play, Install, Save). Text on it: onAccent. */
  accent: v("color-accent"),
  accentHover: v("color-accent-hover"),
  accentPressed: v("color-accent-pressed"),
  onAccent: v("color-on-accent"),
  /** The accent as text or an icon on any surface: links, active tab labels, counts. */
  accentText: v("color-accent-text"),
  /** The accent as a line: selected outlines, rails, progress fills, slider tracks (3:1). */
  accentLine: v("color-accent-line"),
  /** Background of a selected row, tile or nav item. */
  accentSubtle: v("color-accent-subtle"),
  accentSubtleHover: v("color-accent-subtle-hover"),
  /** Translucent accent for glows only. Never behind text. */
  accentGlow: v("color-accent-glow"),
  focus: v("color-focus"),
  successText: v("color-success-text"),
  successBg: v("color-success-bg"),
  successBorder: v("color-success-border"),
  successSolid: v("color-success-solid"),
  successSolidHover: v("color-success-solid-hover"),
  onSuccess: v("color-on-success"),
  warningText: v("color-warning-text"),
  warningBg: v("color-warning-bg"),
  warningBorder: v("color-warning-border"),
  warningSolid: v("color-warning-solid"),
  warningSolidHover: v("color-warning-solid-hover"),
  onWarning: v("color-on-warning"),
  dangerText: v("color-danger-text"),
  dangerBg: v("color-danger-bg"),
  dangerBorder: v("color-danger-border"),
  dangerSolid: v("color-danger-solid"),
  dangerSolidHover: v("color-danger-solid-hover"),
  onDanger: v("color-on-danger"),
  infoText: v("color-info-text"),
  infoBg: v("color-info-bg"),
  infoBorder: v("color-info-border"),
  infoSolid: v("color-info-solid"),
  infoSolidHover: v("color-info-solid-hover"),
  onInfo: v("color-on-info"),
  /** Dims the app behind a dialog. */
  scrim: v("color-scrim"),
  shadow: v("color-shadow"),
} as const;

export const font = {
  ui: v("font-ui"),
  display: v("font-display"),
  body: v("font-body"),
  mono: v("font-mono"),
  size: {
    xs: v("font-size-xs"),
    sm: v("font-size-sm"),
    md: v("font-size-md"),
    lg: v("font-size-lg"),
    xl: v("font-size-xl"),
    "2xl": v("font-size-2xl"),
    "3xl": v("font-size-3xl"),
    "4xl": v("font-size-4xl"),
  },
  weight: {
    regular: v("weight-regular"),
    medium: v("weight-medium"),
    semibold: v("weight-semibold"),
    bold: v("weight-bold"),
  },
  leading: { tight: v("leading-tight"), normal: v("leading-normal"), relaxed: v("leading-relaxed") },
  tracking: { tight: v("tracking-tight"), normal: v("tracking-normal"), wide: v("tracking-wide") },
} as const;

export const space = {
  0.5: v("space-0-5"),
  1: v("space-1"),
  1.5: v("space-1-5"),
  2: v("space-2"),
  3: v("space-3"),
  4: v("space-4"),
  5: v("space-5"),
  6: v("space-6"),
  8: v("space-8"),
  10: v("space-10"),
  12: v("space-12"),
  16: v("space-16"),
} as const;

export const radius = {
  xs: v("radius-xs"),
  sm: v("radius-sm"),
  md: v("radius-md"),
  lg: v("radius-lg"),
  full: v("radius-full"),
} as const;

/**
 * The cut corner (top right bevelled off), as a style to spread into an inline style:
 * style={{ ...cut, background: color.surface }}. The .u-cut / .u-cut-lg classes do the same.
 * (cornerShape is newer than React's style types, hence the cast.)
 */
export const cut = { borderRadius: v("radius-cut"), cornerShape: v("corner-cut") } as unknown as React.CSSProperties;
export const cutLg = { borderRadius: v("radius-cut-lg"), cornerShape: v("corner-cut") } as unknown as React.CSSProperties;

export const size = {
  controlSm: v("control-sm"),
  controlMd: v("control-md"),
  controlLg: v("control-lg"),
  sidebar: v("sidebar-width"),
  pagePadding: v("page-padding"),
  contentMax: v("content-max"),
  readingMax: v("reading-max"),
  rail: v("rail-width"),
} as const;

export const shadow = {
  sm: v("shadow-sm"),
  md: v("shadow-md"),
  lg: v("shadow-lg"),
  glow: v("shadow-glow"),
  edge: v("edge-highlight"),
} as const;

export const motion = {
  instant: v("duration-instant"),
  fast: v("duration-fast"),
  base: v("duration-base"),
  slow: v("duration-slow"),
  easeOut: v("ease-out"),
  easeInOut: v("ease-in-out"),
  easeSnap: v("ease-snap"),
} as const;

export const z = {
  sticky: v("z-sticky"),
  dropdown: v("z-dropdown"),
  overlay: v("z-overlay"),
  modal: v("z-modal"),
  toast: v("z-toast"),
  tooltip: v("z-tooltip"),
} as const;

/** CSS filter that turns the violet logo artwork to the user's colour. */
export const logoFilter = v("logo-filter");
