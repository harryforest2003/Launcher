import { useEffect, useState } from "react";
import { ChevronDown, ChevronUp, GripVertical, Undo2 } from "lucide-react";
import IconButton from "../../components/IconButton";
import Toggle from "../../components/Toggle";
import { SearchField } from "../../components/ui";
import { errorText, fixNeeded, fixSentence, note, panel, smallButton } from "./shared";

type Props = {
  detail: GameDetail;
  /* Gets missing masters, as Update all gets updates. */
  onGetRequirements: (entries: GameRequirement[]) => void;
};

const PROBLEM: Record<GamePlugin["problems"][number]["kind"], (master: string) => string> = {
  missing: (master) => `Needs ${master}, which isn't installed`,
  off: (master) => `Needs ${master}, which is turned off`,
  after: (master) => `Needs ${master}, which loads after it`,
};

/*
 * Skyrim's and Fallout 4's load order: which plugins load, in what order. Drag them (or
 * use the arrows); anything that needs a plugin loaded before it, turned on, or installed
 * says so, and Fix order puts each after what it needs, changing as little as it can.
 */
export default function LoadOrderPage({ detail, onGetRequirements }: Props) {
  const [order, setOrder] = useState<GameLoadOrder | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [dragging, setDragging] = useState<number | null>(null);
  const [over, setOver] = useState<number | null>(null);
  const [fixedNow, setFixedNow] = useState<string | null>(null);
  // Sorting by LOOT's rules: what it would move (shown first), and the order before, for Undo.
  const [lootPlan, setLootPlan] = useState<{ moved: GameLootMove[]; loops: string[] } | null>(null);
  const [lootBusy, setLootBusy] = useState(false);
  const [filter, setFilter] = useState("");
  const [problemsOnly, setProblemsOnly] = useState(false);
  const [sorted, setSorted] = useState<{ count: number; previous: { name: string; active: boolean }[] } | null>(null);

  useEffect(() => {
    let active = true;
    window.gamesAPI
      .loadOrder(detail.id)
      .then((found) => active && setOrder(found))
      .catch((err) => active && setError(errorText(err)));
    return () => {
      active = false;
    };
  }, [detail.id]);

  async function write(plugins: GamePlugin[]) {
    setOrder((now) => (now ? { ...now, plugins } : now));
    try {
      setOrder(await window.gamesAPI.setLoadOrder(detail.id, plugins.map((p) => ({ name: p.name, active: p.active }))));
      setError(null);
    } catch (err) {
      setError(errorText(err));
    }
  }

  const move = (from: number, to: number) => {
    if (!order || from === to || to < 0 || to >= order.plugins.length) return;
    const next = [...order.plugins];
    const [item] = next.splice(from, 1);
    next.splice(to, 0, item);
    write(next);
  };

  async function previewLoot() {
    setLootBusy(true);
    setError(null);
    try {
      setLootPlan(await window.gamesAPI.lootPlan(detail.id));
    } catch (err) {
      setError(errorText(err));
    }
    setLootBusy(false);
  }

  async function sortLoot() {
    setLootBusy(true);
    try {
      const result = await window.gamesAPI.lootSort(detail.id);
      setOrder(result);
      setSorted({ count: result.moved.length, previous: result.previous });
      setLootPlan(null);
      setFixedNow(null);
    } catch (err) {
      setError(errorText(err));
    }
    setLootBusy(false);
  }

  async function undoSort() {
    if (!sorted) return;
    await write(sorted.previous.map((entry) => ({ ...order!.plugins.find((p) => p.name === entry.name)!, active: entry.active })).filter((p) => p.name));
    setSorted(null);
  }

  async function fix() {
    try {
      const result = await window.gamesAPI.fixLoadOrder(detail.id);
      setOrder(result);
      setFixedNow(fixNeeded(result.done) ? `Fixed: ${fixSentence(result.done, true)}` : null);
      setError(null);
      if (result.done.get.length) onGetRequirements(result.done.get);
    } catch (err) {
      setError(errorText(err));
    }
  }

  if (!detail.found) return <div style={note("warn")}>{detail.name} wasn't found, so its load order can't be shown. Choose its folder in Settings.</div>;

  const problems = order?.plugins.filter((p) => p.problems.length).length ?? 0;
  const canFix = fixNeeded(order?.fix);
  /* A long load order gets a filter. Rows keep their real place, so moving one still moves it in the whole order. */
  const needle = filter.trim().toLowerCase();
  const filtering = needle !== "" || problemsOnly;
  const rows = (order?.plugins ?? [])
    .map((plugin, index) => ({ plugin, index }))
    .filter(({ plugin }) => (!needle || plugin.name.toLowerCase().includes(needle) || plugin.masters.some((m) => m.toLowerCase().includes(needle))) && (!problemsOnly || plugin.problems.length > 0));

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <h1 style={{ margin: 0 }}>Load Order</h1>
      <div style={{ color: "var(--color-text-muted)", fontSize: 13, lineHeight: 1.5 }}>
        Plugins load top to bottom, and a later one wins where two change the same thing. Each must load after the plugins it needs. Changes
        apply the next time the game starts.
      </div>
      {error && <div style={note("bad")}>{error}</div>}
      {fixedNow && <div style={note("good")}>{fixedNow}</div>}

      {order && (
        <div style={{ ...panel, display: "flex", alignItems: "center", gap: 12 }} data-testid="load-order-summary">
          <span style={{ flex: 1, fontSize: 13, lineHeight: 1.5, color: canFix ? "var(--color-warning-text)" : "var(--color-success-text)" }}>
            {canFix
              ? `${problems} plugin${problems === 1 ? " has a problem" : "s have problems"}. ${fixSentence(order.fix).replace(/^./, (c) => `Fixing ${c.toLowerCase()}`)}`
              : `${order.plugins.filter((p) => p.active).length} plugins on, all in an order that works.`}
          </span>
          {canFix && (
            <button className="sidebar-button" data-testid="fix-order" style={{ ...smallButton, background: "var(--color-accent)", color: "var(--color-on-accent)", borderColor: "var(--color-accent-line)", flexShrink: 0 }} onClick={fix}>
              Fix load order
            </button>
          )}
        </div>
      )}

      {/* SORTING BY LOOT'S RULES */}
      {order && order.plugins.length > 1 && (
        <div style={{ ...panel, display: "flex", flexDirection: "column", gap: 10 }} data-testid="loot">
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <span style={{ flex: 1, fontSize: 13, lineHeight: 1.5, color: "var(--color-text-secondary)" }}>
              {sorted
                ? sorted.count
                  ? `Sorted by LOOT's rules: ${sorted.count} plugin${sorted.count === 1 ? "" : "s"} moved.`
                  : "Already in the order LOOT's rules give."
                : "Sort the way LOOT does: each plugin in its group (fixes early, overhauls and patches later) and after the plugins its rules name. Nothing it doesn't know about changes order."}
            </span>
            {sorted && sorted.count > 0 && (
              <button className="sidebar-button" data-testid="loot-undo" style={{ ...smallButton, display: "flex", alignItems: "center", gap: 6, flexShrink: 0 }} onClick={undoSort}>
                <Undo2 size={14} />
                Undo
              </button>
            )}
            {!lootPlan && !sorted && (
              <button className="sidebar-button" data-testid="loot-preview" style={{ ...smallButton, flexShrink: 0 }} onClick={previewLoot}>
                {lootBusy ? "Reading LOOT's rules..." : "Sort with LOOT's rules"}
              </button>
            )}
          </div>

          {lootPlan && (
            <div data-testid="loot-plan">
              {lootPlan.moved.length === 0 ? (
                <div style={{ fontSize: 13, color: "var(--color-success-text)" }}>Already in the order LOOT's rules give: nothing to move.</div>
              ) : (
                <>
                  <div style={{ fontSize: 13, color: "var(--color-accent-text)", marginBottom: 6 }}>
                    This moves {lootPlan.moved.length} plugin{lootPlan.moved.length === 1 ? "" : "s"}:
                  </div>
                  <div style={{ display: "flex", flexDirection: "column", gap: 3, maxHeight: 220, overflowY: "auto", marginBottom: 8 }}>
                    {lootPlan.moved.map((move) => (
                      <div key={move.name} style={{ fontSize: 12, color: "var(--color-text-secondary)" }}>
                        <b style={{ color: "var(--color-accent-text)", fontWeight: 600 }}>{move.name}</b>
                        <span style={{ color: "var(--color-text-muted)" }}>
                          {" — "}
                          {[move.group !== "default" ? `in LOOT's ${move.group} group` : "", move.after.length ? `after ${move.after.join(", ")}` : ""].filter(Boolean).join(", ") ||
                            "to make room for the others"}
                        </span>
                      </div>
                    ))}
                  </div>
                </>
              )}
              {lootPlan.loops.length > 0 && (
                <div style={{ fontSize: 12, color: "var(--color-warning-text)", marginBottom: 8 }}>
                  LOOT's rules contradict each other around {lootPlan.loops.join(", ")}, so {lootPlan.loops.length === 1 ? "it stays" : "they stay"} as near
                  as possible to where {lootPlan.loops.length === 1 ? "it is" : "they are"}.
                </div>
              )}
              <div style={{ display: "flex", gap: 10 }}>
                {lootPlan.moved.length > 0 && (
                  <button className="sidebar-button" data-testid="loot-sort" style={{ ...smallButton, background: "var(--color-accent)", color: "var(--color-on-accent)", borderColor: "var(--color-accent-line)" }} onClick={sortLoot}>
                    {lootBusy ? "Sorting..." : "Sort"}
                  </button>
                )}
                <button className="sidebar-button" style={smallButton} onClick={() => setLootPlan(null)}>
                  {lootPlan.moved.length ? "Cancel" : "Close"}
                </button>
              </div>
            </div>
          )}
          <div style={{ fontSize: 11, color: "var(--color-text-muted)" }}>
            Rules from{" "}
            <a
              href="https://loot.github.io"
              onClick={(event) => {
                event.preventDefault();
                window.open("https://loot.github.io", "_blank", "noopener");
              }}
              style={{ color: "var(--color-info-text)" }}
            >
              LOOT
            </a>
            's community masterlist, checked for changes once a day. LOOT also compares what plugins change, which this doesn't.
          </div>
        </div>
      )}

      {order && order.fixed.length > 0 && (
        <div style={{ fontSize: 12, color: "var(--color-text-muted)" }}>Always loaded first, by the game: {order.fixed.join(", ")}</div>
      )}

      {order && order.plugins.length > 8 && (
        <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
          <SearchField
            label="Filter plugins"
            placeholder="Filter plugins"
            value={filter}
            onChange={(event) => setFilter(event.target.value)}
            wrapperClassName="lo-filter"
            data-testid="load-order-filter"
          />
          {problems > 0 && (
            <button type="button" className="sidebar-button" aria-pressed={problemsOnly} style={{ ...smallButton, ...(problemsOnly ? { background: "var(--color-warning-bg)", color: "var(--color-warning-text)", borderColor: "var(--color-warning-border)" } : {}) }} onClick={() => setProblemsOnly((on) => !on)}>
              Problems only ({problems})
            </button>
          )}
          <span style={{ fontSize: 12, color: "var(--color-text-muted)" }} aria-live="polite">
            {filtering ? `${rows.length} of ${order.plugins.length} shown. Dragging is off while filtering; the arrows still move a plugin one place.` : `${order.plugins.length} plugins`}
          </span>
        </div>
      )}
      {filtering && rows.length === 0 && <div style={{ color: "var(--color-text-muted)", padding: 20, textAlign: "center" }}>No plugins match.</div>}

      <div style={{ display: "flex", flexDirection: "column", gap: 4 }} data-testid="load-order">
        {!order ? (
          !error && <div style={{ color: "var(--color-text-muted)" }}>Loading...</div>
        ) : order.plugins.length === 0 ? (
          <div style={{ color: "var(--color-text-muted)", padding: 20, textAlign: "center" }}>No plugins yet besides the game's own.</div>
        ) : (
          rows.map(({ plugin, index }) => (
            <div
              key={plugin.name}
              data-testid="plugin-row"
              draggable={!filtering}
              onDragStart={(event) => {
                setDragging(index);
                event.dataTransfer.effectAllowed = "move";
              }}
              onDragOver={(event) => {
                event.preventDefault();
                setOver(index);
              }}
              onDragLeave={() => setOver((now) => (now === index ? null : now))}
              onDrop={(event) => {
                event.preventDefault();
                if (dragging !== null) move(dragging, index);
                setDragging(null);
                setOver(null);
              }}
              onDragEnd={() => {
                setDragging(null);
                setOver(null);
              }}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 10,
                padding: "4px 10px",
                minHeight: 44,
                contentVisibility: "auto",
                containIntrinsicSize: "auto 46px",
                background: "var(--color-surface)",
                border: `1px solid ${over === index && dragging !== null && dragging !== index ? "var(--color-accent-line)" : plugin.problems.length ? "var(--color-warning-border)" : "var(--color-border)"}`,
                borderRadius: 8,
                opacity: dragging === index ? 0.5 : plugin.active ? 1 : 0.65,
              }}
            >
              <span style={{ color: "var(--color-text-muted)", cursor: filtering ? "default" : "grab", display: "flex", opacity: filtering ? 0.3 : 1 }} aria-hidden="true">
                <GripVertical size={18} />
              </span>
              <span style={{ color: "var(--color-text-muted)", fontSize: 12, width: 28, textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{index + 1}</span>
              <Toggle on={plugin.active} label={plugin.active ? `Turn off ${plugin.name}` : `Turn on ${plugin.name}`} onChange={(on) => write(order.plugins.map((p, i) => (i === index ? { ...p, active: on } : p)))} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <span style={{ color: plugin.active ? "var(--color-accent-text)" : "var(--color-text-muted)", fontWeight: 600 }}>{plugin.name}</span>
                  {plugin.master && <span data-tip="Loads before the plugins that aren't masters" style={{ fontSize: 10, padding: "1px 6px", borderRadius: 5, background: "var(--color-info-bg)", color: "var(--color-info-text)" }}>{plugin.light ? "Light master" : "Master"}</span>}
                  {!plugin.master && plugin.light && <span style={{ fontSize: 10, padding: "1px 6px", borderRadius: 5, background: "var(--color-info-bg)", color: "var(--color-info-text)" }}>Light</span>}
                </div>
                {plugin.problems.map((problem) => (
                  <div key={`${problem.kind}${problem.master}`} style={{ color: "var(--color-warning-text)", fontSize: 12, marginTop: 2 }}>
                    {PROBLEM[problem.kind](problem.master)}
                  </div>
                ))}
                {!plugin.problems.length && plugin.masters.length > 0 && (
                  <div style={{ color: "var(--color-text-muted)", fontSize: 11, marginTop: 2 }}>Needs {plugin.masters.join(", ")}</div>
                )}
              </div>
              <IconButton tip="Load earlier" label={`Move ${plugin.name} up`} disabled={index === 0} style={{ width: 30, height: 30 }} onClick={() => move(index, index - 1)}>
                <ChevronUp size={16} />
              </IconButton>
              <IconButton tip="Load later" label={`Move ${plugin.name} down`} disabled={index === order.plugins.length - 1} style={{ width: 30, height: 30 }} onClick={() => move(index, index + 1)}>
                <ChevronDown size={16} />
              </IconButton>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
