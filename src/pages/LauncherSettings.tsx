import { useEffect, useState } from "react";
import {
  Box,
  Disc3,
  Gamepad2,
  KeyRound,
  Palette,
  Sparkles,
  Star,
  SunMoon,
  Eye,
  BookOpenText,
  Type,
  UserRound,
  Zap,
  type LucideIcon,
} from "lucide-react";
import BackgroundLogo from "../components/BackgroundLogo";
import ApiKeyRow from "../components/ApiKeyRow";
import LauncherSidebar from "../components/LauncherSidebar";
import Button from "../components/ui/Button";
import Notice from "../components/ui/Notice";
import SettingsLayout, { SettingsHeader } from "../components/SettingsLayout";
import AppearanceSettings from "../theme/AppearanceSettings";
import AccountSwitcher from "../components/AccountSwitcher";
import { PLATFORMS } from "../components/platformAccountsData";
import "../theme/appearance.css";

type Props = {
  onHome: () => void;
  onModManager: () => void;
  /** Opens Minecraft's own settings (Java, memory, accounts). Without it, the page says where they are. */
  onMinecraftSettings?: () => void;
};

const PLATFORM_ICONS: Record<string, LucideIcon> = {
  steam: Gamepad2,
  ea: Sparkles,
  epic: Zap,
  gog: Disc3,
  rockstar: Star,
};

function AccountName({ icon: Icon, name, children }: { icon: LucideIcon; name: string; children: string }) {
  return (
    <div className="set-account-main">
      <span className="set-account-icon" aria-hidden="true">
        <Icon size={18} />
      </span>
      <div>
        <h3>{name}</h3>
        <p>{children}</p>
      </div>
    </div>
  );
}

/* Short button, full wording in its tooltip and aria-label. */
function AccountLink({ provider, name }: { provider: NonNullable<GameStoreAccount["store"]>; name: string }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [opened, setOpened] = useState(false);
  const full = provider === "steam" ? "Open Steam to sign in or switch" : `Sign in on ${name} website`;
  async function open() {
    setBusy(true);
    setError(null);
    setOpened(false);
    try {
      if (!window.gamesAPI.openAccount) throw new Error("Restart the updated desktop launcher to use account links.");
      await window.gamesAPI.openAccount(provider);
      setOpened(true);
    } catch (err) {
      setError((err instanceof Error ? err.message : String(err)).replace(/^Error invoking remote method '[^']+': (Error: )?/, ""));
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="ui-account__action" aria-busy={busy}>
      <Button size="sm" disabled={busy} onClick={open} title={full} aria-label={error ? `Retry: ${full}` : full}>
        {busy ? "Opening…" : error ? "Retry" : provider === "steam" ? "Open" : "Sign in"}
      </Button>
      {opened && (
        <p className="ui-account__note" role="status">
          {provider === "steam"
            ? "Steam open request sent. Finish sign-in or switching in Steam, then refresh your profile here."
            : "Account page open request sent. Game sign-in is managed separately in the platform’s launcher."}
        </p>
      )}
      {error && (
        <p className="ui-account__error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

/* The Game accounts section: the section heading names it, so the rows start straight away. */
function GameAccounts({ onMinecraftSettings }: { onMinecraftSettings?: () => void }) {
  return (
    <div id="platform-accounts" className="set-stack">
      <p className="set-lead" style={{ marginTop: 0 }}>
        Minecraft uses your selected Microsoft account. Other games use the account in their own platform launcher.
        {onMinecraftSettings ? (
          <>
            {" "}Memory, Java and starter mods are in{" "}
            <button type="button" className="set-textlink" onClick={onMinecraftSettings}>
              Minecraft settings
            </button>
            .
          </>
        ) : (
          " Memory, Java and starter mods are in Minecraft, under Settings."
        )}
      </p>
      <div className="ui-panel set-panel">
        <div className="platform-account-row">
          <AccountName icon={Box} name="Minecraft · Microsoft">
            Choose the account used to launch Minecraft.
          </AccountName>
          <div className="set-frow-ctl">
            <AccountSwitcher />
          </div>
        </div>
        {PLATFORMS.map(({ id, name }) => (
          <div key={id} className="platform-account-row">
            <AccountName icon={PLATFORM_ICONS[id] ?? UserRound} name={name}>
              {id === "steam"
                ? "Sign in and switch players in the Steam app. Steam games use that client’s account."
                : `Manage your ${name} account on its official website; sign in to its desktop launcher to play.`}
            </AccountName>
            <AccountLink provider={id} name={name} />
          </div>
        ))}
        <div className="platform-account-row">
          <p>
            The Sims 4 on Steam also uses a linked EA account.{" "}
            <a href="https://help.ea.com/en/articles/ea-account/ea-account-linking/" target="_blank" rel="noopener noreferrer">
              EA’s account-linking guide ↗
            </a>
          </p>
        </div>
      </div>
    </div>
  );
}

/* Settings for the launcher as a whole, rather than for one game. */
export default function LauncherSettings({
  onHome,
  onModManager,
  onMinecraftSettings,
}: Props) {
  const [apiKeys, setApiKeys] = useState<Awaited<
    ReturnType<typeof window.instanceAPI.getApiKeys>
  > | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    window.instanceAPI
      .getApiKeys()
      .then(setApiKeys)
      .catch((err) =>
        setError(err instanceof Error ? err.message : String(err)),
      );
  }, []);

  const added = apiKeys
    ? (["modrinth", "nexus", "github", "modio", "steam", "factorio"] as const).filter(
        (key) => apiKeys[key]?.set,
      ).length
    : 0;

  const keysSection = (
    <section id="api-tokens" aria-label="Keys for mod sites" className="page-section">
      <div className="set-pane-head set-pane-head--end">
        {apiKeys && (
          <span className="set-count" style={{ marginRight: 0 }}>
            <strong>{added}</strong> of 6 added
          </span>
        )}
      </div>
      <div className="ui-panel set-panel" data-testid="personal-tokens">
        <div className="set-panel-head">
          <p className="set-lead" style={{ marginTop: 0 }}>
            Keys from your own accounts. The launcher works without them; each
            one adds something. They're locked with your computer's keychain and
            only ever sent to the site they belong to.
          </p>
        </div>

        <div className="set-rows">
          <div id="token-modrinth" className="page-section-anchor">
            <ApiKeyRow
              name="modrinth"
              label="Modrinth"
              environmentVariable="MODRINTH_TOKEN"
              status={apiKeys?.modrinth}
              onChange={setApiKeys}
            >
              Lets the launcher see your own unlisted and draft projects.
              Browsing and installing don't need it. Create one at
              modrinth.com/settings/pats.
            </ApiKeyRow>
          </div>

          <div id="token-nexus" className="page-section-anchor">
            <ApiKeyRow
              name="nexus"
              label="Nexus Mods"
              environmentVariable="NEXUS_API_KEY"
              status={apiKeys?.nexus}
              onChange={setApiKeys}
            >
              Needed to browse Nexus Mods in the Mod Manager. Find yours on
              nexusmods.com, in your account's API Keys settings.
            </ApiKeyRow>
          </div>

          <div id="token-github" className="page-section-anchor">
            <ApiKeyRow
              name="github"
              label="GitHub"
              environmentVariable="GITHUB_TOKEN"
              status={apiKeys?.github}
              onChange={setApiKeys}
            >
              Installs from GitHub allow 60 lookups an hour without one, and
              5,000 with one. Create one at github.com/settings/tokens; it needs
              no permissions.
            </ApiKeyRow>
          </div>

          <div id="token-modio" className="page-section-anchor">
            <ApiKeyRow
              name="modio"
              label="mod.io"
              environmentVariable="MODIO_API_KEY"
              status={apiKeys?.modio}
              onChange={setApiKeys}
            >
              Lets the launcher browse and install mods from mod.io for the
              games that use it. Get a read-only API key at mod.io, in your
              account's API access settings.
            </ApiKeyRow>
          </div>

          <div id="token-steam" className="page-section-anchor">
            <ApiKeyRow
              name="steam"
              label="Steam Web API"
              environmentVariable="STEAM_WEB_API_KEY"
              status={apiKeys?.steam}
              onChange={setApiKeys}
            >
              Lets the launcher search the Steam Workshop. Installing still
              happens in Steam: you press Subscribe there. Get a key at
              steamcommunity.com/dev/apikey.
            </ApiKeyRow>
          </div>

          <div id="token-factorio" className="page-section-anchor">
            <ApiKeyRow
              name="factorio"
              label="Factorio"
              environmentVariable="FACTORIO_TOKEN"
              status={apiKeys?.factorio}
              onChange={setApiKeys}
            >
              Lets the launcher search the Factorio Mod Portal and download its
              mods. Browsing works without it. Paste it as username:token, with
              the token from your profile on factorio.com.
            </ApiKeyRow>
          </div>
        </div>
      </div>
    </section>
  );

  return (
    <div className="app-screen">
      <LauncherSidebar
        current="settings"
        onHome={onHome}
        onModManager={onModManager}
        onSettings={() => {}}
      />

      <main className="app-main">
        <div className="app-logo-tint">
          <BackgroundLogo />
        </div>

        <div className="app-page">
          <SettingsHeader
            title="Settings"
            lead="How the launcher looks, your game accounts, and the keys it uses for mod sites."
          />

          {error && (
            <Notice
              tone="danger"
              style={{
                maxWidth: "var(--content-max)",
                marginBottom: "var(--space-6)",
              }}
            >
              {error}
            </Notice>
          )}

          <SettingsLayout
            label="Settings categories"
            categories={[
              {
                id: "appearance",
                label: "Colour",
                group: "Appearance",
                icon: <Palette size={16} aria-hidden="true" />,
                content: (
                  <div id="appearance">
                    <AppearanceSettings part="colour" />
                  </div>
                ),
              },
              {
                id: "appearance-mode",
                label: "Light or dark",
                icon: <SunMoon size={16} aria-hidden="true" />,
                content: <AppearanceSettings part="base" />,
              },
              {
                id: "appearance-readability",
                label: "Readability",
                icon: <Type size={16} aria-hidden="true" />,
                content: <AppearanceSettings part="readability" />,
              },
              {
                id: "appearance-vision",
                label: "Colour vision",
                group: "Accessibility",
                icon: <Eye size={16} aria-hidden="true" />,
                content: <AppearanceSettings part="vision" />,
              },
              {
                id: "appearance-reading",
                label: "Reading",
                icon: <BookOpenText size={16} aria-hidden="true" />,
                content: <AppearanceSettings part="reading" />,
              },
              {
                id: "platform-accounts",
                label: "Game accounts",
                group: "Connections",
                icon: <UserRound size={16} aria-hidden="true" />,
                content: <GameAccounts onMinecraftSettings={onMinecraftSettings} />,
              },
              {
                id: "api-tokens",
                label: "Mod site keys",
                icon: <KeyRound size={16} aria-hidden="true" />,
                content: keysSection,
              },
            ]}
          />
        </div>
      </main>
    </div>
  );
}
