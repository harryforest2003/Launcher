import { useEffect, useState } from "react";
import { ListOrdered } from "lucide-react";
import { Button } from "../../components/ui";
import { errorText, fixNeeded, fixSentence, useIssueReport, type IssueReport, type Say } from "./shared";

type Props = {
  detail: GameDetail;
  /* The mods as listed: when they change, the load order is looked at again. */
  mods: GameMod[];
  goLoadOrder: () => void;
  /* Gets missing masters, as Update all gets updates. */
  onGetRequirements: (entries: GameRequirement[]) => void;
  report?: IssueReport;
  say?: Say;
};

/* On the Mods page of the Bethesda games: the plugin load order's problems, and fixing them in one go. */
export default function LoadOrderNotice({ detail, mods, goLoadOrder, onGetRequirements, report, say }: Props) {
  const [order, setOrder] = useState<GameLoadOrder | null>(null);

  useEffect(() => {
    if (detail.loadOrder !== "plugins" || !detail.found) return;
    let active = true;
    window.gamesAPI
      .loadOrder(detail.id)
      .then((found) => active && setOrder(found))
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [detail.id, detail.loadOrder, detail.found, mods]);

  const needed = Boolean(order && fixNeeded(order.fix));
  useIssueReport(report, "Load order", needed ? 1 : 0, "warning");

  async function fix() {
    try {
      const result = await window.gamesAPI.fixLoadOrder(detail.id);
      setOrder(result);
      say?.({ tone: "good", text: `Load order fixed: ${fixSentence(result.done, true).replace(/^./, (c) => c.toLowerCase())}` });
      if (result.done.get.length) onGetRequirements(result.done.get);
    } catch (err) {
      say?.({ tone: "bad", text: errorText(err) });
    }
  }

  if (!order || !fixNeeded(order.fix)) return null;
  const problems = order.plugins.filter((p) => p.problems.length).length;

  return (
    <section className="gm-issue gm-issue--warning" data-testid="load-order-notice">
      <div className="gm-issue__head">
        <ListOrdered size={16} className="gm-issue__icon" aria-hidden="true" />
        <span className="gm-issue__text">
          Your load order has {problems === 1 ? "a problem" : `${problems} problems`} that can stop the game starting or make it crash.{" "}
          {fixSentence(order.fix).replace(/^./, (c) => `Fixing ${c.toLowerCase()}`)}
        </span>
        <div className="gm-issue__actions">
          <Button size="sm" onClick={goLoadOrder}>
            See it
          </Button>
          <Button size="sm" variant="primary" data-testid="fix-load-order" onClick={fix}>
            Fix load order
          </Button>
        </div>
      </div>
    </section>
  );
}
