import { useState } from "react";

type Props = {
  instanceName: string;
  contentType: ContentType;
  world?: string;
  onInstalled: (result: { name: string; folder: string; type: ContentType } & Partial<DependencyCheck>) => void;
};

const fieldStyle: React.CSSProperties = {
  flex: "1 1 240px",
  padding: 10,
  borderRadius: 10,
  background: "#1b1b1b",
  color: "white",
  border: "1px solid #6d28d9",
};

function formatSize(bytes: number) {
  return bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

const message = (err: unknown) =>
  (err instanceof Error ? err.message : String(err)).replace(/^Error invoking remote method '[^']+': (Error: )?/, "");

/*
 * Installs a file from a GitHub repository's releases. A mod that says it's for another
 * version or loader, or doesn't say at all, needs a second click to install anyway.
 */
export default function GitHubInstall({ instanceName, contentType, world, onInstalled }: Props) {
  const [input, setInput] = useState("");
  const [found, setFound] = useState<{ repo: string; releases: GitHubRelease[] } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [warning, setWarning] = useState<{ release: GitHubRelease; asset: GitHubAsset; reason: string } | null>(null);

  async function lookUp() {
    setBusy("lookup");
    setError(null);
    setWarning(null);
    setFound(null);

    try {
      const result = await window.instanceAPI.githubReleases(input, contentType);
      setFound(result);
      if (result.releases.length === 0) setError(`${result.repo} has no releases with a file for this.`);
    } catch (err) {
      setError(message(err));
    }

    setBusy(null);
  }

  async function install(release: GitHubRelease, asset: GitHubAsset, force = false) {
    if (!found) return;

    setBusy(asset.url);
    setError(null);
    setWarning(null);

    try {
      const result = await window.instanceAPI.githubInstall({
        name: instanceName,
        repo: found.repo,
        tag: release.tag,
        asset,
        type: contentType,
        world,
        force,
      });

      if ("needsConfirm" in result) setWarning({ release, asset, reason: result.reason });
      else onInstalled(result.installed);
    } catch (err) {
      setError(message(err));
    }

    setBusy(null);
  }

  return (
    <div data-testid="github-install" style={{ marginBottom: 14 }}>
      <form
        style={{ display: "flex", gap: 8, flexWrap: "wrap" }}
        onSubmit={(event) => {
          event.preventDefault();
          if (input.trim()) lookUp();
        }}
      >
        <input
          value={input}
          onChange={(event) => setInput(event.target.value)}
          placeholder='GitHub repository, like "CaffeineMC/sodium", or its link'
          aria-label="GitHub repository"
          style={fieldStyle}
        />
        <button className="sidebar-button" type="submit" disabled={!input.trim() || !!busy}>
          {busy === "lookup" ? "Looking..." : "Find releases"}
        </button>
      </form>

      {error && <div style={{ color: "#fca5a5", fontSize: 12, marginTop: 8 }}>{error}</div>}

      {warning && (
        <div
          role="alert"
          data-testid="github-warning"
          style={{ marginTop: 10, padding: 12, borderRadius: 10, background: "#2a1a05", border: "1px solid #b45309", color: "#fcd34d", fontSize: 13 }}
        >
          {warning.reason}
          <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
            <button className="sidebar-button" style={{ padding: "6px 12px" }} onClick={() => install(warning.release, warning.asset, true)}>
              Install anyway
            </button>
            <button className="sidebar-button" style={{ padding: "6px 12px" }} onClick={() => setWarning(null)}>
              Cancel
            </button>
          </div>
        </div>
      )}

      {found?.releases.map((release) => (
        <div key={release.tag} data-testid="github-release" style={{ marginTop: 12 }}>
          <div style={{ color: "#c084fc", fontSize: 13, marginBottom: 6 }}>
            {release.name}
            <span style={{ color: "#6b7280" }}>
              {" "}• {new Date(release.published).toLocaleDateString()}
              {release.prerelease ? " • pre-release" : ""}
            </span>
          </div>

          {release.assets.map((asset) => (
            <div key={asset.url} style={{ display: "flex", alignItems: "center", gap: 10, padding: "4px 0" }}>
              <span style={{ flex: 1, minWidth: 0, fontSize: 12, color: "#ddd", wordBreak: "break-all" }}>
                {asset.name} <span style={{ color: "#6b7280" }}>({formatSize(asset.size)})</span>
              </span>
              <button
                className="sidebar-button"
                style={{ padding: "4px 12px", fontSize: 12, background: "#7c3aed" }}
                disabled={!!busy}
                onClick={() => install(release, asset)}
              >
                {busy === asset.url ? "Installing..." : "Install"}
              </button>
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}
