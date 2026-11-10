import logo from "../assets/logo.png";
import { useEffect, useState } from "react";
import Sidebar from "../components/MCSidebar";
import SearchDropdown from "../components/SearchDropdown";
import ImportPanel from "../components/ImportPanel";

type Props = {
  onBack: () => void;

  goHome: () => void;
  goMinecraft: () => void;
  goDiscover: () => void;
  goLibrary: () => void;
  goSkinSelector: () => void;
  goCreateInstance: () => void;
  goSettings: () => void;
};

function CreateInstance({
  onBack,
  goHome,
  goMinecraft,
  goDiscover,
  goLibrary,
  goSkinSelector,
  goCreateInstance,
  goSettings,
}: Props) {
  const [ram, setRam] = useState(4);
  const [instanceName, setInstanceName] = useState("");
  const [version, setVersion] = useState("");
  // "" matches the "Select Loader" option. "Vanilla" (capitalised) matched no
  // option value, so the select rendered blank.
  const [loader, setLoader] = useState("");
  const [versions, setVersions] = useState<any[]>([]);
  const [loaders, setLoaders] = useState<any[]>([]);
  const [loaderVersions, setLoaderVersions] = useState<any[]>([]);
  const [loaderVersion, setLoaderVersion] = useState("");

  const [creating, setCreating] = useState(false);
  const [progress, setProgress] = useState<InstallProgress | null>(null);
  const [createError, setCreateError] = useState<string | null>(null);

  // Starter mods: the list from Settings, whether to add them, and what happened.
  const [starterList, setStarterList] = useState<StarterMod[]>([]);
  const [addStarter, setAddStarter] = useState(true);
  const [starterResult, setStarterResult] = useState<{ name: string; version: string; summary: StarterSummary } | null>(null);

  useEffect(() => {
    window.instanceAPI.starterModsList().then(setStarterList).catch(() => {});
  }, []);

  // Mods need a loader; resource packs and the like don't.
  const hasLoader = loader !== "" && loader !== "vanilla";
  const starterCount = starterList.filter((entry) => entry.enabled && (hasLoader || entry.type !== "mod")).length;

  // Live install progress from the main process.
  useEffect(() => {
    return window.instanceAPI.onProgress(setProgress);
  }, []);

  useEffect(() => {
    async function load() {
        const data = await window.launcherAPI.getLoaders();

        console.log("Loaders:", data);

        setLoaders(data);
    }

    load();
  }, []);

  useEffect(() => {
    async function loadVersions() {
      const data = await window.launcherAPI.getMinecraftVersions();
      
      console.log("Minecraft versions:", data);

      setVersions(data);
    }

    loadVersions();
  }, []);
  useEffect(() => {
    async function loadLoaderVersions() {
      console.log("Selected MC Version:", version);
      console.log("Selected Loader:", loader);
      if (!loader || !version) {
        setLoaderVersions([]);
        return;
      }
      
      switch (loader) {
        case "fabric":
          const data = await window.launcherAPI.getFabricVersions(version);
          console.log("Fabric API returned:", data);
          setLoaderVersions(data);
          break;

        case "quilt":
          setLoaderVersions(
            await window.launcherAPI.getQuiltVersions(version)
          );
          break;

        case "forge":
          setLoaderVersions(
            await window.launcherAPI.getForgeVersions(version)
          );
          break;

        case "neoforge":
          setLoaderVersions(
            await window.launcherAPI.getNeoForgeVersions(version)
          );
          break;

        default:
          setLoaderVersions([]);
      }
    }

  loadLoaderVersions();
}, [loader, version]);
  return (
    <div
      style={{
        display: "flex",
        height: "100vh",
        background: "#0d0d0d",
        color: "white",
        fontFamily: "'Orbitron', sans-serif",
      }}
    >
      <Sidebar
        currentPage="create"
        goHome={goHome}
        goMinecraft={goMinecraft}
        goDiscover={goDiscover}
        goLibrary={goLibrary}
        goSkinSelector={goSkinSelector}
        goCreateInstance={goCreateInstance}
        goSettings={goSettings}
        showBack
        onBack={onBack}
      />

      <div
        style={{
        flex: 1,
        position: "relative",
        overflow: "hidden",
        }}
      >
        <img
          src={logo}
          alt="Launcher Logo"
          style={{
          position: "absolute",
          top: "45%",
          left: "55%",
          transform: "translate(-50%, -50%) rotate(-18deg)",
          width: "90%",
          maxWidth: "1400px",
          opacity: 0.12,
          filter:
            "drop-shadow(0 0 40px rgba(168, 85, 247, 0.3))",
          pointerEvents: "none",
          zIndex: 0,
        }}
      />

      <div
        style={{
          position: "relative",
          zIndex: 1,
          padding: "35px",
          height: "100%",
          overflowY: "auto",
        }}
      >
        <h1
          style={{
            color: "#c084fc",
            marginBottom: "10px",
          }}
        >
          Create New Instance
        </h1>

        <p
          style={{
            color: "#9ca3af",
            marginBottom: "35px",
          }}
        >
          Configure your Minecraft installation.
        </p>
	<div
	  className="game-card"
	  style={{
	    maxWidth: "1000px",
	    marginBottom: "25px",
	  }}
	>
	  <h2
	    style={{
	      color: "#d8b4fe",
	      marginBottom: "20px",
	    }}
	  >
	    Import Existing Instance
	  </h2>

	  <p
	    style={{
	      color: "#9ca3af",
	      marginBottom: "20px",
	      lineHeight: "1.7",
	    }}
	  >
	    Import Minecraft instances from other launchers,
	    backups, ZIP files or cloud storage.
	  </p>

	  <ImportPanel onImported={() => onBack()} />
	</div>
        <div
          className="game-card"
          style={{
            maxWidth: "1000px",
            marginBottom: "200px",
          }}
        >
          <h2
            style={{
              color: "#d8b4fe",
              marginBottom: "25px",
            }}
          >
            Create New Instance
          </h2>

          <div
            style={{
              display: "flex",
              flexDirection: "column",
              gap: "20px",
            }}
          >
            <input
              value={instanceName} 
              onChange={(e) => setInstanceName(e.target.value)}
	      placeholder="Instance Name"
              style={{
                padding: "15px",
                borderRadius: "10px",
                border: "1px solid #6d28d9",
                background: "#1a1a1a",
                color: "white",
                fontSize: "15px",
              }}
            />

            <SearchDropdown
  	      value={version}
  	      onChange={setVersion}
 	      placeholder="Search Minecraft version..."
 	      options={versions.map((v: any) => ({
    		value: v.id,
    		label: v.id,
	      }))}
	    />

            <select
              className="sidebar-button"
              style={{ width: "100%" }}
              value={loader}
              onChange={(e) => setLoader(e.target.value)}
            >
              <option value="">Select Loader</option>
              {loaders.map((loader: any) => (
                <option key={loader.id} value={loader.id}>
                  {loader.name}
                </option>
              ))}
            </select>

	    <select
	      className="sidebar-button"
	      style={{ width: "100%" }}
	      value={loaderVersion}
	      onChange={(e) => setLoaderVersion(e.target.value)}
	      disabled={loader === "" || loader === "vanilla"}
	    >
	      <option value="">Latest</option>

	      {loaderVersions.map((v: any) => (
	        <option
	          key={v.version || v.loader?.version || v.version_number}
	          value={v.version || v.loader?.version || v.version_number}
  	        >
	          {v.version || v.loader?.version || v.version_number}
	        </option>
	      ))}
	    </select>

            <select
              className="sidebar-button"
              style={{ width: "100%" }}
            >
              <option>Java Version</option>
              <option>Auto Detect</option>
              <option>Java 17</option>
              <option>Java 21</option>
            </select>

            <div>
              <p
                style={{
                  color: "#d8b4fe",
                  marginBottom: "10px",
                }}
              >
                Instance Icon
              </p>

              <div
                style={{
                  display: "flex",
                  gap: "15px",
                  alignItems: "center",
                }}
              >
                <div
                  style={{
                    width: "72px",
                    height: "72px",
                    borderRadius: "16px",
                    background: "#252525",
                    border: "1px solid #6d28d9",
                  }}
                />

                <button className="sidebar-button">
                  Choose Icon
                </button>
              </div>
            </div>

            <hr
              style={{
                border: "none",
                borderTop: "1px solid #333",
                margin: "15px 0",
              }}
            />

            <h2
              style={{
                color: "#d8b4fe",
                marginBottom: "10px",
              }}
            >
              Advanced
            </h2>

            <div>
              <p style={{ color: "#d8b4fe", marginBottom: "10px" }}>
                Allocated RAM: {ram} GB
              </p>

              <input
                type="range"
                min={1}
                max={32}
                step={1}
                value={ram}
                onChange={(e) => setRam(Number(e.target.value))}
                style={{ width: "100%", accentColor: "#7c3aed" }}
              />
            </div>

            <input
              placeholder="Game Directory (optional)"
              style={{
                padding: "15px",
                borderRadius: "10px",
                border: "1px solid #6d28d9",
                background: "#1a1a1a",
                color: "white",
                fontSize: "15px",
              }}
            />

            <textarea
              rows={5}
              placeholder="Additional JVM Arguments"
              style={{
                resize: "vertical",
                padding: "15px",
                borderRadius: "10px",
                border: "1px solid #6d28d9",
                background: "#1a1a1a",
                color: "white",
                fontSize: "15px",
              }}
            />

            <label
              data-testid="starter-toggle"
              style={{
                display: "flex",
                alignItems: "center",
                gap: "10px",
                color: "#d1d5db",
              }}
            >
              <input
                type="checkbox"
                checked={addStarter && starterCount > 0}
                disabled={starterCount === 0}
                onChange={(event) => setAddStarter(event.target.checked)}
              />
              <span>
                Add starter mods ({starterCount})
                <span style={{ color: "#6b7280", fontSize: 12 }}>
                  {!hasLoader && starterList.some((entry) => entry.enabled && entry.type === "mod")
                    ? " · mods need a mod loader, so only packs are added"
                    : " · choose which in Settings"}
                </span>
              </span>
            </label>

            <label
              style={{
                display: "flex",
                alignItems: "center",
                gap: "10px",
                color: "#d1d5db",
              }}
            >
              <input type="checkbox" />
              Enable Snapshots
            </label>

            <label
              style={{
                display: "flex",
                alignItems: "center",
                gap: "10px",
                color: "#d1d5db",
              }}
            >
              <input type="checkbox" />
              Separate Game Directory
            </label>

            <label
              style={{
                display: "flex",
                alignItems: "center",
                gap: "10px",
                color: "#d1d5db",
              }}
            >
              <input type="checkbox" />
              Show Console While Running
            </label>

            <div
              style={{
                display: "flex",
                justifyContent: "flex-end",
                gap: "15px",
                marginTop: "20px",
              }}
            >
              <button
                className="sidebar-button"
                onClick={onBack}
              >
                Cancel
              </button>

              <button
                className="sidebar-button"
                style={{
                  background: "#7c3aed",
                }}
                disabled={creating}
                onClick={async () => {
                  const name = instanceName.trim();

                  if (!name) {
                    setCreateError("Give the instance a name first.");
                    return;
                  }

                  if (!version) {
                    setCreateError("Pick a Minecraft version first.");
                    return;
                  }

                  setCreating(true);
                  setCreateError(null);
                  setProgress(null);
                  setStarterResult(null);

                  try {
                    // Leaving loaderVersion empty makes the backend pick
                    // the latest build compatible with this MC version.
                    const created = await window.instanceAPI.create({
                      name,
                      version,
                      loader: loader || "vanilla",
                      loaderVersion,
                      ram,
                      starterMods: addStarter && starterCount > 0,
                    });

                    // Stay to say how the starter mods went; otherwise there's nothing to add.
                    if (created.starter) {
                      setStarterResult({ name: created.name, version: created.version, summary: created.starter });
                    } else {
                      onBack();
                    }
                  } catch (err) {
                    console.error("Instance creation failed:", err);
                    setCreateError(
                      err instanceof Error
                        ? err.message
                        : "Instance creation failed."
                    );
                  }

                  setCreating(false);
                }}
              >
                {creating ? "Installing..." : "Create Instance"}
              </button>
	      </div>

            {createError && (
              <div
                style={{
                  background: "#2a0d0d",
                  border: "1px solid #ef4444",
                  borderRadius: 12,
                  padding: 15,
                  color: "#fca5a5",
                  whiteSpace: "pre-wrap",
                }}
              >
                {createError}
              </div>
            )}

            {starterResult && (
              <div
                data-testid="starter-result"
                style={{
                  background: "#1a1a1a",
                  border: "1px solid #6d28d9",
                  borderRadius: 12,
                  padding: 15,
                  color: "#d4d4d8",
                  fontSize: 14,
                  display: "flex",
                  flexDirection: "column",
                  gap: 8,
                }}
              >
                <div style={{ color: "#86efac" }}>
                  Made {starterResult.name}. Added {starterResult.summary.added.length} starter
                  {starterResult.summary.added.length === 1 ? " mod" : " mods"}
                  {starterResult.summary.dependencies.length
                    ? `, plus ${starterResult.summary.dependencies.length} they need`
                    : ""}
                  .
                </div>

                {starterResult.summary.unavailable.length > 0 && (
                  <div>
                    <span style={{ color: "#fcd34d" }}>
                      No build for Minecraft {starterResult.version} yet, so skipped:
                    </span>{" "}
                    {starterResult.summary.unavailable.join(", ")}
                  </div>
                )}

                {starterResult.summary.failed.length > 0 && (
                  <div style={{ color: "#fca5a5" }}>
                    Couldn't add:{" "}
                    {starterResult.summary.failed.map((item) => `${item.name} (${item.reason})`).join("; ")}
                  </div>
                )}

                <div style={{ display: "flex", justifyContent: "flex-end" }}>
                  <button className="sidebar-button" style={{ background: "#7c3aed" }} onClick={onBack}>
                    Done
                  </button>
                </div>
              </div>
            )}

            {creating && progress && (
              <div
                style={{
                  background: "#1a1a1a",
                  border: "1px solid #6d28d9",
                  borderRadius: 12,
                  padding: 15,
                }}
              >
                <div style={{ color: "#d8b4fe", marginBottom: 10 }}>
                  {progress.detail ?? progress.stage} ({progress.percent}%)
                </div>

                <div
                  style={{
                    height: 8,
                    background: "#333",
                    borderRadius: 4,
                    overflow: "hidden",
                  }}
                >
                  <div
                    style={{
                      width: `${progress.percent}%`,
                      height: "100%",
                      background: "#7c3aed",
                      transition: "width .2s",
                    }}
                  />
                </div>

                <div style={{ color: "#6b7280", fontSize: 12, marginTop: 8 }}>
                  {progress.stage === "starter"
                    ? "Adding your starter mods and what they need."
                    : "Downloading Minecraft, libraries and assets. The first install of a version takes a few minutes."}
                </div>
              </div>
            )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export default CreateInstance;