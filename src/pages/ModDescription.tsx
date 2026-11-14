import BackgroundLogo from "../components/BackgroundLogo";
import { useEffect, useMemo, useState } from "react";
import InstallToInstance from "../components/InstallToInstance";
import Sidebar from "../components/MCSidebar";
import { descriptionHtml } from "../utils/projectDescription";
import { projectFromLink } from "../utils/projectLinks";

type Props = {
  source: "modrinth" | "curseforge";
  projectId: string;
  openProject: (source: "modrinth" | "curseforge", id: string) => void;

  onBack: () => void;
  goHome: () => void;
  goMinecraft: () => void;
  goDiscover: () => void;
  goLibrary: () => void;
  goSkinSelector: () => void;
  goSettings: () => void;
};

const TYPE_LABELS: Record<string, string> = {
  mod: "Mod",
  modpack: "Modpack",
  shader: "Shader",
  datapack: "Data Pack",
  resourcepack: "Resource Pack",
};

function ModDescription({
  source,
  projectId,
  openProject,
  onBack,
  goHome,
  goMinecraft,
  goDiscover,
  goLibrary,
  goSkinSelector,
  goSettings,
}: Props) {
  const [mod, setMod] = useState<any>(null);
  const [tab, setTab] = useState<"desc" | "versions" | "gallery">("desc");

  
  const [versions, setVersions] = useState<any[]>([]);
  const [failed, setFailed] = useState(false);
  // Why it failed, when the launcher knows (CurseForge busy, say).
  const [failReason, setFailReason] = useState<string | null>(null);

  useEffect(() => {
    let active = true;

    async function load() {
      // Following a link reuses this page, so the last project has to go first.
      setMod(null);
      setFailed(false);
      setFailReason(null);
      setTab("desc");

      let reason: string | null = null;
      const project = await window.launcherAPI.getProject(source, projectId).catch((err: unknown) => {
        reason = String(err instanceof Error ? err.message : err).replace(/^Error invoking remote method '[^']+': (Error: )?/, "");
        return null;
      });
      if (!active) return;

      setFailed(!project);
      setFailReason(reason);
      setMod(project);
      setVersions(project?.versions || []);
    }

    load();

    return () => {
      active = false;
    };
  }, [source, projectId]);

  /*
   * Links to other projects stay in the launcher. Everything else carries on to the
   * system browser, as does a project link that turns out not to lead anywhere here.
   */
  async function followLink(event: React.MouseEvent<HTMLDivElement>) {
    const anchor = (event.target as Element).closest("a[href]") as HTMLAnchorElement | null;
    const link = anchor && projectFromLink(anchor.href);
    if (!anchor || !link) return;

    event.preventDefault();

    const found = await window.launcherAPI.resolveProjectLink(link).catch(() => null);

    if (!found) {
      window.modAPI.openUrl(anchor.href).catch(() => {});
    } else if (found.source === source && String(found.id) === String(mod?.id)) {
      setTab(link.section);
    } else {
      openProject(found.source, found.id);
    }
  }

  const body = useMemo(
    () => descriptionHtml(source, mod?.body || mod?.description || "No description"),
    [source, mod]
  );

  if (failed) {
    return (
      <div style={{ color: "var(--color-text)", padding: 40 }}>
        <p style={{ color: "var(--color-danger-text)", marginBottom: 16 }}>
          {failReason ?? "This project could not be loaded. Check your connection."}
        </p>
        <button className="sidebar-button" onClick={onBack}>← Back</button>
      </div>
    );
  }

  if (!mod) {
    return (
      <div style={{ color: "var(--color-text)", padding: 40 }}>Loading...</div>
    );
  }

  return (
    <div style={{ display: "flex", height: "100vh", background: "var(--color-bg)", color: "var(--color-text)" }}>
      <Sidebar
        currentPage="discover"
        goHome={goHome}
        goMinecraft={goMinecraft}
        goDiscover={goDiscover}
        goLibrary={goLibrary}
        goSkinSelector={goSkinSelector}
        goSettings={goSettings}
        showBack
        onBack={onBack}
      />

      {/* MAIN CONTENT */}
      <div style={{ flex: 1, minWidth: 0, display: "flex", padding: 25, gap: 20, boxSizing: "border-box" }}>
        {/* LEFT CONTENT, with the logo centred behind it */}
        <div style={{ flex: 1, minWidth: 0, position: "relative", display: "flex" }}>
        <BackgroundLogo />
        <div style={{ flex: 1, minWidth: 0, overflowY: "auto", overflowX: "hidden", position: "relative" }}>

	  {/* SUMMARY */}
	  <div
	    style={{
	      display: "flex",
	      gap: 20,
	      background: "var(--color-surface)",
	      padding: 20,
	      borderRadius: 12,
	      border: "1px solid var(--color-border)",
	      alignItems: "center",
	    }}
	  >
	    {mod.icon ? (
	      <img
	        src={mod.icon}
	        alt=""
	        style={{
	          width: 110,
	          height: 110,
	          borderRadius: 16,
	          flexShrink: 0,
	        }}
	      />
	    ) : null}

	    <div style={{ minWidth: 0 }}>
	      <h1
	        style={{
	          margin: 0 }}
	      >
	        {mod.title}
	      </h1>

	      <p style={{ color: "var(--color-text-muted)", marginTop: 6 }}>
	        {mod.authors?.join(", ") || ""}
	      </p>

 	     <span
	        style={{
	          display: "inline-block",
	          marginTop: 10,
	          padding: "4px 10px",
	          borderRadius: 8,
	          background:
	            source === "curseforge"
	              ? "var(--color-warning-solid)"
	              : "var(--color-success-solid)",
	          fontSize: 12,
	          fontWeight: 700,
	        }}
	      >
	        {source === "curseforge"
	          ? "CURSEFORGE"
	          : "MODRINTH"}
	      </span>

	      <p
	        style={{
	          marginTop: 14,
	          color: "var(--color-text-secondary)",
	        }}
	      >
	        {mod.description}
	      </p>
	    </div>
	  </div>

          {/* TABS */}
          <div style={{ display: "flex", gap: 10, marginTop: 20 }}>
            <button onClick={() => setTab("desc")} className="sidebar-button">
              Description
            </button>
            <button onClick={() => setTab("versions")} className="sidebar-button">
              Versions
            </button>
            <button onClick={() => setTab("gallery")} className="sidebar-button">
              Gallery
            </button>
          </div>

          {/* TAB CONTENT */}
          <div style={{ marginTop: 20 }}>

            {/* DESCRIPTION */}
            {tab === "desc" && (
              <div style={{ color: "var(--color-text-secondary)", lineHeight: 1.7, overflowX: "hidden", wordBreak: "break-word"}}>
                <div
                  className="mod-description"
                  onClick={followLink}
                  dangerouslySetInnerHTML={{ __html: body }}
                />
              </div>
            )}

            {/* VERSIONS */}
            {tab === "versions" && (
              <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                {versions.map((v: any) => (
                  <div
                    key={v.id}
                    style={{
                      background: "var(--color-surface-sunken)",
                      padding: 12,
                      borderRadius: 10,
                      border: "1px solid var(--color-border)",
                    }}
                  >
                    <h4 style={{ color: "var(--color-accent-text)" }}>
                      {v.name || v.version_number}
                    </h4>

                    <p>Type: {v.version_type}</p>
                    <p>Game Version: {v.game_versions?.join(", ")}</p>
                    <p>Loaders: {v.loaders?.join(", ")}</p>
                    <p>Downloads: {v.downloads ?? "N/A"}</p>
                    <p>Published: {new Date(v.date_published).toLocaleDateString()}</p>
                  </div>
                ))}
              </div>
            )}

            {/* GALLERY */}
            {tab === "gallery" && (
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))", gap: 10 }}>
                {(mod.gallery || []).map((img: any, i: number) => (
                  <img
                    key={i}
                    src={img.thumbnailUrl || img.url || img}
                    style={{
                      width: "100%",
                      borderRadius: 10,
                      border: "1px solid var(--color-border)",
                    }}
                  />
                ))}
              </div>
            )}

          </div>
        </div>
        </div>

        {/* RIGHT SIDEBAR */}

	<div
	  style={{
	    position: "relative",
	    width: 320,
	    flexShrink: 0,
	    background: "var(--color-surface)",
	    borderRadius: 12,
	    padding: 20,
	    border: "1px solid var(--color-border)",
	    height: "fit-content",
	  }}
	>

	{mod.type !== "modpack" && (
	  <div style={{ marginBottom: 16 }}>
	    <InstallToInstance
	      source={source}
	      projectId={projectId}
	      name={mod.title}
	      icon={mod.icon}
	      type={mod.type}
	      installable={mod.installable !== false}
	      url={mod.url}
	    />
	  </div>
	)}

	<h3>
	Compatibility
	</h3>

	<p style={{ color: "var(--color-text-muted)" }}>
	Minecraft Versions
	</p>

	<p>
	{mod.minecraftVersions?.join(", ") || "Unknown"}
	</p>

	<p
	style={{
	marginTop:16,
	color:"var(--color-text-muted)"
	}}
	>
	Loaders
	</p>

	<p>
	{mod.type === "mod" || mod.type === "modpack"
	  ? mod.loaders?.join(", ") || "Unknown"
	  : "None needed"}
	</p>

	<hr
	style={{
	margin:"20px 0",
	borderColor:"var(--color-border)"
	}}
	/>

	<p><b>Downloads</b></p>
	<p>{mod.downloads?.toLocaleString()}</p>

	<p><b>Type</b></p>
	<p>{TYPE_LABELS[mod.type] ?? mod.type}</p>

	<p><b>Followers</b></p>
	<p>{mod.followers ?? "Unknown"}</p>

	<p><b>Created</b></p>
	<p>
        {mod.created
    	  ? new Date(mod.created).toLocaleDateString()
    	  : "Unknown"}
	</p>

	<p><b>Updated</b></p>

	<p>
	{mod.updated
   	  ? new Date(mod.updated).toLocaleDateString()
  	  : "Unknown"}
	</p>

	<p><b>Authors</b></p>

	<p>
	{mod.authors?.join(", ") || "Unknown"}
	</p>

	<p><b>Source</b></p>

	<p>
	{source === "curseforge"
	? "CurseForge"
	: "Modrinth"}
	</p>

	<p><b>Website</b></p>

	<a
	href={
          mod.website || mod.url || "#"
	}
	target="_blank"
	style={{
	color:"var(--color-info-text)"
	}}
	>
	Open Project
	</a>

	</div>

      </div>
    </div>
  );
}

export default ModDescription;