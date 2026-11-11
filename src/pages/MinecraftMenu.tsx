import logo from "../assets/logo.png";
import AccountSwitcher from "../components/AccountSwitcher";
import Sidebar from "../components/MCSidebar";
import { useEffect, useRef, useState } from "react";
import SkinPreview from "../components/SkinPreview";

type Props = {
  onBack: () => void;

  goHome: () => void;
  goMinecraft: () => void;
  goDiscover: () => void;
  goLibrary: () => void;
  goSkinSelector: () => void;
  goSettings: () => void;
};

function MinecraftMenu({
  onBack,
  goHome,
  goMinecraft,
  goDiscover,
  goLibrary,
  goSkinSelector,
  goSettings,
}: Props) {
  const [account, setAccount] = useState<{
    loggedIn: boolean;
    username: string;
    uuid: string;
    skin?: string;
  } | null>(null);

  const [recentInstances, setRecentInstances] = useState<any[]>([]);

  const [signingIn, setSigningIn] = useState(false);
  const [signInError, setSignInError] = useState<string | null>(null);
  const signInAttempt = useRef(0);

  useEffect(() => {
    loadInstances();

    // Stays signed in between runs of the app.
    window.instanceAPI
      .getAccount()
      .then((saved) => {
        if (saved) {
          setAccount({
            loggedIn: true,
            username: saved.name,
            uuid: saved.uuid,
            skin: saved.skin ?? undefined,
          });
        }
      })
      .catch(() => {});

    // Switching accounts, from here or the sidebar, shows the one now active.
    return window.instanceAPI.onAccountsChanged((accounts) => {
      const active = accounts.find((entry) => entry.active);
      setAccount(active ? { loggedIn: true, username: active.name, uuid: active.uuid, skin: active.skin ?? undefined } : null);
    });
  }, []);

  async function loadInstances() {
    try {
      const instances = await window.launcherAPI?.getInstances?.();
      setRecentInstances(instances || []);
    } catch (err) {
      console.error("Failed to load instances:", err);
      setRecentInstances([]);
    }
  }

  async function handleMicrosoftLogin() {
    // Clicking again replaces a sign-in still waiting on a browser tab, whose failure
    // then no longer matters.
    signInAttempt.current += 1;
    const attempt = signInAttempt.current;

    setSigningIn(true);
    setSignInError(null);

    try {
      const user = await window.launcherAPI.loginMicrosoft();
      if (attempt !== signInAttempt.current) return;

      setAccount({
        loggedIn: true,
        username: user.name,
        uuid: user.uuid,
        skin: user.skin ?? undefined,
      });
    } catch (err) {
      if (attempt !== signInAttempt.current) return;

      const message = err instanceof Error ? err.message : "Microsoft sign-in failed.";
      setSignInError(message.replace(/^Error invoking remote method '[^']+': (Error: )?/, ""));
    }

    setSigningIn(false);
  }

  async function handleSignOut() {
    await window.instanceAPI.clearAccount();
    setAccount(null);
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
        currentPage="minecraft"
        goHome={goHome}
        goMinecraft={goMinecraft}
        goDiscover={goDiscover}
        goLibrary={goLibrary}
        goSkinSelector={goSkinSelector}
        goSettings={goSettings}
        showBack
        onBack={onBack}
      />

      {/* Main Content */}
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
            filter: "drop-shadow(0 0 40px rgba(168, 85, 247, 0.3))",
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
            // Padding inside the height, so the bottom of the page can be scrolled to.
            boxSizing: "border-box",
          }}
        >
          <h1
            style={{
              color: "#c084fc",
              fontSize: "2.2rem",
              lineHeight: 1,
              marginBottom: "15px",
            }}
          >
            Welcome back, {account?.loggedIn ? account.username : "Player"}!
          </h1>

          <p style={{ color: "#b0b0b0", marginBottom: "50px" }}>
            Jump straight back into your latest worlds.
          </p>

          <div
            style={{
              display: "flex",
              flexDirection: "column",
              width: "90%",
              gap: "15px",
            }}
          >
            {recentInstances.map((instance) => (
              <div
                key={instance.name}
                className="game-card"
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  padding: "16px 24px",
                  minHeight: "80px",
                }}
              >
                <div>
                  <h3
                    style={{
                      color: "#c084fc",
                      margin: 0,
                      marginBottom: "10px",
                    }}
                  >
                    {instance.name}
                  </h3>

                  <p style={{ color: "#b0b0b0" }}>
                    {instance.version}
                  </p>

                  <p
                    style={{
                      color: "#b0b0b0",
                      margin: 0,
                      fontSize: "0.95rem",
                    }}
                  >
                    Loader: {instance.loader}
                  </p>
                </div>

                <button
                  className="sidebar-button"
                  style={{
                    width: "140px",
                    minWidth: "140px",
                    margin: 0,
                  }}
                  onClick={async () => {
                    try {
                      await window.launcherAPI.launchInstance(instance.name);
                    } catch (err) {
                      console.error("Launch failed:", err);
                      alert(
                        err instanceof Error
                          ? err.message
                          : "Failed to launch instance."
                      );
                    }
                  }}
                >
                  Launch
                </button>
              </div>
            ))}
          </div>

          <div style={{ marginTop: "60px" }}>
            <h2 style={{ color: "#d8b4fe", marginBottom: "20px" }}>
              News
            </h2>

            <div className="game-card" style={{ minHeight: "180px" }}>
              <h3 style={{ color: "#c084fc" }}>Unity Launcher</h3>

              <p
                style={{
                  color: "#aaa",
                  marginTop: "15px",
                  lineHeight: "1.7",
                }}
              >
                This area can later display Minecraft news,
                launcher updates, featured modpacks,
                announcements and changelogs.
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* Right Sidebar */}
      <div
        style={{
          width: "300px",
          background: "#161616",
          borderLeft: "1px solid #6d28d9",
          padding: "20px",
          display: "flex",
          flexDirection: "column",
        }}
      >
        <h2 style={{ color: "#c084fc", marginBottom: "20px" }}>
          Microsoft Account
        </h2>

        {account?.loggedIn ? (
          <>
            <div style={{ marginBottom: "25px" }}>
              <AccountSwitcher />
            </div>

            <div
              style={{
                width: "220px",
                height: "320px",
                margin: "0 auto",
                background: "#232323",
                border: "1px solid #6d28d9",
                borderRadius: "18px",
                display: "flex",
                justifyContent: "center",
                alignItems: "center",
                color: "#888",
                marginBottom: "25px",
              }}
            >
              {account.skin ? (
                <SkinPreview skin={account.skin} size={218} height={318} fullBody still followCursor />
              ) : (
                "No skin"
              )}
            </div>

	    <div className="game-card">
	      <h3 style={{ color: "#c084fc", marginBottom: "10px" }}>
	        Account Details
	      </h3>

	      <p style={{ color: "#aaa", lineHeight: "1.6" }}>
	        Username:
	        <br />
	        {account.username}
	      </p>

	      <p
	        style={{
	          color: "#888",
	          fontSize: "0.85rem",
	          marginTop: "10px",
	          lineHeight: "1.5",
	          wordBreak: "break-all",
	        }}
	      >
	        UUID:
	        <br />
	        {account.uuid}
	      </p>

	      <button
	        className="sidebar-button"
	        style={{
	          width: "100%",
	          marginTop: "20px",
	        }}
	        onClick={handleSignOut}
	      >
	        Sign out
	      </button>
	    </div>
          </>
        ) : (
          <>
            <button
              className="sidebar-button"
              style={{
                width: "100%",
                marginBottom: signInError ? "12px" : "25px",
              }}
              onClick={handleMicrosoftLogin}
            >
              {signingIn ? "Waiting for your browser. Click to start again" : "Sign in with Microsoft"}
            </button>

            {signInError && (
              <div
                role="alert"
                data-testid="sign-in-error"
                style={{
                  marginBottom: "25px",
                  padding: "12px",
                  borderRadius: "10px",
                  background: "#2a0d0d",
                  border: "1px solid #ef4444",
                  color: "#fca5a5",
                  fontSize: "0.85rem",
                  lineHeight: "1.5",
                  wordBreak: "break-word",
                  userSelect: "text",
                }}
              >
                {signInError}
              </div>
            )}

            <div
              style={{
                width: "220px",
                height: "320px",
                margin: "0 auto",
                background: "#232323",
                border: "1px solid #6d28d9",
                borderRadius: "18px",
                display: "flex",
                justifyContent: "center",
                alignItems: "center",
                color: "#777",
                textAlign: "center",
                padding: "20px",
              }}
            >
              Sign in to preview your
              <br />
              Minecraft skin.
            </div>

            <div className="game-card" style={{ marginTop: "25px" }}>
              <h3 style={{ color: "#c084fc", marginBottom: "10px" }}>
                Quick Tip
              </h3>

              <p style={{ color: "#aaa", lineHeight: "1.6" }}>
                Once you've signed into your Microsoft account you'll be able
                to launch instances, synchronize skins, browse your library
                and manage multiple Minecraft accounts from here.
              </p>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

export default MinecraftMenu;