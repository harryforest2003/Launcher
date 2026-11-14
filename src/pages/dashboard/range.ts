export type Range = "7" | "30" | "90" | "all";
export type StatsPart = "trend" | "most" | "share";

/* The range to open on: 30 days when that has a week's worth of play days, else 90 days when
   there is any play in it, else 30 (which then says there's nothing yet). */
export function defaultRange(stats: DashboardStats | null): Range {
  const daily = stats?.daily ?? [];
  const played = (n: number) =>
    daily.slice(-n).filter((d) => d.seconds > 0).length;
  if (played(30) >= 5) return "30";
  if (played(90) > 0) return "90";
  return "30";
}
