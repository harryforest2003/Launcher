/* Charts for the whole launcher: plain SVG and HTML on the theme's tokens, no libraries.
   Styles: ./charts.css. Colours: ./colors.ts (accent for one series, a checked identity set
   for more). Words for numbers: ./format.ts. */
export { default as LineChart, type LinePoint } from "./LineChart";
export { default as BarChart, type BarItem } from "./BarChart";
export { default as DonutChart, type DonutSlice } from "./DonutChart";
export { default as Sparkline } from "./Sparkline";
export { default as ChartTooltip, type TooltipRow } from "./ChartTooltip";
export { MAX_SERIES, OTHER_COLOR, SERIES_ACCENT, identityColors, useSeriesColors } from "./colors";
export { durationTicks, formatDay, formatDuration, formatHours, formatShare, formatTick } from "./format";
