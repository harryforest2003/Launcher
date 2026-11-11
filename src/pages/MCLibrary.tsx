import BackgroundLogo from "../components/BackgroundLogo";
import { useEffect, useState } from "react";
import CreateInstancePanel from "../components/CreateInstancePanel";
import Sidebar from "../components/MCSidebar";
import InstanceDetail from "./InstanceDetail";

type Props = {
  onBack: () => void;

  goHome: () => void;
  goMinecraft: () => void;
  goDiscover: () => void;
  goLibrary: () => void;
  goSkinSelector: () => void;
  goSettings: () => void;
};

type Sort = "name" | "lastPlayed" | "version" | "added";

const LOADER_NAMES: Record<string, string> = {
  vanilla: "Vanilla",
  fabric: "Fabric",
  quilt: "Quilt",
  forge: "Forge",
  neoforge: "NeoForge",
};

// Newest Minecraft version first: 1.21.10 before 1.21.9, before 1.20.
const compareVersions = (a: string, b: string) => b.localeCompare(a, undefined, { numeric: true });

const SORTS: Record<Sort, (a: Instance, b: Instance) => number> = {
  name: (a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base", numeric: true }),
  lastPlayed: (a, b) => (b.lastPlayed ?? "").localeCompare(a.lastPlayed ?? ""),
  version: (a, b) => compareVersions(a.version, b.version) || a.name.localeCompare(b.name),
  added: (a, b) => (b.created ?? "").localeCompare(a.created ?? ""),
};

function Library({
  onBack,
  goHome,
  goMinecraft,
  goDiscover,
  goLibrary,
  goSkinSelector,
  goSettings,
}: Props) {
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState<Sort>("name");
  const [storageUsed, setStorageUsed] = useState(0);
  const [instances, setInstances] = useState<Instance[]>([]);

  const [selected, setSelected] = useState<string | null>(null);
  // Making or importing an instance takes over the list, under the same sidebar.
  const [creating, setCreating] = useState(false);

  async function loadInstances() {
    try {
      const data = await window.instanceAPI.list();
      setInstances(Array.isArray(data) ? data : []);
    } catch (err) {
      console.error("Failed to load instances:", err);
      setInstances([]);
    }
  }

  useEffect(() => {
    loadInstances();
  }, []);

  useEffect(() => {
      async function loadStorage() {
          const bytes = await window.launcherAPI.getInstancesStorage();
          setStorageUsed(bytes);
      }

      loadStorage();
  }, []);
  function formatBytes(bytes: number) {
      if (bytes === 0) return "0 B";

      const units = ["B", "KB", "MB", "GB", "TB"];
      const i = Math.floor(Math.log(bytes) / Math.log(1024));

      return `${(bytes / Math.pow(1024, i)).toFixed(1)} ${units[i]}`;
  }

  // Managing one instance takes over the content area, keeping the
  // sidebar in place.
  if (selected) {
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
          currentPage="library"
          goHome={goHome}
          goMinecraft={goMinecraft}
          goDiscover={goDiscover}
          goLibrary={goLibrary}
          goSkinSelector={goSkinSelector}
          goSettings={goSettings}
          showBack
          onBack={onBack}
        />

        <div style={{ flex: 1, minWidth: 0, position: "relative", overflow: "hidden", display: "flex" }}>
          <BackgroundLogo />
          <InstanceDetail
            instanceName={selected}
            onBack={() => {
              setSelected(null);
              loadInstances();
            }}
          />
        </div>
      </div>
    );
  }

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
        currentPage="library"
        goHome={goHome}
        goMinecraft={goMinecraft}
        goDiscover={goDiscover}
        goLibrary={goLibrary}
        goSkinSelector={goSkinSelector}
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
        <BackgroundLogo />

      <div
        style={{
          position: "relative",
          zIndex: 1,
          padding: "35px",
          height: "100%",
          overflowY: "auto",
          // Padding inside the height, so the bottom of the page can be scrolled to.
          boxSizing: "border-box",
        }}
      >
        <h1
          style={{
            color: "#c084fc",
            marginBottom: "10px",
          }}
        >
          {creating ? "New Instance" : "Instance Library"}
        </h1>

        <p
          style={{
            color: "#9ca3af",
            marginBottom: "30px",
          }}
        >
          {creating ? "Make a new instance, or bring one in from elsewhere." : "Manage every Minecraft instance in one place."}
        </p>

        {creating ? (
          <>
            <button className="sidebar-button" style={{ marginBottom: 25 }} onClick={() => setCreating(false)}>
              ← Back to Library
            </button>
            <CreateInstancePanel
              onCancel={() => setCreating(false)}
              onDone={() => {
                setCreating(false);
                loadInstances();
              }}
            />
          </>
        ) : (
        <>
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search instances..."
          style={{
            width: "100%",
            padding: "15px",
            borderRadius: "12px",
            border: "1px solid #6d28d9",
            background: "#1b1b1b",
            color: "white",
            fontSize: "16px",
            marginBottom: "30px",
            boxSizing: "border-box",
          }}
        />

        <div
          style={{
            display: "flex",
            gap: "20px",
            flexWrap: "wrap",
            marginBottom: "35px",
          }}
        >
          <button
            className="sidebar-button"
            style={{ background: "#7c3aed" }}
            onClick={() => setCreating(true)}
          >
            New Instance
          </button>

          <button
            className="sidebar-button"
            onClick={() => setCreating(true)}
            title="Import from another launcher, a folder, a zip or your cloud folder"
          >
            Import Instance
          </button>

          <button
            className="sidebar-button"
            onClick={loadInstances}
          >
            Refresh
          </button>

          <select
            className="sidebar-button"
            aria-label="Sort instances"
            value={sort}
            onChange={(e) => setSort(e.target.value as Sort)}
          >
            <option value="name">Sort by Name</option>
            <option value="lastPlayed">Last Played</option>
            <option value="version">Version</option>
            <option value="added">Recently Added</option>
          </select>
        </div>

        <div
          style={{
            display: "grid",
            gridTemplateColumns:
              "repeat(auto-fill,minmax(320px,1fr))",
            gap: "25px",
          }}
        >
          {instances
            .filter((instance) =>
              instance.name
                .toLowerCase()
                .includes(search.toLowerCase())
            )
            .sort(SORTS[sort])
            .map((instance) => (
              <div
                key={instance.name}
                className="game-card"
                style={{
                  display: "flex",
                  flexDirection: "column",
                }}
              >
                <div
                  style={{
                    width: "72px",
                    height: "72px",
                    borderRadius: "16px",
                    background: "#252525",
                    border: "1px solid #6d28d9",
                    marginBottom: "20px",
                  }}
                />

                <h3
                  style={{
                    color: "#c084fc",
                    marginBottom: "10px",
                  }}
                >
                  {instance.name}
                </h3>

                <p
                  style={{
                    color: "#b0b0b0",
                    marginBottom: "8px",
                  }}
                >
                  {instance.version}
                  {instance.loader && instance.loader !== "vanilla"
                    ? ` • ${instance.loader} ${instance.loaderVersion ?? ""}`
                    : " • Vanilla"}
                </p>

                <p
                  style={{
                    color: instance.installed ? "#888" : "#fcd34d",
                    marginBottom: "25px",
                  }}
                >
                  {!instance.installed
                    ? "Not fully installed"
                    : instance.lastPlayed
                    ? `Last played: ${new Date(instance.lastPlayed).toLocaleDateString()}`
                    : "Never played"}
                </p>

                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: "1fr 1fr",
                    gap: "10px",
                    marginTop: "auto",
                  }}
                >
                  <button
                    className="sidebar-button"
                    style={{ background: "#7c3aed" }}
                    onClick={async () => {
                      try {
                        await window.instanceAPI.launch(instance.name);
                        loadInstances();
                      } catch (err) {
                        alert(err instanceof Error ? err.message : String(err));
                      }
                    }}
                  >
                    Launch
                  </button>

                  <button
                    className="sidebar-button"
                    onClick={() => setSelected(instance.name)}
                  >
                    Manage
                  </button>

                  <button
                    className="sidebar-button"
                    onClick={() =>
                      window.instanceAPI.openFolder(instance.name).catch(() => {})
                    }
                  >
                    Folder
                  </button>

                  <button
                    className="sidebar-button"
                    style={{ background: "#7f1d1d" }}
                    onClick={async () => {
                      if (!confirm(`Delete instance "${instance.name}" and all its files?`)) return;
                      try {
                        await window.instanceAPI.remove(instance.name);
                        loadInstances();
                      } catch (err) {
                        alert(err instanceof Error ? err.message : String(err));
                      }
                    }}
                  >
                    Delete
                  </button>
                </div>
              </div>
            ))}
        </div>

        <div
          style={{
            marginTop: "45px",
          }}
        >
          <h2
            style={{
              color: "#d8b4fe",
              marginBottom: "20px",
            }}
          >
            Library Statistics
          </h2>

          <div
            style={{
              display: "grid",
              gridTemplateColumns:
                "repeat(auto-fit,minmax(220px,1fr))",
              gap: "20px",
            }}
          >
            <div className="game-card">
              <h3 style={{ color: "#c084fc" }}>
                Total Instances
              </h3>

              <h1
                style={{
                  color: "white",
                  fontSize: "42px",
                  marginTop: "15px",
                }}
              >
                {instances.length}
              </h1>
            </div>

            <div className="game-card">
              <h3 style={{ color: "#c084fc" }}>
                Installed Loaders
              </h3>

              <p
                style={{
                  marginTop: "15px",
                  color: "#aaa",
                  lineHeight: "1.8",
                }}
              >
                {instances.length === 0
                  ? "None yet"
                  : Object.entries(
                      instances.reduce<Record<string, number>>((counts, instance) => {
                        const loader = (instance.loader || "vanilla").toLowerCase();
                        counts[loader] = (counts[loader] ?? 0) + 1;
                        return counts;
                      }, {})
                    )
                      .sort(([, a], [, b]) => b - a)
                      .map(([loader, count]) => (
                        <span key={loader} style={{ display: "block" }}>
                          • {LOADER_NAMES[loader] ?? loader} ({count})
                        </span>
                      ))}
              </p>
            </div>

            <div className="game-card">
              <h3 style={{ color: "#c084fc" }}>
                Storage Used
              </h3>

              <h1
                style={{
                  color: "white",
                  fontSize: "42px",
                  marginTop: "15px",
                }}
              >
                {formatBytes(storageUsed)}
              </h1>
              </div>
            </div>
          </div>
        </>
        )}
        </div>
      </div>
    </div>
  );
}

export default Library;