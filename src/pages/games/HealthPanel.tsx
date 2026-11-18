import { useEffect, useState } from "react";
import { HeartPulse } from "lucide-react";
import { Button } from "../../components/ui";
import { errorText, useIssueReport, type IssueReport, type Say } from "./shared";

type Props = {
  detail: GameDetail;
  /* The mods as listed: when they change, the folders are checked again. */
  mods: GameMod[];
  reload: () => Promise<void>;
  report?: IssueReport;
  say?: Say;
};

/* What the mod health check found in the game's folders, each with its fix where there is one. */
export default function HealthPanel({ detail, mods, reload, report, say }: Props) {
  const [issues, setIssues] = useState<GameHealthIssue[] | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    window.gamesAPI
      .health(detail.id)
      .then((found) => active && setIssues(found))
      .catch(() => active && setIssues([]));
    return () => {
      active = false;
    };
  }, [detail.id, mods]);

  const errors = (issues ?? []).filter((i) => i.severity === "error").length;
  useIssueReport(report, "Health", issues?.length ?? 0, errors ? "danger" : "warning");

  async function fix(list: GameHealthIssue[]) {
    setBusy(list.length === 1 ? list[0].id : "all");
    const done: string[] = [];
    try {
      for (const issue of list) done.push((await window.gamesAPI.healthFix(detail.id, issue.id)).done);
      say?.({ tone: "good", text: done.join(" ") });
    } catch (err) {
      say?.({ tone: "bad", text: errorText(err) });
    }
    setBusy(null);
    await reload();
    setIssues(await window.gamesAPI.health(detail.id).catch(() => []));
  }

  if (!issues?.length) return null;
  const fixable = issues.filter((i) => i.fix);

  return (
    <section className={`gm-issue gm-issue--${errors ? "danger" : "warning"}`} data-testid="health">
      <div className="gm-issue__head">
        <HeartPulse size={16} className="gm-issue__icon" aria-hidden="true" />
        <span className="gm-issue__text">
          Mod health: {issues.length === 1 ? "1 problem" : `${issues.length} problems`} in {detail.name}'s mod folders
          {errors ? ` (${errors} stop${errors === 1 ? "s" : ""} mods loading)` : ""}.
        </span>
        {fixable.length > 1 && (
          <div className="gm-issue__actions">
            <Button size="sm" variant="primary" data-testid="health-fix-all" onClick={() => !busy && fix(fixable)}>
              {busy === "all" ? "Fixing..." : `Fix all (${fixable.length})`}
            </Button>
          </div>
        )}
      </div>
      <div className="gm-issue__list">
        {issues.map((issue) => (
          <div key={issue.id} className="gm-issue__item">
            <div className="gm-issue__item-row">
              <div className="gm-issue__item-main">
                <div className="gm-issue__item-title">{issue.title}</div>
                <div className="gm-issue__item-text">
                  {issue.detail}
                  {issue.files.length > 0 && (
                    <>
                      {" "}
                      <button type="button" className="gm-link" onClick={() => setOpen((now) => (now === issue.id ? null : issue.id))}>
                        {open === issue.id ? "Hide which" : "Which?"}
                      </button>
                    </>
                  )}
                </div>
              </div>
              {issue.fix && (
                <Button size="sm" onClick={() => !busy && fix([issue])}>
                  {busy === issue.id ? "Fixing..." : issue.fix}
                </Button>
              )}
            </div>
            {open === issue.id && (
              <div className="gm-issue__files">
                {issue.files.map((file) => (
                  <div key={file}>{file}</div>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>
    </section>
  );
}
