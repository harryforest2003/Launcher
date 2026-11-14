/* Words and numbers for charts: play time, days, ticks. */

/** "3 h 20 min", "45 min", "under a minute". `short` gives "3h 20m" for tight spots. */
export function formatDuration(seconds: number, short = false): string {
  const s = Math.max(0, Math.round(seconds));
  if (s === 0) return short ? "0m" : "0 min";
  if (s < 60) return short ? "<1m" : "under a minute";
  const minutes = Math.round(s / 60);
  if (minutes < 60) return short ? `${minutes}m` : `${minutes} min`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h >= 100 || m === 0) return short ? `${h}h` : `${h.toLocaleString()} h`;
  return short ? `${h}h ${m}m` : `${h} h ${m} min`;
}

/** Hours with one decimal for big headline numbers: "12.5 h". Under an hour: minutes. */
export function formatHours(seconds: number): string {
  if (seconds < 3600) return formatDuration(seconds);
  const h = seconds / 3600;
  return `${h >= 100 ? Math.round(h).toLocaleString() : h.toFixed(1).replace(/\.0$/, "")} h`;
}

const DAY = new Intl.DateTimeFormat(undefined, { day: "numeric", month: "short" });
const WEEKDAY = new Intl.DateTimeFormat(undefined, { weekday: "short", day: "numeric", month: "short" });

/** A YYYY-MM-DD local day as "4 Nov" (or "Tue 4 Nov" with the weekday). */
export function formatDay(day: string, withWeekday = false): string {
  const [y, m, d] = day.split("-").map(Number);
  const date = new Date(y, (m ?? 1) - 1, d ?? 1);
  return (withWeekday ? WEEKDAY : DAY).format(date);
}

/* Steps a time axis may use, in seconds: 5 min up to 50 h. */
const DURATION_STEPS = [300, 600, 900, 1800, 3600, 7200, 10800, 18000, 36000, 72000, 180000];

/** Clean ticks for a time axis from 0 to at least `max` seconds, about `count` of them. */
export function durationTicks(max: number, count = 3): number[] {
  const want = Math.max(max, 1) / count;
  const step = DURATION_STEPS.find((s) => s >= want) ?? DURATION_STEPS[DURATION_STEPS.length - 1];
  const ticks: number[] = [];
  for (let t = 0; t <= Math.max(max, step) + 0.001; t += step) ticks.push(t);
  if (ticks[ticks.length - 1] < max) ticks.push(ticks[ticks.length - 1] + step);
  return ticks;
}

/** A tick label for a time axis: "0", "30m", "2h". */
export function formatTick(seconds: number): string {
  if (seconds === 0) return "0";
  if (seconds < 3600) return `${Math.round(seconds / 60)}m`;
  return `${+(seconds / 3600).toFixed(1)}h`;
}

/** Share of a whole as "42%" ("<1%" for a sliver). */
export function formatShare(part: number, whole: number): string {
  if (!whole) return "0%";
  const p = (part / whole) * 100;
  if (p > 0 && p < 1) return "<1%";
  return `${Math.round(p)}%`;
}
