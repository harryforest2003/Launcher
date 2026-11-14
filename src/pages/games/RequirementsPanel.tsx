import { useState } from "react";
import { Puzzle } from "lucide-react";
import { note, smallButton } from "./shared";

type Props = {
  requirements: GameRequirement[] | null;
  getting: boolean;
  onGet: (entries: GameRequirement[]) => void;
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
export default function RequirementsPanel({ requirements, getting, onGet }: Props) {
  const [open, setOpen] = useState(false);
  if (!requirements?.length) return null;
  const sure = requirements.filter((entry) => entry.auto);

  return (
    <div style={note("warn")} data-testid="requirements">
      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
        <Puzzle size={18} style={{ flexShrink: 0 }} />
        <span style={{ flex: 1 }}>
          {requirements.length === 1
            ? `${requirements[0].name} is needed by ${requirements[0].neededBy.join(", ") || "a mod"}, and isn't installed.`
            : `${requirements.length} things your mods need aren't installed.`}
        </span>
        {requirements.length > 1 && (
          <button className="sidebar-button" style={{ ...smallButton, padding: "6px 12px", fontSize: 12 }} onClick={() => setOpen((now) => !now)}>
            {open ? "Hide" : "Show them"}
          </button>
        )}
        {sure.length > 0 && (
          <button
            className="sidebar-button"
            data-testid="get-requirements"
            style={{ ...smallButton, padding: "6px 12px", fontSize: 12, background: "var(--color-accent)", color: "var(--color-on-accent)", borderColor: "var(--color-accent-line)" }}
            onClick={() => {
              if (!getting) onGet(sure);
            }}
          >
            {getting ? "Getting them..." : sure.length === 1 ? `Get ${sure[0].name}` : `Get all (${sure.length})`}
          </button>
        )}
      </div>

      {(open || requirements.length === 1) && (
        <div style={{ display: "flex", flexDirection: "column", gap: 6, marginTop: 10 }}>
          {requirements.map((entry) => (
            <div key={entry.key} style={{ display: "flex", alignItems: "center", gap: 12, padding: "8px 10px", background: "var(--color-hover)", borderRadius: 8 }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ color: "var(--color-warning-text)", fontWeight: 600 }}>{entry.name}</div>
                <div style={{ color: "var(--color-text-secondary)", fontSize: 12, marginTop: 2 }}>
                  {entry.neededBy.length ? `Needed by ${entry.neededBy.join(", ")}` : "Needed by the mod being installed"} • from {SOURCE[entry.kind]}
                  {entry.kind === "search" || entry.kind === "master" ? " (it couldn't be told for sure which mod it is)" : ""}
                </div>
                {entry.note && <div style={{ color: "var(--color-text-muted)", fontSize: 11, marginTop: 2 }}>{entry.note}</div>}
              </div>
              {/* With one, the button above already gets it. */}
              {!(requirements.length === 1 && entry.auto) && (
                <button className="sidebar-button" style={{ ...smallButton, padding: "6px 12px", fontSize: 12 }} onClick={() => onGet([entry])}>
                  {entry.kind === "search" || entry.kind === "master" ? "Search" : "Get"}
                </button>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
