import { useMemo, useState } from "react";
import { Clock3 } from "lucide-react";
import { Segmented } from "../../components/ui";
import {
  BarChart,
  DonutChart,
  LineChart,
  MAX_SERIES,
  OTHER_COLOR,
  durationTicks,
  formatDay,
  formatDuration,
  formatHours,
  formatShare,
  formatTick,
  useSeriesColors,
} from "../../components/charts";
import { timeAgo } from "../playedAgo";
import "./dashboard.css";

import type { Range, StatsPart } from "./range";

const RANGES: { value: Range; label: string }[] = [
  { value: "7", label: "7 days" },
  { value: "30", label: "30 days" },
  { value: "90", label: "90 days" },
  { value: "all", label: "All time" },
];

const sum = (values: number[]) => values.reduce((n, v) => n + v, 0);


type Props = {
  stats: DashboardStats | null;
  loading: boolean;
  failed?: boolean;
  games?: { name: string; colour: string }[];
  /** The time range, shared by every card on the page (the buttons are on the trend card). */
  range: Range;
  onRange: (range: Range) => void;
  /** Which cards to draw here, so the page can place them in different columns. */
  show: StatsPart[];
  /** Opens an instance's page (or the Library) when a bar is chosen. */
  onInstance?: (name: string) => void;
};

/* Which real sources fed the play time, in words. (World statistics never do: see worldNote.) */
function sourceWords(sources: DashboardStats["sources"]) {
  const parts = [
    sources.tracked && "games started from here",
    sources.logs && "the game's own logs",
  ].filter(Boolean) as string[];
  if (!parts.length) return null;
  return parts.join(" and ");
}

/*
 * The play time cards: a trend over the chosen range, the most played instances, and how play
 * time splits between them. The range buttons scope all three, and every number comes from
 * window.dashboardAPI.stats(); where nothing is known it says so instead of showing 0.
 * Returns three grid items for the dashboard's grid to place.
 */
export default function PlayStats({
  stats,
  loading,
  failed = false,
  games,
  range,
  onRange,
  show,
  onInstance,
}: Props) {
  const colors = useSeriesColors();

  const daily = useMemo(() => stats?.daily ?? [], [stats]);
  const days = useMemo(() => range === "all" ? daily : daily.slice(-Number(range)), [daily, range]);
  const hasDaily = daily.length > 0 && daily.some((d) => d.seconds > 0);
  const total = stats?.totals.playSeconds ?? null;
  const anything = hasDaily || (total !== null && total > 0);

  const last7 = sum(daily.slice(-7).map((d) => d.seconds));
  const last30 = sum(daily.slice(-30).map((d) => d.seconds));
  const inRange = sum(days.map((d) => d.seconds));

  // Play time per instance over the range ("All time" uses each instance's own total).
  const perInstance = useMemo(() => {
    const list = (stats?.instances ?? []).map((i) => ({
      name: i.name,
      seconds:
        range === "all"
          ? i.playSeconds
          : sum(days.map((d) => d.byInstance[i.name] ?? 0)),
      sessions: i.sessions,
    }));
    return list
      .filter(
        (i): i is { name: string; seconds: number; sessions: number } =>
          i.seconds !== null && i.seconds > 0,
      )
      .sort((a, b) => b.seconds - a.seconds);
  }, [stats, range, days]);

  const unknown = (stats?.instances ?? []).filter(
    (i) => i.playSeconds === null,
  ).length;
  const rangeWords = range === "all" ? "all time" : `the last ${range} days`;

  // Stable name order keeps refreshed playtime totals from changing instance colours.
  const identity = useMemo(() => {
    const overall = [...(stats?.instances ?? [])].sort(
      (a, b) => a.name.localeCompare(b.name),
    );
    const map = new Map<string, string>();
    overall.slice(0, MAX_SERIES).forEach((i, n) => map.set(i.name, colors[n]));
    return map;
  }, [stats, colors]);

  const slices = useMemo(() => {
    const named = perInstance.filter((i) => identity.has(i.name));
    const rest = perInstance.filter((i) => !identity.has(i.name));
    const list = named.map((i) => ({
      id: i.name,
      label: i.name,
      value: i.seconds,
      valueLabel: formatDuration(i.seconds),
      color: identity.get(i.name)!,
    }));
    const other = sum(rest.map((i) => i.seconds));
    if (other > 0)
      list.push({
        id: "__other",
        label: rest.length === 1 ? rest[0].name : `${rest.length} others`,
        value: other,
        valueLabel: formatDuration(other),
        color: OTHER_COLOR,
      });
    return list;
  }, [perInstance, identity]);

  // Under each bar: the days it was played in the range (or its sessions in all), and when last.
  const subFor = (name: string) => {
    const stat = stats?.instances.find((i) => i.name === name);
    const playedDays = days.filter((d) => (d.byInstance[name] ?? 0) > 0).length;
    const count =
      range === "all"
        ? stat?.sessions
          ? `${stat.sessions} ${stat.sessions === 1 ? "session" : "sessions"}`
          : ""
        : `played on ${playedDays} ${playedDays === 1 ? "day" : "days"}`;
    const last = stat?.lastPlayed
      ? `last played ${timeAgo(stat.lastPlayed)}`
      : "";
    return [count, last].filter(Boolean).join(", ");
  };

  const sources = stats ? sourceWords(stats.sources) : null;
  const [hidden, setHidden] = useState<string[]>([]);
  const chartSeries = games
    ? [{ id: "Minecraft", color: colors[0], values: days.map((day) => day.seconds) }]
    : (stats?.instances ?? []).filter((instance) => daily.some((day) => day.byInstance[instance.name] > 0))
        .map(({ name }, i) => ({
          id: name,
          color: identity.get(name) ?? `hsl(${(i * 137.508) % 360} 75% 65%)`,
          values: days.map((day) => day.byInstance[name] ?? 0),
        }));
  const visibleSeries = chartSeries.filter((line) => !hidden.includes(line.id));
  const ticks = durationTicks(visibleSeries.reduce((max, line) => Math.max(max, ...line.values), 0));
  const average = days.length ? inRange / days.length : 0;

  const empty = (title: string, text: string) => (
    <div className="db-empty">
      <Clock3 size={20} aria-hidden="true" />
      <strong>{title}</strong>
      <span>{text}</span>
    </div>
  );

  const loadingNote = (
    <div className="db-empty db-empty--quiet">Adding up your play time...</div>
  );

  return (
    <>
      {show.includes("trend") && (
        <section className="db-card db-trend" aria-labelledby="db-trend-title">
          <header className="db-card__head">
            <h2 className="db-card__title" id="db-trend-title">
              {games ? "Launcher play time" : "Minecraft play time"}
            </h2>
            <Segmented
              label="Time range"
              value={range}
              options={RANGES}
              onChange={onRange}
            />
          </header>

          <dl className="db-kpis">
            <div>
              <dt>{games ? "Recorded total" : "Total"}</dt>
              <dd>
                {total !== null ? (
                  formatHours(total)
                ) : (
                  <span className="db-unknown">Not known yet</span>
                )}
              </dd>
            </div>
            <div>
              <dt>Last 7 days</dt>
              <dd>
                {hasDaily ? (
                  formatHours(last7)
                ) : (
                  <span className="db-unknown">None yet</span>
                )}
              </dd>
            </div>
            <div>
              <dt>Last 30 days</dt>
              <dd>
                {hasDaily ? (
                  formatHours(last30)
                ) : (
                  <span className="db-unknown">None yet</span>
                )}
              </dd>
            </div>
            <div>
              <dt>Daily average</dt>
              <dd>
                {hasDaily ? (
                  formatDuration(average)
                ) : (
                  <span className="db-unknown">None yet</span>
                )}
              </dd>
            </div>
          </dl>

          {!loading && (games || chartSeries.length > 0) && (
            <div className="db-series" aria-label="Chart legend">
              {chartSeries.map((line) => games ? (
                <span key={line.id}><i style={{ background: line.color }} />{line.id}</span>
              ) : (
                <button type="button" key={line.id} aria-pressed={!hidden.includes(line.id)} onClick={() =>
                  setHidden((current) => current.includes(line.id) ? current.filter((id) => id !== line.id) : [...current, line.id])
                }><i style={{ background: line.color }} />{line.id}</button>
              ))}
              {games?.map((game) => <span key={game.name}><i style={{ background: game.colour }} />{game.name} · unavailable</span>)}
            </div>
          )}

          {loading ? (
            loadingNote
          ) : failed ? (
            empty("Play time unavailable", "The launcher could not read your statistics. Return to this window to retry.")
          ) : hasDaily && visibleSeries.length ? (
            <div
              className={`db-trend__chart${range === "all" ? " is-all" : ""}`}
            >
              <LineChart
                points={days.map((d) => ({ x: d.date, y: d.seconds }))}
                series={visibleSeries}
                ticks={ticks}
                formatTick={formatTick}
                formatX={(x) => formatDay(x)}
                label={`Play time per day, ${range === "all" ? "last 90 days" : rangeWords}`}
                height={132}
                animationKey={range}
                describe={(p, i) => ({
                  title: formatDay(p.x, true),
                  rows: visibleSeries.map((line) => ({
                    key: line.id,
                    label: line.id,
                    color: line.color,
                    value: formatDuration(line.values[i]),
                  })),
                })}
              />
            </div>
          ) : (
            empty(
              hasDaily ? "No series selected" : "No play time yet",
              hasDaily ? "Select an instance in the legend to show its play time." : "Recorded Minecraft sessions will appear here.",
            )
          )}

          <p className="db-card__note">
            {range === "all" && hasDaily
              ? "The chart shows the last 90 days. "
              : ""}
            {sources
              ? `Play time from ${sources}${stats?.since ? `, since ${formatDay(stats.since)} ${stats.since.slice(0, 4)}` : ""}.`
              : "Counted from the next game you start here."}
            {stats?.totals.worldPlaySeconds
              ? ` Separately, your worlds' own statistics record ${formatHours(stats.totals.worldPlaySeconds)}, which can include play from before they came into this launcher.`
              : ""}
          </p>
        </section>
      )}

      {show.includes("most") && (
        <section className="db-card db-most" aria-labelledby="db-most-title">
          <header className="db-card__head">
            <h2 className="db-card__title" id="db-most-title">
              {games ? "Most played games" : "Most played instances"}
            </h2>
            <span className="db-card__meta">{rangeWords}</span>
          </header>
          {loading ? (
            loadingNote
          ) : games ? (
            total !== null && (range === "all" ? total : inRange) > 0
              ? <BarChart label="Recorded play time by game" items={[{
                  id: "minecraft", label: "Minecraft", value: range === "all" ? total : inRange,
                  valueLabel: formatDuration(range === "all" ? total : inRange),
                }]} />
              : empty("No recorded play time", "Try a longer date range or play Minecraft from the launcher.")
          ) : perInstance.length ? (
            <BarChart
              label={`Play time per instance, ${rangeWords}`}
              items={perInstance
                .slice(0, 5)
                .map((i) => ({
                  id: i.name,
                  label: i.name,
                  value: i.seconds,
                  valueLabel: formatDuration(i.seconds),
                  sub: subFor(i.name),
                }))}
              describe={(item) => [
                {
                  key: "share",
                  label: "of the time in range",
                  value: formatShare(
                    item.value,
                    range === "all" ? sum(perInstance.map((i) => i.seconds)) : inRange,
                  ),
                },
              ]}
              onSelect={onInstance ? (item) => onInstance(item.id) : undefined}
            />
          ) : (
            empty(
              anything
                ? "Nothing played in this range"
                : "Nothing to compare yet",
              anything
                ? "Pick a longer range to see more."
                : "Your instances line up here once you've played them.",
            )
          )}
          {!games && unknown > 0 && anything && (
            <p className="db-card__note">
              {unknown === 1 ? "1 instance has" : `${unknown} instances have`}{" "}
              no play time on record yet.
            </p>
          )}
        </section>
      )}

      {show.includes("share") && (
        <section className="db-card db-share" aria-labelledby="db-share-title">
          <header className="db-card__head">
            <h2 className="db-card__title" id="db-share-title">
              Where the time went
            </h2>
            <span className="db-card__meta">{rangeWords}</span>
          </header>
          {loading ? (
            loadingNote
          ) : slices.length ? (
            <DonutChart
              slices={slices}
              center={formatHours(sum(slices.map((s) => s.value)))}
              centerLabel={range === "all" ? "in all" : `in ${range} days`}
              label={`How play time splits between instances, ${rangeWords}`}
              formatShare={formatShare}
            />
          ) : (
            empty(
              "No split to show yet",
              "Once you've played, this shows how your time divides between instances.",
            )
          )}
        </section>
      )}
    </>
  );
}
