import { useEffect, useState } from "react";
import { Layers } from "lucide-react";
import { Button } from "../../components/ui";
import { errorText, useIssueReport, type IssueReport } from "./shared";

type Props = {
  detail: GameDetail;
  /* The mods as listed: when they change, conflicts are looked at again. */
  mods: GameMod[];
  report?: IssueReport;
};

/*
 * Mods that have the same files, whose copies are in the game and why (made for the
 * others first, then the newest), and choosing another's instead.
 */
export default function ConflictsPanel({ detail, mods, report }: Props) {
  const [groups, setGroups] = useState<GameConflict[] | null>(null);
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

  useIssueReport(report, "Same files", groups?.length ?? 0, "info");

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
    <section className="gm-issue gm-issue--info" data-testid="conflicts">
      <div className="gm-issue__head">
        <Layers size={16} className="gm-issue__icon" aria-hidden="true" />
        <span className="gm-issue__text">
          {groups.length === 1 ? `${list(groups[0].mods.map((m) => m.name))} have the same files` : `${groups.length} sets of mods have the same files`}: the one made for the
          others is used, or else the newest.
        </span>
      </div>
      {error && <div className="gm-issue__error">{error}</div>}
      <div className="gm-issue__list">
        {groups.map((group) => (
          <div key={group.id} className="gm-issue__item" data-testid="conflict">
            <div className="gm-issue__item-title">
              {list(group.mods.map((m) => m.name))} all have{" "}
              <button type="button" className="gm-link" onClick={() => setShowFiles((now) => (now === group.id ? null : group.id))}>
                {group.files.length} file{group.files.length === 1 ? "" : "s"}
              </button>
              .
            </div>
            <div className="gm-issue__item-text gm-issue__item-text--accent">
              Using {nameOf(group, group.suggested)}'s: {group.reason.charAt(0).toLowerCase() + group.reason.slice(1)}.
              {group.live !== group.suggested && " (Being sorted out.)"}
            </div>
            {showFiles === group.id && (
              <div className="gm-issue__files">
                {group.files.map((file) => (
                  <div key={file}>{file}</div>
                ))}
              </div>
            )}
            <div className="gm-issue__buttons">
              {group.mods
                .filter((m) => m.id !== group.suggested)
                .map((m) => (
                  <Button key={m.id} size="sm" onClick={() => choose(group.id, m.id)}>
                    Use {m.name}'s instead
                  </Button>
                ))}
              {group.chosen && (
                <Button size="sm" onClick={() => choose(group.id, null)}>
                  Back to the launcher's choice
                </Button>
              )}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
