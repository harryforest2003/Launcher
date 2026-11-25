import { useState } from "react";
import { ShieldIcon } from "./Icons";
import { Badge, Button, Modal, Notice } from "./ui";

/*
 * "Check for malware" on an instance's content: every mod looked up on Modrinth and
 * CurseForge and read for what malware does, and this computer checked for the files
 * fractureiser left behind. The report lists what needs a look first.
 */

const LEVEL: Record<SafetyFile["level"], { tone: "danger" | "warning" | "neutral" | "success"; label: string }> = {
  danger: { tone: "danger", label: "Dangerous" },
  warning: { tone: "warning", label: "Check this" },
  unknown: { tone: "neutral", label: "Not on a mod site" },
  ok: { tone: "success", label: "Looks fine" },
};

const SOURCE: Record<SafetyFile["source"], string> = { modrinth: "On Modrinth", curseforge: "On CurseForge", unknown: "Not found on Modrinth or CurseForge" };

export function SafetyReportView({ report }: { report: SafetyReport }) {
  const [showFine, setShowFine] = useState(false);
  const { counts } = report;
  const needsLook = report.files.filter((file) => file.level !== "ok");
  const fine = report.files.filter((file) => file.level === "ok");
  const bad = counts.danger > 0 || report.system.length > 0;

  return (
    <div className="safety" data-testid="safety-report">
      {report.system.map((finding) => (
        <Notice key={finding.path} tone="danger">
          {finding.text} <code className="safety__path">{finding.path}</code>
        </Notice>
      ))}
      <Notice tone={bad ? "danger" : counts.warning ? "warning" : "success"}>
        {bad
          ? "Something here matches known malware. Don't play this instance; remove the files marked Dangerous."
          : counts.warning
            ? `${counts.warning} mod${counts.warning === 1 ? " does" : "s do"} things malware does. That can be fine (some mods download their own parts), but only keep ${counts.warning === 1 ? "it" : "them"} if you trust where ${counts.warning === 1 ? "it" : "they"} came from.`
            : `Nothing looked wrong in ${report.files.length} mod${report.files.length === 1 ? "" : "s"}.`}
        {counts.unknown > 0 && ` ${counts.unknown} ${counts.unknown === 1 ? "isn't" : "aren't"} on Modrinth or CurseForge, so nobody else has checked ${counts.unknown === 1 ? "it" : "them"}.`}
        {!report.sitesChecked && " CurseForge couldn't be asked, so some of those may be on it."}
      </Notice>

      {needsLook.length > 0 && (
        <ul className="safety__list">
          {needsLook.map((file) => (
            <li key={file.name} className="safety__file" data-level={file.level}>
              <div className="safety__head">
                <span className="safety__name">{file.title && file.title !== file.name ? file.title : file.name}</span>
                <Badge tone={LEVEL[file.level].tone}>{LEVEL[file.level].label}</Badge>
              </div>
              <div className="safety__meta">
                {file.name} · {SOURCE[file.source]}
                {!file.enabled && " · turned off"}
              </div>
              {file.findings.length > 0 && (
                <ul className="safety__findings">
                  {file.findings.map((finding) => (
                    <li key={finding.text + finding.where} data-level={finding.level}>
                      {finding.text}
                      {finding.where && <span className="safety__where"> {finding.where}</span>}
                    </li>
                  ))}
                </ul>
              )}
            </li>
          ))}
        </ul>
      )}

      {fine.length > 0 && (
        <button type="button" className="safety__toggle" onClick={() => setShowFine((on) => !on)} aria-expanded={showFine}>
          {showFine ? "Hide" : "Show"} {fine.length} that looked fine
        </button>
      )}
      {showFine && (
        <ul className="safety__list safety__list--fine">
          {fine.map((file) => (
            <li key={file.name} className="safety__meta">
              {file.title && file.title !== file.name ? `${file.title} (${file.name})` : file.name} · {SOURCE[file.source]}
            </li>
          ))}
        </ul>
      )}
      <p className="safety__small">
        A check, not an antivirus: a clean result means nothing here looked wrong, not that nothing could be.
      </p>
    </div>
  );
}

export default function SafetyCheck({ instanceName }: { instanceName: string }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [report, setReport] = useState<SafetyReport | null>(null);
  const [error, setError] = useState<string | null>(null);

  const check = async () => {
    setOpen(true);
    setBusy(true);
    setError(null);
    try {
      setReport(await window.instanceAPI.safetyCheck(instanceName));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <Button
        data-testid="safety-check"
        icon={<ShieldIcon size={14} />}
        onClick={check}
        disabled={busy}
        aria-label="Check for malware"
        title="Check the mods for malware"
      />
      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title="Malware check"
        lead={busy ? "Looking up each mod on Modrinth and CurseForge and reading its code..." : undefined}
        size="md"
        footer={
          <>
            <Button onClick={check} disabled={busy}>
              Check again
            </Button>
            <Button variant="primary" onClick={() => setOpen(false)}>
              Done
            </Button>
          </>
        }
      >
        {error && <Notice tone="danger">{error}</Notice>}
        {!busy && report && <SafetyReportView report={report} />}
      </Modal>
    </>
  );
}
