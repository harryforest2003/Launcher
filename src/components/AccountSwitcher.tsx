import { useEffect, useId, useState } from "react";
import { UserRound } from "lucide-react";
import Monogram from "./ui/Monogram";
import Select from "./ui/Select";
import Button from "./ui/Button";
import PlatformAccountAction from "./PlatformAccountAction";
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

  const [refreshCount, setRefreshCount] = useState(0);
  const [checking, setChecking] = useState(true);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    let request = 0;
    const look = async () => {
      const current = ++request;
      setChecking(true);
      setError(null);
      try {
        const info = await window.gamesAPI.account(game);
        if (live && current === request) setAccount({ game, info });
      } catch (err) {
        if (live && current === request) setError(message(err));
      } finally {
        if (live && current === request) setChecking(false);
      }
    };
    void look();
    window.addEventListener("focus", look);
    return () => { live = false; window.removeEventListener("focus", look); };
  }, [game, refreshCount]);

  const info = account?.game === game ? account.info : null;
  const who = info?.name ?? (info?.store === "steam" ? "No local profile found" : info?.storeName ?? "");
  const label = info?.storeName ? (info.store === "steam" ? "Last-used Steam profile" : `Signs in with the ${info.storeName}`) : "Sign-in";
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
      {checking && <div className="ui-account__note" role="status">Checking account information…</div>}
      {info && <div className="ui-account__note">{info.how}</div>}
      {info?.store && <PlatformAccountAction key={`${game}:${info.store}`} provider={info.store} />}
      {game === "sims4" && info?.store === "steam" && <p className="ui-account__note">The Sims 4 also uses your linked EA account.</p>}
      {error && <div role="alert" className="ui-account__error">Couldn’t check the account: {error}</div>}
      <Button size="sm" variant="ghost" disabled={checking} onClick={() => setRefreshCount((value) => value + 1)}>{error ? "Retry account check" : "Refresh account"}</Button>
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
  const [operation, setOperation] = useState<"signin" | "switch" | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const selectId = useId();

  const [loadError, setLoadError] = useState<string | null>(null);
  const [refreshCount, setRefreshCount] = useState(0);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    let live = true;
    let request = 0;
    const refresh = async () => {
      const current = ++request;
      setLoading(true);
      try {
        const next = await window.instanceAPI.listAccounts();
        if (live && current === request) { setAccounts(next); setLoadError(null); }
      } catch (err) {
        if (live && current === request) setLoadError(message(err));
      } finally {
        if (live && current === request) setLoading(false);
      }
    };
    void refresh();
    watchAccountChanges();
    window.addEventListener(ACCOUNTS_EVENT, refresh);
    window.addEventListener("focus", refresh);
    const stop = typeof window.instanceAPI.onAccountsChanged === "function" ? window.instanceAPI.onAccountsChanged(() => { void refresh(); }) : undefined;
    return () => {
      live = false;
      window.removeEventListener(ACCOUNTS_EVENT, refresh);
      window.removeEventListener("focus", refresh);
      if (typeof stop === "function") stop();
    };
  }, [refreshCount]);

  const active = accounts.find((account) => account.active);

  async function choose(value: string) {
    setBusy(true);
    setOperation(value === ADD ? "signin" : "switch");
    setStatus(null);
    setError(null);
    try {
      if (value === ADD) {
        await window.launcherAPI.loginMicrosoft();
        const next = await window.instanceAPI.listAccounts();
        setAccounts(next);
        setStatus(`Signed in as ${next.find((entry) => entry.active)?.name ?? "your Microsoft account"}.`);
      } else {
        const next = await window.instanceAPI.switchAccount(value);
        setAccounts(next);
        setStatus(`Minecraft will launch as ${next.find((entry) => entry.active)?.name ?? "the selected account"}.`);
      }
    } catch (err) {
      setError(message(err));
    }
    setBusy(false);
  }

  const options = (
    <>
      {!active && <option value="">{loading ? "Checking accounts…" : loadError ? "Account check unavailable" : busy ? "Signing in..." : "Not signed in"}</option>}
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
          disabled={busy || loading}
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
          disabled={busy || loading}
          onChange={(e) => choose(e.target.value)}
        >
          {options}
        </Select>
      </div>
      {busy && <div className="ui-account__note" role="status">{operation === "signin" ? "Finish signing in in your browser." : "Switching Minecraft account…"}</div>}
      {!busy && status && <div className="ui-account__note" role="status">{status}</div>}
      {loadError && <div role="alert" className="ui-account__error">Couldn’t load Minecraft accounts: {loadError}<Button size="sm" variant="ghost" disabled={loading} onClick={() => setRefreshCount((value) => value + 1)}>Retry account check</Button></div>}
      {error && (
        <div role="alert" className="ui-account__error">
          {error}
        </div>
      )}
    </div>
  );
}
