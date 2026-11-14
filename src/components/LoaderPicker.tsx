import { useEffect, useState } from "react";

type Applied = UpdateResult & DependencyCheck & { loader: { name: string; from: string; to: string } };

type Props = {
  instanceName: string;
  onDone: (result: Applied) => void;
  onClose: () => void;
};

const message = (err: unknown) =>
  (err instanceof Error ? err.message : String(err)).replace(/^Error invoking remote method '[^']+': (Error: )?/, "");

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

/*
 * The builds of an instance's mod loader, to update or go back. Choosing one checks every
 * mod against it first, and finds mod updates that would make any that don't accept it
 * fit; the plan is shown before anything changes.
 */
export default function LoaderPicker({ instanceName, onDone, onClose }: Props) {
  const [list, setList] = useState<LoaderVersions | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [chosen, setChosen] = useState<string | null>(null);
  const [plan, setPlan] = useState<LoaderPlan | null>(null);
  // Off unless asked: other updates can break add-ons in ways their files don't declare.
  const [alsoUpdate, setAlsoUpdate] = useState(false);
  const [busy, setBusy] = useState<"planning" | "applying" | null>(null);
  const [progress, setProgress] = useState<string | null>(null);
  const [problems, setProblems] = useState<string[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let current = true;
    window.instanceAPI
      .loaderVersions(instanceName)
      .then((found) => {
        if (!current) return;
        setList(found);
        setChosen(found.newest);
      })
      .catch((err) => current && setLoadError(message(err)));
    return () => {
      current = false;
    };
  }, [instanceName]);

  useEffect(
    () =>
      window.instanceAPI.onProgress((p) => {
        if (p.name === instanceName && p.stage === "updates") setProgress(p.detail ?? null);
      }),
    [instanceName]
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && !busy && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, busy]);

  const loaderName = list?.loaderName ?? "Loader";
  const picked = list?.versions.find((v) => v.version === chosen) ?? null;

  async function check() {
    if (!picked || picked.installed) return;
    setBusy("planning");
    setError(null);
    setProblems(null);
    setProgress(null);
    try {
      setPlan(await window.instanceAPI.planLoader(instanceName, picked.version));
    } catch (err) {
      setError(message(err));
    }
    setBusy(null);
    setProgress(null);
  }

  async function apply(force: boolean) {
    if (!plan) return;
    setBusy("applying");
    setError(null);
    setProgress(null);
    try {
      const done = await window.instanceAPI.applyLoader(instanceName, plan.target, { force, alsoUpdate: plan.upgrade && alsoUpdate });
      if (done.needsConfirm) {
        setProblems(done.problems);
      } else {
        onDone(done);
        onClose();
        return;
      }
    } catch (err) {
      setError(message(err));
    }
    setBusy(null);
    setProgress(null);
  }

  const blocked = Boolean(plan?.blocking.length || problems?.length);
  const verb = plan?.upgrade === false ? "Go back" : "Update";

  return (
    <div
      data-testid="loader-picker"
      onClick={() => !busy && onClose()}
      style={{ position: "fixed", inset: 0, zIndex: 50, background: "var(--color-scrim)", display: "flex", alignItems: "center", justifyContent: "center", padding: 24 }}
    >
      <div
        role="dialog"
        aria-label={`Choose a version of ${loaderName}`}
        onClick={(e) => e.stopPropagation()}
        style={{
          width: "min(580px, 100%)",
          maxHeight: "min(760px, 90vh)",
          display: "flex",
          flexDirection: "column",
          background: "var(--color-surface)",
          border: "1px solid var(--color-border)",
          borderRadius: 14,
          boxShadow: "0 20px 60px var(--color-shadow)",
          textAlign: "left",
          color: "var(--color-text-secondary)",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "16px 20px", borderBottom: "1px solid var(--color-border)" }}>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 17, fontWeight: 600, color: "var(--color-accent-text)" }}>{loaderName}</div>
            <div style={{ fontSize: 12, color: "var(--color-text-muted)" }}>
              {list ? `You have ${list.current}. ` : ""}Every mod is checked before the loader changes.
            </div>
          </div>
          <button aria-label="Close" disabled={Boolean(busy)} onClick={onClose} style={{ marginLeft: "auto", background: "none", border: "none", color: "var(--color-text-muted)", fontSize: 22, cursor: "pointer", lineHeight: 1 }}>
            ×
          </button>
        </div>

        <div style={{ overflowY: "auto", padding: "10px 14px", flex: 1 }}>
          {plan ? (
            <div data-testid="loader-plan" style={{ padding: "4px 6px" }}>
              <div style={{ fontSize: 16, fontWeight: 600, marginBottom: 12 }}>
                {plan.loaderName} {plan.current} → {plan.target}
              </div>

              {plan.fixes.length > 0 && (
                <div style={{ marginBottom: 12 }}>
                  <div style={{ fontSize: 13, color: "var(--color-success-text)", marginBottom: 4 }}>
                    {plural(plan.fixes.length, "mod")} will be updated with it, so {plan.fixes.length === 1 ? "it keeps" : "they keep"} working:
                  </div>
                  <ul data-testid="loader-fixes" style={{ margin: "0 0 0 18px", padding: 0, fontSize: 13 }}>
                    {plan.fixes.map((fix) => (
                      <li key={fix.name}>
                        {fix.name} <span style={{ color: "var(--color-text-muted)" }}>{fix.from} → {fix.to}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {plan.blocking.length > 0 && (
                <div role="alert" data-testid="loader-blocking" style={{ marginBottom: 12, padding: "10px 12px", borderRadius: 10, background: "var(--color-warning-bg)", border: "1px solid var(--color-warning-border)", color: "var(--color-warning-text)", fontSize: 13 }}>
                  <div style={{ fontWeight: 600, marginBottom: 4 }}>
                    {plan.blocking.length === 1 ? "A mod" : `${plan.blocking.length} mods`} won't work with {plan.loaderName} {plan.target}, so the game probably wouldn't start:
                  </div>
                  <ul style={{ margin: "0 0 0 18px", padding: 0 }}>
                    {plan.blocking.map((text) => (
                      <li key={text}>{text}</li>
                    ))}
                  </ul>
                </div>
              )}

              {!plan.fixes.length && !plan.blocking.length && (
                <div style={{ fontSize: 13, color: "var(--color-success-text)", marginBottom: 12 }}>All your mods work with it. Nothing else needs to change.</div>
              )}

              {plan.upgrade && plan.otherUpdates > 0 && (
                <label style={{ display: "flex", gap: 8, alignItems: "flex-start", fontSize: 13, cursor: "pointer", marginBottom: 8 }}>
                  <input type="checkbox" data-testid="also-update" checked={alsoUpdate} disabled={Boolean(busy)} onChange={(e) => setAlsoUpdate(e.target.checked)} style={{ marginTop: 2 }} />
                  <span>
                    Also install the other {plural(plan.otherUpdates, "mod update")}
                    <span style={{ color: "var(--color-text-muted)" }}> (any that won't work are kept back, as with Update All)</span>
                  </span>
                </label>
              )}

              <div style={{ fontSize: 12, color: "var(--color-text-muted)" }}>Undo puts back the old loader and every file this changes.</div>
            </div>
          ) : loadError ? (
            <div style={{ color: "var(--color-danger-text)", fontSize: 13, padding: 8 }}>{loadError}</div>
          ) : !list ? (
            <div style={{ color: "var(--color-text-muted)", fontSize: 13, padding: 8 }}>Finding versions...</div>
          ) : !list.versions.length ? (
            <div style={{ color: "var(--color-text-muted)", fontSize: 13, padding: 8 }}>No builds of {loaderName} are listed for this Minecraft version.</div>
          ) : (
            list.versions.map((version) => {
              const selected = version.version === chosen;
              return (
                <div
                  key={version.version}
                  data-testid="loader-row"
                  role="radio"
                  aria-checked={selected}
                  tabIndex={0}
                  onClick={() => !busy && setChosen(version.version)}
                  onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && !busy && setChosen(version.version)}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 10,
                    padding: "8px 12px",
                    marginBottom: 6,
                    borderRadius: 10,
                    cursor: "pointer",
                    background: selected ? "var(--color-accent-subtle)" : "var(--color-surface-sunken)",
                    border: `1px solid ${selected ? "var(--color-accent-line)" : "var(--color-border)"}`,
                  }}
                >
                  <span
                    aria-hidden="true"
                    style={{ width: 14, height: 14, borderRadius: "50%", flexShrink: 0, border: `2px solid ${selected ? "var(--color-accent-line)" : "var(--color-border-strong)"}`, background: selected ? "var(--color-accent-subtle)" : "transparent" }}
                  />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                      <span style={{ fontWeight: 600, fontSize: 14 }}>{version.version}</span>
                      {!version.stable && <span style={{ fontSize: 10, color: "var(--color-warning-text)", border: "1px solid var(--color-warning-border)", borderRadius: 6, padding: "0 6px" }}>Beta</span>}
                      {version.installed && <span style={{ fontSize: 10, background: "var(--color-accent)", color: "var(--color-on-accent)", borderRadius: 6, padding: "1px 6px" }}>Installed</span>}
                      {version.version === list.newest && <span style={{ fontSize: 10, color: "var(--color-success-text)" }}>Newest</span>}
                    </div>
                    {!version.installed && (
                      <div style={{ fontSize: 11, color: version.problems ? "var(--color-warning-text)" : "var(--color-success-text)" }}>
                        {version.problems
                          ? `${plural(version.problems, "mod")} ${version.problems === 1 ? "doesn't" : "don't"} accept it as ${version.problems === 1 ? "it is" : "they are"}`
                          : "All your mods accept it"}
                      </div>
                    )}
                  </div>
                </div>
              );
            })
          )}
        </div>

        {problems && (
          <div role="alert" style={{ margin: "0 20px", padding: "10px 12px", borderRadius: 10, background: "var(--color-warning-bg)", border: "1px solid var(--color-warning-border)", color: "var(--color-warning-text)", fontSize: 13 }}>
            <div style={{ fontWeight: 600, marginBottom: 4 }}>The mod updates it needs probably won't work with the rest of the instance:</div>
            <ul style={{ margin: "0 0 0 18px", padding: 0 }}>
              {problems.map((problem) => (
                <li key={problem}>{problem}</li>
              ))}
            </ul>
          </div>
        )}
        {busy && progress && <div style={{ margin: "8px 20px 0", color: "var(--color-accent-text)", fontSize: 12 }}>{progress}</div>}
        {error && <div role="alert" style={{ margin: "8px 20px 0", color: "var(--color-danger-text)", fontSize: 13, whiteSpace: "pre-wrap" }}>{error}</div>}

        <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "12px 20px", borderTop: "1px solid var(--color-border)" }}>
          {plan ? (
            <>
              <button
                className="sidebar-button"
                disabled={Boolean(busy)}
                onClick={() => {
                  setPlan(null);
                  setProblems(null);
                  setError(null);
                }}
                style={{ padding: "8px 14px", fontSize: 13, marginRight: "auto" }}
              >
                ← Versions
              </button>
              <button className="sidebar-button" disabled={Boolean(busy)} onClick={onClose} style={{ padding: "8px 14px", fontSize: 13 }}>
                Cancel
              </button>
              <button
                className="sidebar-button"
                data-testid="apply-loader"
                disabled={Boolean(busy)}
                onClick={() => apply(blocked)}
                style={{ padding: "8px 14px", fontSize: 13, background: blocked ? "var(--color-warning-solid)" : "var(--color-success-solid)", color: blocked ? "var(--color-on-warning)" : "var(--color-on-success)", borderColor: blocked ? "var(--color-warning-border)" : "var(--color-success-border)" }}
              >
                {busy === "applying"
                  ? "Installing..."
                  : blocked
                  ? `${verb} anyway`
                  : plan.fixes.length
                  ? `${verb} loader and ${plural(plan.fixes.length, "mod")}`
                  : `${verb} loader`}
              </button>
            </>
          ) : (
            <>
              <span style={{ fontSize: 12, color: "var(--color-text-muted)", marginRight: "auto" }}>
                {picked && !picked.installed ? `${list?.newest && picked.version === list.newest ? "Updating" : "Changing"} to ${picked.version}` : "Pick a version"}
              </span>
              <button className="sidebar-button" disabled={Boolean(busy)} onClick={onClose} style={{ padding: "8px 14px", fontSize: 13 }}>
                Cancel
              </button>
              <button
                className="sidebar-button"
                data-testid="check-loader"
                disabled={Boolean(busy) || !picked || picked.installed}
                onClick={check}
                style={{ padding: "8px 14px", fontSize: 13, background: picked && !picked.installed ? "var(--color-accent-subtle)" : undefined, borderColor: picked && !picked.installed ? "var(--color-accent-line)" : undefined }}
              >
                {busy === "planning" ? "Checking your mods..." : picked && !picked.installed ? `Check ${picked.version}` : "Check"}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
