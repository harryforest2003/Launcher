import { useEffect, useState } from "react";
import { HeartPulse } from "lucide-react";
import { errorText, note, smallButton } from "./shared";

type Props = {
  detail: GameDetail;
  /* The mods as listed: when they change, the folders are checked again. */
  mods: GameMod[];
  reload: () => Promise<void>;
};

/* What the mod health check found in the game's folders, each with its fix where there is one. */
export default function HealthPanel({ detail, mods, reload }: Props) {
  const [issues, setIssues] = useState<GameHealthIssue[] | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [said, setSaid] = useState<{ tone: "good" | "bad"; text: string } | null>(null);

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

  async function fix(list: GameHealthIssue[]) {
    setBusy(list.length === 1 ? list[0].id : "all");
    const done: string[] = [];
    try {
      for (const issue of list) done.push((await window.gamesAPI.healthFix(detail.id, issue.id)).done);
      setSaid({ tone: "good", text: done.join(" ") });
    } catch (err) {
      setSaid({ tone: "bad", text: errorText(err) });
    }
    setBusy(null);
    await reload();
    setIssues(await window.gamesAPI.health(detail.id).catch(() => []));
  }

  if (said && !issues?.length) {
    return <div style={note(said.tone)}>{said.text}</div>;
  }
  if (!issues?.length) return null;
  const fixable = issues.filter((i) => i.fix);
  const errors = issues.filter((i) => i.severity === "error").length;

  return (
    <div style={note(errors ? "bad" : "warn")} data-testid="health">
      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
        <HeartPulse size={18} style={{ flexShrink: 0 }} />
        <span style={{ flex: 1 }}>
          Mod health: {issues.length === 1 ? "1 problem" : `${issues.length} problems`} in {detail.name}'s mod folders
          {errors ? ` (${errors} stop${errors === 1 ? "s" : ""} mods loading)` : ""}.
        </span>
        {fixable.length > 1 && (
          <button
            className="sidebar-button"
            data-testid="health-fix-all"
            style={{ ...smallButton, padding: "6px 12px", fontSize: 12, background: "var(--color-accent)", color: "var(--color-on-accent)", borderColor: "var(--color-accent-line)", flexShrink: 0 }}
            onClick={() => !busy && fix(fixable)}
          >
            {busy === "all" ? "Fixing..." : `Fix all (${fixable.length})`}
          </button>
        )}
      </div>
      {said && <div style={{ fontSize: 12, marginTop: 8 }}>{said.text}</div>}
      <div style={{ display: "flex", flexDirection: "column", gap: 6, marginTop: 10 }}>
        {issues.map((issue) => (
          <div key={issue.id} style={{ padding: "8px 10px", background: "var(--color-hover)", borderRadius: 8 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 600 }}>{issue.title}</div>
                <div style={{ fontSize: 12, opacity: 0.9, marginTop: 2 }}>
                  {issue.detail}
                  {issue.files.length > 0 && (
                    <>
                      {" "}
                      <button onClick={() => setOpen((now) => (now === issue.id ? null : issue.id))} style={{ background: "none", border: "none", padding: 0, color: "inherit", cursor: "pointer", font: "inherit", textDecoration: "underline" }}>
                        {open === issue.id ? "Hide which" : "Which?"}
                      </button>
                    </>
                  )}
                </div>
              </div>
              {issue.fix && (
                <button className="sidebar-button" style={{ ...smallButton, padding: "6px 12px", fontSize: 12, flexShrink: 0 }} onClick={() => !busy && fix([issue])}>
                  {busy === issue.id ? "Fixing..." : issue.fix}
                </button>
              )}
            </div>
            {open === issue.id && (
              <div style={{ marginTop: 6, fontSize: 11, fontFamily: "monospace", opacity: 0.85, maxHeight: 140, overflowY: "auto" }}>
                {issue.files.map((file) => (
                  <div key={file}>{file}</div>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
