import { useState } from "react";
import { Button, Notice } from "./ui";
import { color, font, space } from "../theme/tokens";

type Props = {
  instanceName: string;
  contentType: ContentType;
  world?: string;
  onInstalled: (result: { name: string; folder: string; type: ContentType } & Partial<DependencyCheck>) => void;
};

const fieldStyle: React.CSSProperties = { flex: "1 1 240px", minWidth: 0 };

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
    <div data-testid="github-install" style={{ marginBottom: space[4], fontFamily: font.ui }}>
      <form
        style={{ display: "flex", gap: space[2], flexWrap: "wrap" }}
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
          className="ui-input"
          style={fieldStyle}
        />
        <Button type="submit" disabled={!input.trim() || !!busy}>
          {busy === "lookup" ? "Looking..." : "Find releases"}
        </Button>
      </form>

      {error && <div role="alert" style={{ color: color.dangerText, fontSize: font.size.xs, marginTop: space[2] }}>{error}</div>}

      {warning && (
        <Notice tone="warning" data-testid="github-warning" role="alert" style={{ marginTop: space[3] }}>
          {warning.reason}
          <div style={{ display: "flex", gap: space[2], marginTop: space[3] }}>
            <Button size="sm" onClick={() => install(warning.release, warning.asset, true)}>
              Install anyway
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setWarning(null)}>
              Cancel
            </Button>
          </div>
        </Notice>
      )}

      {found?.releases.map((release) => (
        <div key={release.tag} data-testid="github-release" style={{ marginTop: space[3] }}>
          <div style={{ color: color.text, fontSize: font.size.sm, fontWeight: font.weight.semibold, marginBottom: space[1.5] }}>
            {release.name}
            <span style={{ color: color.textMuted, fontWeight: font.weight.regular }}>
              {", "}
              {new Date(release.published).toLocaleDateString()}
              {release.prerelease ? ", pre-release" : ""}
            </span>
          </div>

          {release.assets.map((asset) => (
            <div key={asset.url} style={{ display: "flex", alignItems: "center", gap: space[3], padding: `${space[1]} 0` }}>
              <span style={{ flex: 1, minWidth: 0, fontSize: font.size.xs, fontFamily: font.mono, color: color.textSecondary, wordBreak: "break-all" }}>
                {asset.name} <span style={{ color: color.textMuted }}>({formatSize(asset.size)})</span>
              </span>
              <Button size="sm" disabled={!!busy} onClick={() => install(release, asset)}>
                {busy === asset.url ? "Installing..." : "Install"}
              </Button>
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}
