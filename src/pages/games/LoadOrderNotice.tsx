import { useEffect, useState } from "react";
import { ListOrdered } from "lucide-react";
import { errorText, fixNeeded, fixSentence, note, smallButton } from "./shared";

type Props = {
  detail: GameDetail;
  /* The mods as listed: when they change, the load order is looked at again. */
  mods: GameMod[];
  goLoadOrder: () => void;
  /* Gets missing masters, as Update all gets updates. */
  onGetRequirements: (entries: GameRequirement[]) => void;
};

/* On the Mods page of Skyrim and Fallout 4: the load order's problems, and fixing them in one go. */
export default function LoadOrderNotice({ detail, mods, goLoadOrder, onGetRequirements }: Props) {
  const [order, setOrder] = useState<GameLoadOrder | null>(null);
  const [said, setSaid] = useState<{ tone: "good" | "bad"; text: string } | null>(null);

  useEffect(() => {
    if (!detail.loadOrder || !detail.found) return;
    let active = true;
    window.gamesAPI
      .loadOrder(detail.id)
      .then((found) => active && setOrder(found))
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [detail.id, detail.loadOrder, detail.found, mods]);

  async function fix() {
    try {
      const result = await window.gamesAPI.fixLoadOrder(detail.id);
      setOrder(result);
      setSaid({ tone: "good", text: `Load order fixed: ${fixSentence(result.done, true).replace(/^./, (c) => c.toLowerCase())}` });
      if (result.done.get.length) onGetRequirements(result.done.get);
    } catch (err) {
      setSaid({ tone: "bad", text: errorText(err) });
    }
  }

  if (said) {
    return (
      <div style={{ ...note(said.tone), display: "flex", gap: 12 }}>
        <span style={{ flex: 1 }}>{said.text}</span>
        <button onClick={() => setSaid(null)} aria-label="Dismiss" style={{ background: "none", border: "none", color: "inherit", cursor: "pointer", fontSize: 16 }}>
          ×
        </button>
      </div>
    );
  }
  if (!order || !fixNeeded(order.fix)) return null;
  const problems = order.plugins.filter((p) => p.problems.length).length;

  return (
    <div style={{ ...note("warn"), display: "flex", alignItems: "center", gap: 12 }} data-testid="load-order-notice">
      <ListOrdered size={18} style={{ flexShrink: 0 }} />
      <span style={{ flex: 1 }}>
        Your load order has {problems === 1 ? "a problem" : `${problems} problems`} that can stop the game starting or make it crash.{" "}
        {fixSentence(order.fix).replace(/^./, (c) => `Fixing ${c.toLowerCase()}`)}
      </span>
      <button className="sidebar-button" style={{ ...smallButton, padding: "6px 12px", fontSize: 12, flexShrink: 0 }} onClick={goLoadOrder}>
        See it
      </button>
      <button
        className="sidebar-button"
        data-testid="fix-load-order"
        style={{ ...smallButton, padding: "6px 12px", fontSize: 12, background: "#7c3aed", borderColor: "#a78bfa", color: "white", flexShrink: 0 }}
        onClick={fix}
      >
        Fix load order
      </button>
    </div>
  );
}
