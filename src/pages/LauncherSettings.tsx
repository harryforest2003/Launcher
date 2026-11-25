import { useEffect, useState } from "react";
import {
  Box,
  Disc3,
  Gamepad2,
  KeyRound,
  MessageCircle,
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
import ModSiteList from "../components/ModSiteList";
import LauncherSidebar from "../components/LauncherSidebar";
import Button from "../components/ui/Button";
import Notice from "../components/ui/Notice";
import SettingsLayout, { SettingsHeader } from "../components/SettingsLayout";
import AppearanceSettings from "../theme/AppearanceSettings";
import AccountSwitcher from "../components/AccountSwitcher";
import { DiscordStatusSection } from "../components/DiscordStatusSettings";
import DisplaySettings from "../components/DisplaySettings";
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

  const keysSection = <ModSiteList apiKeys={apiKeys} onChange={setApiKeys} />;

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
            lead="How the launcher looks, your game accounts, and the mod sites Discover uses."
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
                id: "display",
                label: "Big screen",
                icon: <Gamepad2 size={16} aria-hidden="true" />,
                content: <DisplaySettings />,
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
                label: "Mod sites",
                icon: <KeyRound size={16} aria-hidden="true" />,
                content: keysSection,
              },
              {
                id: "discord-status",
                label: "Discord status",
                icon: <MessageCircle size={16} aria-hidden="true" />,
                content: <DiscordStatusSection />,
              },
            ]}
          />
        </div>
      </main>
    </div>
  );
}
