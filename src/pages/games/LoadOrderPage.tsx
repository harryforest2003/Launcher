import { useEffect, useState } from "react";
import { ChevronDown, ChevronUp, GripVertical } from "lucide-react";
import IconButton from "../../components/IconButton";
import Toggle from "../../components/Toggle";
import { errorText, fixNeeded, fixSentence, note, panel, smallButton } from "./shared";

type Props = { detail: GameDetail };

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
export default function LoadOrderPage({ detail }: Props) {
  const [order, setOrder] = useState<GameLoadOrder | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [dragging, setDragging] = useState<number | null>(null);
  const [over, setOver] = useState<number | null>(null);
  const [fixedNow, setFixedNow] = useState<string | null>(null);

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

  async function fix() {
    try {
      const result = await window.gamesAPI.fixLoadOrder(detail.id);
      setOrder(result);
      setFixedNow(fixNeeded(result.done) ? `Fixed: ${fixSentence(result.done, true)}` : null);
      setError(null);
    } catch (err) {
      setError(errorText(err));
    }
  }

  if (!detail.found) return <div style={note("warn")}>{detail.name} wasn't found, so its load order can't be shown. Choose its folder in Settings.</div>;

  const problems = order?.plugins.filter((p) => p.problems.length).length ?? 0;
  const canFix = fixNeeded(order?.fix);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <h1 style={{ color: "#c084fc", margin: 0 }}>Load Order</h1>
      <div style={{ color: "#9ca3af", fontSize: 13, lineHeight: 1.5 }}>
        Plugins load top to bottom, and a later one wins where two change the same thing. Each must load after the plugins it needs. Changes
        apply the next time the game starts.
      </div>
      {error && <div style={note("bad")}>{error}</div>}
      {fixedNow && <div style={note("good")}>{fixedNow}</div>}

      {order && (
        <div style={{ ...panel, display: "flex", alignItems: "center", gap: 12 }} data-testid="load-order-summary">
          <span style={{ flex: 1, fontSize: 13, lineHeight: 1.5, color: canFix ? "#fcd34d" : "#86efac" }}>
            {canFix
              ? `${problems} plugin${problems === 1 ? " has a problem" : "s have problems"}. ${fixSentence(order.fix).replace(/^./, (c) => `Fixing ${c.toLowerCase()}`)}`
              : `${order.plugins.filter((p) => p.active).length} plugins on, all in an order that works.`}
          </span>
          {canFix && (
            <button className="sidebar-button" data-testid="fix-order" style={{ ...smallButton, background: "#7c3aed", borderColor: "#a78bfa", flexShrink: 0 }} onClick={fix}>
              Fix load order
            </button>
          )}
        </div>
      )}

      {order && order.fixed.length > 0 && (
        <div style={{ fontSize: 12, color: "#6b7280" }}>Always loaded first, by the game: {order.fixed.join(", ")}</div>
      )}

      <div style={{ display: "flex", flexDirection: "column", gap: 6 }} data-testid="load-order">
        {!order ? (
          !error && <div style={{ color: "#9ca3af" }}>Loading...</div>
        ) : order.plugins.length === 0 ? (
          <div style={{ color: "#9ca3af", padding: 20, textAlign: "center" }}>No plugins yet besides the game's own.</div>
        ) : (
          order.plugins.map((plugin, index) => (
            <div
              key={plugin.name}
              data-testid="plugin-row"
              draggable
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
                gap: 12,
                padding: "8px 12px",
                background: "rgba(27, 27, 27, 0.92)",
                border: `1px solid ${over === index && dragging !== null && dragging !== index ? "#c084fc" : plugin.problems.length ? "#b45309" : "#2e2e2e"}`,
                borderRadius: 10,
                opacity: dragging === index ? 0.5 : plugin.active ? 1 : 0.65,
              }}
            >
              <span style={{ color: "#6b7280", cursor: "grab", display: "flex" }} aria-hidden="true">
                <GripVertical size={18} />
              </span>
              <span style={{ color: "#6b7280", fontSize: 12, width: 28, textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{index + 1}</span>
              <Toggle on={plugin.active} label={plugin.active ? `Turn off ${plugin.name}` : `Turn on ${plugin.name}`} onChange={(on) => write(order.plugins.map((p, i) => (i === index ? { ...p, active: on } : p)))} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <span style={{ color: plugin.active ? "#e9d5ff" : "#a1a1aa", fontWeight: 600 }}>{plugin.name}</span>
                  {plugin.master && <span data-tip="Loads before the plugins that aren't masters" style={{ fontSize: 10, padding: "1px 6px", borderRadius: 5, background: "#1e293b", color: "#93c5fd" }}>{plugin.light ? "Light master" : "Master"}</span>}
                  {!plugin.master && plugin.light && <span style={{ fontSize: 10, padding: "1px 6px", borderRadius: 5, background: "#1e293b", color: "#93c5fd" }}>Light</span>}
                </div>
                {plugin.problems.map((problem) => (
                  <div key={`${problem.kind}${problem.master}`} style={{ color: "#fcd34d", fontSize: 12, marginTop: 2 }}>
                    {PROBLEM[problem.kind](problem.master)}
                  </div>
                ))}
                {!plugin.problems.length && plugin.masters.length > 0 && (
                  <div style={{ color: "#6b7280", fontSize: 11, marginTop: 2 }}>Needs {plugin.masters.join(", ")}</div>
                )}
              </div>
              <IconButton tip="Load earlier" label={`Move ${plugin.name} up`} disabled={index === 0} style={{ width: 34, height: 34 }} onClick={() => move(index, index - 1)}>
                <ChevronUp size={16} />
              </IconButton>
              <IconButton tip="Load later" label={`Move ${plugin.name} down`} disabled={index === order.plugins.length - 1} style={{ width: 34, height: 34 }} onClick={() => move(index, index + 1)}>
                <ChevronDown size={16} />
              </IconButton>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
