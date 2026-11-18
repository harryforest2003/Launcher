import { useEffect, useState } from "react";
import { ChevronDown, ChevronUp, GripVertical } from "lucide-react";
import IconButton from "../../components/IconButton";
import Toggle from "../../components/Toggle";
import { errorText, note, panel, smallButton } from "./shared";

type Props = { detail: GameDetail };

type Kind = GameModOrder["kind"];

/* How each game reads its order, said once at the top of the page. */
const ABOUT: Record<Kind, string> = {
  modlist:
    "Archive mods load top to bottom, and the first one wins where two change the same thing. Without a list the game goes by file name. Changes apply the next time the game starts.",
  rimworld:
    "Mods load top to bottom, and a later one wins where two change the same thing. Each must load after the mods it needs. Changes apply the next time RimWorld starts.",
  bg3: "Mods load top to bottom, and a later one wins where two change the same thing. The game's own modules always load first. Changes apply the next time the game starts.",
};

const MISSING: Record<Kind, string> = {
  modlist: "",
  rimworld: "RimWorld makes its mod list the first time it starts. Start it once, then come back.",
  bg3: "Baldur's Gate 3 makes its mod list the first time it starts. Start it once, then come back.",
};

/*
 * The mod order of the games that aren't Bethesda's but where it matters: Cyberpunk 2077's
 * archive mods (modlist.txt), RimWorld's mod list and Baldur's Gate 3's. Drag mods (or use
 * the arrows); RimWorld also turns them on and off, and Fix order puts each after what it needs.
 */
export default function ModOrderPage({ detail }: Props) {
  const [order, setOrder] = useState<GameModOrder | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [dragging, setDragging] = useState<number | null>(null);
  const [over, setOver] = useState<number | null>(null);
  const [fixedNow, setFixedNow] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    window.gamesAPI
      .modOrder(detail.id)
      .then((found) => active && setOrder(found))
      .catch((err) => active && setError(errorText(err)));
    return () => {
      active = false;
    };
  }, [detail.id]);

  if (!detail.found) return <div style={note("warn")}>{detail.name} wasn't found, so its mod order can't be shown. Choose its folder in Settings.</div>;

  const on = order?.entries.filter((e) => e.active) ?? [];
  const off = order?.entries.filter((e) => !e.active) ?? [];
  // The game's own stay at the top; the rest move below them.
  const pinned = on.findIndex((e) => !e.fixed) < 0 ? on.length : on.findIndex((e) => !e.fixed);

  async function write(entries: GameOrderEntry[]) {
    setOrder((now) => (now ? { ...now, entries } : now));
    setFixedNow(null);
    try {
      setOrder(await window.gamesAPI.setModOrder(detail.id, entries.map((e) => ({ id: e.id, active: e.active }))));
      setError(null);
    } catch (err) {
      setError(errorText(err));
      window.gamesAPI.modOrder(detail.id).then(setOrder, () => {});
    }
  }

  const move = (from: number, to: number) => {
    if (from === to || to < pinned || to >= on.length || on[from].fixed) return;
    const next = [...on];
    const [item] = next.splice(from, 1);
    next.splice(to, 0, item);
    write([...next, ...off]);
  };

  // Turning one on puts it at the end; turning one off takes it out of the order.
  const toggle = (entry: GameOrderEntry, active: boolean) =>
    write(active ? [...on, { ...entry, active: true }, ...off.filter((e) => e !== entry)] : [...on.filter((e) => e !== entry), { ...entry, active: false }, ...off]);

  async function fix() {
    try {
      const result = await window.gamesAPI.fixModOrder(detail.id);
      setOrder(result);
      const done = result.done;
      const parts = [done?.turnOn.length ? `turned on ${done.turnOn.join(", ")}` : "", done?.moved ? `moved ${done.moved} mod${done.moved === 1 ? "" : "s"}` : ""].filter(Boolean);
      setFixedNow(parts.length ? `Fixed: ${parts.join(", and ")}.` : null);
      setError(null);
    } catch (err) {
      setError(errorText(err));
    }
  }

  const problems = on.filter((e) => e.problems.length).length;
  const canFix = Boolean(order && (order.fix.turnOn.length || order.fix.moved));
  const kind = order?.kind ?? null;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <h1 style={{ margin: 0 }}>Load Order</h1>
      {kind && <div style={{ color: "var(--color-text-muted)", fontSize: 13, lineHeight: 1.5 }}>{ABOUT[kind]}</div>}
      {error && <div style={note("bad")}>{error}</div>}
      {fixedNow && <div style={note("good")}>{fixedNow}</div>}

      {order && kind && !order.file && MISSING[kind] && <div style={note("warn")}>{MISSING[kind]}</div>}

      {order && order.toggles && order.file && on.length > 0 && (
        <div style={{ ...panel, display: "flex", alignItems: "center", gap: 12 }} data-testid="mod-order-summary">
          <span style={{ flex: 1, fontSize: 13, lineHeight: 1.5, color: problems ? "var(--color-warning-text)" : "var(--color-success-text)" }}>
            {problems
              ? `${problems} mod${problems === 1 ? " has a problem" : "s have problems"}.${
                  canFix
                    ? ` Fixing ${[order.fix.turnOn.length ? `turns on ${order.fix.turnOn.join(", ")}` : "", order.fix.moved ? `moves ${order.fix.moved} mod${order.fix.moved === 1 ? "" : "s"} after what ${order.fix.moved === 1 ? "it needs" : "they need"}` : ""].filter(Boolean).join(" and ")}.`
                    : ""
                }`
              : `${on.length} mod${on.length === 1 ? "" : "s"} on, all in an order that works.`}
          </span>
          {canFix && (
            <button className="sidebar-button" data-testid="fix-mod-order" style={{ ...smallButton, background: "var(--color-accent)", color: "var(--color-on-accent)", borderColor: "var(--color-accent-line)", flexShrink: 0 }} onClick={fix}>
              Fix load order
            </button>
          )}
        </div>
      )}

      <div style={{ display: "flex", flexDirection: "column", gap: 6 }} data-testid="mod-order">
        {!order ? (
          !error && <div style={{ color: "var(--color-text-muted)" }}>Loading...</div>
        ) : order.entries.length === 0 ? (
          (order.file || kind === "modlist") && <div style={{ color: "var(--color-text-muted)", padding: 20, textAlign: "center" }}>No mods yet.</div>
        ) : (
          on.map((entry, index) => {
            const movable = !entry.fixed;
            return (
              <div
                key={entry.id}
                data-testid="mod-order-row"
                draggable={movable}
                onDragStart={(event) => {
                  setDragging(index);
                  event.dataTransfer.effectAllowed = "move";
                }}
                onDragOver={(event) => {
                  if (dragging === null || index < pinned) return;
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
                  background: "var(--color-surface)",
                  border: `1px solid ${over === index && dragging !== null && dragging !== index ? "var(--color-accent-line)" : entry.problems.length ? "var(--color-warning-border)" : "var(--color-border)"}`,
                  borderRadius: 10,
                  opacity: dragging === index ? 0.5 : 1,
                }}
              >
                <span style={{ color: "var(--color-text-muted)", cursor: movable ? "grab" : "default", display: "flex", visibility: movable ? "visible" : "hidden" }} aria-hidden="true">
                  <GripVertical size={18} />
                </span>
                <span style={{ color: "var(--color-text-muted)", fontSize: 12, width: 28, textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{index + 1}</span>
                {order.toggles && <Toggle on label={`Turn off ${entry.name}`} disabled={entry.fixed} onChange={() => toggle(entry, false)} />}
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
                    <span style={{ color: "var(--color-accent-text)", fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{entry.name}</span>
                    {entry.fixed && <span style={{ fontSize: 10, padding: "1px 6px", borderRadius: 5, background: "var(--color-info-bg)", color: "var(--color-info-text)", flexShrink: 0 }}>The game's own</span>}
                  </div>
                  {entry.note && entry.note !== entry.name && (
                    <div style={{ color: "var(--color-text-muted)", fontSize: 11, marginTop: 2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{entry.note}</div>
                  )}
                  {entry.problems.map((problem) => (
                    <div key={problem} style={{ color: "var(--color-warning-text)", fontSize: 12, marginTop: 2 }}>
                      {problem}
                    </div>
                  ))}
                </div>
                {movable && (
                  <>
                    <IconButton tip="Load earlier" label={`Move ${entry.name} up`} disabled={index <= pinned} style={{ width: 34, height: 34 }} onClick={() => move(index, index - 1)}>
                      <ChevronUp size={16} />
                    </IconButton>
                    <IconButton tip="Load later" label={`Move ${entry.name} down`} disabled={index === on.length - 1} style={{ width: 34, height: 34 }} onClick={() => move(index, index + 1)}>
                      <ChevronDown size={16} />
                    </IconButton>
                  </>
                )}
              </div>
            );
          })
        )}
      </div>

      {order && order.toggles && off.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }} data-testid="mod-order-off">
          <div style={{ fontSize: 12, color: "var(--color-text-muted)", marginTop: 4 }}>Installed, turned off</div>
          {off.map((entry) => (
            <div
              key={entry.id}
              data-testid="mod-order-off-row"
              style={{ display: "flex", alignItems: "center", gap: 12, padding: "8px 12px", background: "var(--color-surface)", border: "1px solid var(--color-border)", borderRadius: 10, opacity: 0.75 }}
            >
              <Toggle on={false} label={`Turn on ${entry.name}`} disabled={!order.file} onChange={() => toggle(entry, true)} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ color: "var(--color-text-muted)", fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{entry.name}</div>
                {entry.note && entry.note !== entry.name && <div style={{ color: "var(--color-text-muted)", fontSize: 11, marginTop: 2 }}>{entry.note}</div>}
              </div>
            </div>
          ))}
        </div>
      )}

      {order?.file && <div style={{ fontSize: 11, color: "var(--color-text-muted)", overflowWrap: "anywhere" }}>Saved in {order.file}</div>}
    </div>
  );
}
