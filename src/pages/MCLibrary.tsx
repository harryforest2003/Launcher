import logo from "../assets/logo.png";
import { useEffect, useState } from "react";
import Sidebar from "../components/MCSidebar";
import InstanceDetail from "./InstanceDetail";

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

function Library({
  onBack,
  goHome,
  goMinecraft,
  goDiscover,
  goLibrary,
  goSkinSelector,
  goCreateInstance,
  goSettings,
}: Props) {
  const [search, setSearch] = useState("");
  const [storageUsed, setStorageUsed] = useState(0);
  const [instances, setInstances] = useState<any[]>([]);

  const [selected, setSelected] = useState<string | null>(null);

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
          goCreateInstance={goCreateInstance}
          goSettings={goSettings}
          showBack
          onBack={onBack}
        />

        <InstanceDetail
          instanceName={selected}
          onBack={() => {
            setSelected(null);
            loadInstances();
          }}
        />
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
          Instance Library
        </h1>

        <p
          style={{
            color: "#9ca3af",
            marginBottom: "30px",
          }}
        >
          Manage every Minecraft instance in one place.
        </p>

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
            onClick={goCreateInstance}
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

          <select className="sidebar-button">
            <option>Sort by Name</option>
            <option>Last Played</option>
            <option>Version</option>
            <option>Recently Added</option>
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
                • Vanilla
                <br />
                • Fabric
                <br />
                • Forge
                <br />
                • NeoForge
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
        </div>
      </div>
    </div>
  );
}

export default Library;