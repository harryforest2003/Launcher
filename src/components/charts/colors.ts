import { useMemo } from "react";
import { oklchToHex } from "../../theme/color";
import { useTheme } from "../../theme/runtime";

/*
 * Chart colours.
 *
 * A chart with one series (a trend line, bars ranking instances) wears the theme's accent line,
 * so it follows whatever colour the user picks: use SERIES_ACCENT.
 *
 * A chart that tells things apart by colour (a donut's slices) needs hues that stay apart for
 * every reader, colour-blind ones too, on any theme. Hues turned from the user's colour can't
 * promise that (some picks put two slices on the same red-green line), so identity uses one
 * fixed, checked set: blue, orange, aqua. They are data colours, stepped for each scheme, and
 * were run through the dataviz validator (all pairs, colour-blind and normal vision) against
 * the surface of 234 theme picks in each scheme: every one passes. Three named series at most;
 * the rest fold into "Other", which is a neutral, never a fourth hue. On light themes they sit
 * under 3:1 on the surface, so charts using them always show a legend with the values.
 *
 * Stored as OKLCH numbers (lightness, chroma, hue) and turned into colours at run time.
 */
const IDENTITY: Record<"dark" | "light", [number, number, number][]> = {
  dark: [
    [0.622, 0.161, 255.1],
    [0.622, 0.173, 40.1],
    [0.621, 0.128, 163.1],
  ],
  light: [
    [0.575, 0.163, 255.5],
    [0.671, 0.175, 40.6],
    [0.669, 0.141, 162.1],
  ],
};

export const MAX_SERIES = 3;

/** The theme's accent line: the colour of every single-series chart. */
export const SERIES_ACCENT = "var(--color-accent-line)";

/** What "Other" (everything past the named series) wears. */
export const OTHER_COLOR = "var(--color-border-strong)";

export function identityColors(scheme: "dark" | "light"): string[] {
  return IDENTITY[scheme].map(([l, c, h]) => oklchToHex({ l, c, h }));
}

/** The identity colours for the scheme on screen (light or dark); they change with it, live. */
export function useSeriesColors() {
  const { palette } = useTheme();
  return useMemo(() => identityColors(palette.scheme), [palette.scheme]);
}
