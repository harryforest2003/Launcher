import { Puzzle } from "lucide-react";
import { Button } from "../../components/ui";
import { useIssueReport, type IssueReport } from "./shared";

type Props = {
  requirements: GameRequirement[] | null;
  getting: boolean;
  onGet: (entries: GameRequirement[]) => void;
  report?: IssueReport;
};

const SOURCE: Record<GameRequirement["kind"], string> = {
  nexus: "Nexus Mods",
  curseforge: "CurseForge",
  web: "its own site",
  search: "a search on Nexus Mods",
  master: "a search on Nexus Mods",
};

/*
 * What installed mods need that isn't there: frameworks (SKSE, Script Hook V, SMAPI…),
 * the requirements Nexus Mods and CurseForge list, SMAPI dependencies and missing
 * masters. Get all fetches the ones that can be told for sure, as Update all does.
 */
export default function RequirementsPanel({ requirements, getting, onGet, report }: Props) {
  useIssueReport(report, "Missing", requirements?.length ?? 0, "warning");
  if (!requirements?.length) return null;
  const sure = requirements.filter((entry) => entry.auto);

  return (
    <section className="gm-issue gm-issue--warning" data-testid="requirements">
      <div className="gm-issue__head">
        <Puzzle size={16} className="gm-issue__icon" aria-hidden="true" />
        <span className="gm-issue__text">
          {requirements.length === 1
            ? `${requirements[0].name} is needed by ${requirements[0].neededBy.join(", ") || "a mod"}, and isn't installed.`
            : `${requirements.length} things your mods need aren't installed.`}
        </span>
        {sure.length > 0 && (
          <div className="gm-issue__actions">
            <Button
              size="sm"
              variant="primary"
              data-testid="get-requirements"
              onClick={() => {
                if (!getting) onGet(sure);
              }}
            >
              {getting ? "Getting them..." : sure.length === 1 ? `Get ${sure[0].name}` : `Get all (${sure.length})`}
            </Button>
          </div>
        )}
      </div>
      <div className="gm-issue__list">
        {requirements.map((entry) => (
          <div key={entry.key} className="gm-issue__item">
            <div className="gm-issue__item-row">
              <div className="gm-issue__item-main">
                <div className="gm-issue__item-title gm-issue__item-title--warning">{entry.name}</div>
                <div className="gm-issue__item-text">
                  {entry.neededBy.length ? `Needed by ${entry.neededBy.join(", ")}` : "Needed by the mod being installed"} • from {SOURCE[entry.kind]}
                  {entry.kind === "search" || entry.kind === "master" ? " (it couldn't be told for sure which mod it is)" : ""}
                </div>
                {entry.note && <div className="gm-issue__item-note">{entry.note}</div>}
              </div>
              {/* With one, the button above already gets it. */}
              {!(requirements.length === 1 && entry.auto) && (
                <Button size="sm" onClick={() => onGet([entry])}>
                  {entry.kind === "search" || entry.kind === "master" ? "Search" : "Get"}
                </Button>
              )}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
