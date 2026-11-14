import { useEffect, useId, useState } from "react";
import { UserRound } from "lucide-react";
import Monogram from "./ui/Monogram";
import Select from "./ui/Select";
import { ACCOUNTS_EVENT, watchAccountChanges } from "./ui/accountsSignal";
import "./accountSwitcher.css";

type Props = {
  /** Smaller, for the sidebar. */
  compact?: boolean;
  /** Only the picture (the folded sidebar): the list opens from it. */
  rail?: boolean;
  /**
   * The game being viewed. Minecraft (or none) shows the Microsoft accounts; another game
   * shows how it signs in instead (the Steam app's player, or the app that handles it).
   */
  game?: GameId | "minecraft" | null;
};

const ADD = "__add__";

const message = (err: unknown) =>
  (err instanceof Error ? err.message : String(err)).replace(/^Error invoking remote method '[^']+': (Error: )?/, "");

/*
 * Who the game launches as, and switching between signed-in Microsoft accounts, or
 * adding another (Microsoft asks which account to use).
 */
/*
 * A game that signs in through the app it came from: the Steam app's player, or a plain
 * line saying where sign-in happens. Never asks for a password.
 */
function StoreAccount({ game, compact, rail }: { game: GameId; compact: boolean; rail: boolean }) {
  const [account, setAccount] = useState<{ game: GameId; info: GameStoreAccount } | null>(null);

  useEffect(() => {
    let live = true;
    const look = () =>
      Promise.resolve(window.gamesAPI?.account?.(game))
        .then((info) => live && info && setAccount({ game, info }))
        .catch(() => {});
    look();
    // Signing in or out in the Steam app happens elsewhere: look again on coming back.
    window.addEventListener("focus", look);
    return () => {
      live = false;
      window.removeEventListener("focus", look);
    };
  }, [game]);

  const info = account?.game === game ? account.info : null;
  const who = info?.name ?? (info?.store === "steam" ? "Not signed in" : info?.storeName ?? "");
  const label = info?.storeName ? (info.store === "steam" ? "Steam account" : `Signs in with the ${info.storeName}`) : "Sign-in";
  const avatar = <Monogram name={info?.name ?? info?.storeName ?? ""} icon={info?.name ? undefined : <UserRound size={16} />} size={28} />;

  if (rail) {
    return (
      <div data-testid="account-switcher" className="ui-account ui-account--rail" data-tip={info ? `${label}${info.name ? `: ${info.name}` : ""}. ${info.how}` : label}>
        {avatar}
      </div>
    );
  }

  return (
    <div data-testid="account-switcher" className="ui-account" data-store={info?.store ?? "none"}>
      {compact && <span className="ui-account__label">{label}</span>}
      <div className="ui-account__row">
        {compact && avatar}
        {who && <strong className="ui-account__name">{who}</strong>}
      </div>
      {info && <div className="ui-account__note">{info.how}</div>}
    </div>
  );
}

export default function AccountSwitcher({ compact = false, rail = false, game }: Props) {
  if (game && game !== "minecraft") return <StoreAccount game={game} compact={compact} rail={rail} />;
  return <MicrosoftAccounts compact={compact} rail={rail} inMinecraft={game === "minecraft"} />;
}

/* Minecraft's Microsoft accounts: who the game launches as, and switching or adding one. */
function MicrosoftAccounts({ compact, rail, inMinecraft }: { compact: boolean; rail: boolean; inMinecraft: boolean }) {
  const [accounts, setAccounts] = useState<MinecraftAccount[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const selectId = useId();

  useEffect(() => {
    const refresh = () => {
      window.instanceAPI.listAccounts().then(setAccounts).catch(() => {});
    };
    refresh();
    watchAccountChanges();
    window.addEventListener(ACCOUNTS_EVENT, refresh);
    window.addEventListener("focus", refresh);
    const stop = typeof window.instanceAPI.onAccountsChanged === "function" ? window.instanceAPI.onAccountsChanged(setAccounts) : undefined;
    return () => {
      window.removeEventListener(ACCOUNTS_EVENT, refresh);
      window.removeEventListener("focus", refresh);
      if (typeof stop === "function") stop();
    };
  }, []);

  const active = accounts.find((account) => account.active);

  async function choose(value: string) {
    setBusy(true);
    setError(null);
    try {
      if (value === ADD) {
        await window.launcherAPI.loginMicrosoft();
        setAccounts(await window.instanceAPI.listAccounts());
      } else {
        setAccounts(await window.instanceAPI.switchAccount(value));
      }
    } catch (err) {
      setError(message(err));
    }
    setBusy(false);
  }

  const options = (
    <>
      {!active && <option value="">{busy ? "Signing in..." : "Not signed in"}</option>}
      {accounts.map((account) => (
        <option key={account.uuid} value={account.uuid}>
          {account.name}
        </option>
      ))}
      <option value={ADD}>{accounts.length ? "Add another account..." : "Sign in with Microsoft..."}</option>
    </>
  );
  const avatar = <Monogram name={active?.name ?? ""} icon={active ? undefined : <UserRound size={16} />} size={28} />;

  // Folded sidebar: the picture, with the list laid invisibly over it so a click opens it.
  if (rail) {
    return (
      <div data-testid="account-switcher" className="ui-account ui-account--rail" data-tip={active ? `Playing as ${active.name}` : "Not signed in"}>
        {avatar}
        <select
          className="ui-account__overlay"
          aria-label={active ? `Playing as ${active.name}. Switch account` : "Minecraft account: not signed in"}
          value={active?.uuid ?? ""}
          disabled={busy}
          onChange={(e) => choose(e.target.value)}
        >
          {options}
        </select>
      </div>
    );
  }

  return (
    <div data-testid="account-switcher" className="ui-account">
      {compact && (
        <label className="ui-account__label" htmlFor={selectId}>
          {inMinecraft ? "Playing as" : "Minecraft account"}
        </label>
      )}
      <div className="ui-account__row">
        {compact && avatar}
        <Select
          id={selectId}
          aria-label={compact ? undefined : "Minecraft account"}
          size={compact ? "sm" : "md"}
          wrapperClassName="ui-account__select"
          style={{ width: "100%" }}
          value={active?.uuid ?? ""}
          disabled={busy}
          onChange={(e) => choose(e.target.value)}
        >
          {options}
        </Select>
      </div>
      {busy && <div className="ui-account__note">Finish signing in in your browser.</div>}
      {error && (
        <div role="alert" className="ui-account__error">
          {error}
        </div>
      )}
    </div>
  );
}
