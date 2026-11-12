import { useEffect, useState } from "react";
import { Layers } from "lucide-react";
import { errorText, note, smallButton } from "./shared";

type Props = {
  detail: GameDetail;
  /* The mods as listed: when they change, conflicts are looked at again. */
  mods: GameMod[];
};

/*
 * Mods that have the same files, whose copies are in the game and why (made for the
 * others first, then the newest), and choosing another's instead.
 */
export default function ConflictsPanel({ detail, mods }: Props) {
  const [groups, setGroups] = useState<GameConflict[] | null>(null);
  const [open, setOpen] = useState(false);
  const [showFiles, setShowFiles] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    window.gamesAPI
      .conflicts(detail.id)
      .then((found) => active && setGroups(found))
      .catch(() => active && setGroups([]));
    return () => {
      active = false;
    };
  }, [detail.id, mods]);

  async function choose(groupId: string, modId: string | null) {
    setError(null);
    try {
      setGroups(await window.gamesAPI.chooseConflict(detail.id, groupId, modId));
    } catch (err) {
      setError(errorText(err));
    }
  }

  if (!groups?.length) return null;
  const nameOf = (group: GameConflict, id: string) => group.mods.find((m) => m.id === id)?.name ?? "?";
  const list = (names: string[]) => (names.length <= 2 ? names.join(" and ") : `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`);

  return (
    <div style={note("info")} data-testid="conflicts">
      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
        <Layers size={18} style={{ flexShrink: 0 }} />
        <span style={{ flex: 1 }}>
          {groups.length === 1 ? `${list(groups[0].mods.map((m) => m.name))} have the same files` : `${groups.length} sets of mods have the same files`}: the one made for the
          others is used, or else the newest.
        </span>
        <button className="sidebar-button" style={{ ...smallButton, padding: "6px 12px", fontSize: 12, flexShrink: 0 }} onClick={() => setOpen((now) => !now)}>
          {open ? "Hide" : "See which"}
        </button>
      </div>
      {error && <div style={{ fontSize: 12, marginTop: 8, color: "#fca5a5" }}>{error}</div>}
      {open && (
        <div style={{ display: "flex", flexDirection: "column", gap: 6, marginTop: 10 }}>
          {groups.map((group) => (
            <div key={group.id} style={{ padding: "8px 10px", background: "rgba(0, 0, 0, 0.25)", borderRadius: 8 }} data-testid="conflict">
              <div style={{ fontSize: 13 }}>
                {list(group.mods.map((m) => m.name))} all have{" "}
                <button onClick={() => setShowFiles((now) => (now === group.id ? null : group.id))} style={{ background: "none", border: "none", padding: 0, color: "inherit", cursor: "pointer", font: "inherit", textDecoration: "underline" }}>
                  {group.files.length} file{group.files.length === 1 ? "" : "s"}
                </button>
                .
              </div>
              <div style={{ fontSize: 12, marginTop: 3, color: "#c4b5fd" }}>
                Using {nameOf(group, group.suggested)}'s: {group.reason.charAt(0).toLowerCase() + group.reason.slice(1)}.
                {group.live !== group.suggested && " (Being sorted out.)"}
              </div>
              {showFiles === group.id && (
                <div style={{ marginTop: 6, fontSize: 11, fontFamily: "monospace", opacity: 0.85, maxHeight: 120, overflowY: "auto" }}>
                  {group.files.map((file) => (
                    <div key={file}>{file}</div>
                  ))}
                </div>
              )}
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 6 }}>
                {group.mods
                  .filter((m) => m.id !== group.suggested)
                  .map((m) => (
                    <button key={m.id} className="sidebar-button" style={{ ...smallButton, padding: "5px 10px", fontSize: 12 }} onClick={() => choose(group.id, m.id)}>
                      Use {m.name}'s instead
                    </button>
                  ))}
                {group.chosen && (
                  <button className="sidebar-button" style={{ ...smallButton, padding: "5px 10px", fontSize: 12 }} onClick={() => choose(group.id, null)}>
                    Back to the launcher's choice
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
