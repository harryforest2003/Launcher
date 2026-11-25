import { useCallback, useEffect, useState } from "react";
import { Monogram, type MenuItem } from "./ui";
import { ACCOUNTS_EVENT, watchAccountChanges } from "./ui/accountsSignal";

/*
 * Who a game plays as. Several instances can be open at once, each as its own signed-in
 * account, but one account can only be in one game: Minecraft allows one online session per
 * account, and a second would end the first. Play uses the active account; the menu beside
 * it picks another, and pressing Play with an account that's already in a game says so and
 * offers the others instead. This is the state and the checks; PlayAs.tsx draws the menu
 * and the notice.
 */

type Playing = Record<string, GamePlayer | null>;
type Seen = { accounts: MinecraftAccount[]; playing: Playing; loaded?: boolean; unavailable?: boolean };

/** An account that's already in another game, and the instance that was to start. */
export type AccountClash = { instance: string; account: GamePlayer; busyIn: string };

/* The instance this account is in, other than `instance` itself. */
const busyIn = ({ playing }: Seen, accountId: string, instance?: string) =>
  Object.entries(playing).find(([name, player]) => player?.id === accountId && name !== instance)?.[0] ?? null;

function clashFor(seen: Seen, instance: string, accountId?: string): AccountClash | null {
  const account = accountId ? seen.accounts.find((entry) => entry.uuid === accountId) : seen.accounts.find((entry) => entry.active);
  if (!account) return null;
  const busy = busyIn(seen, account.uuid, instance);
  return busy ? { instance, account: { id: account.uuid, name: account.name }, busyIn: busy } : null;
}

async function look(): Promise<Seen> {
  const [accounts, playing] = await Promise.all([
    Promise.resolve().then(() => window.instanceAPI?.listAccounts?.()).catch(() => null),
    Promise.resolve().then(() => window.instanceAPI?.playing?.()).catch(() => null),
  ]);
  return { accounts: Array.isArray(accounts) ? accounts : [], playing: playing && typeof playing === "object" ? playing : {}, loaded: true, unavailable: !Array.isArray(accounts) || !playing };
}

/**
 * The signed-in accounts and which game each is in, kept current, with the checks a Play
 * button makes. check() before launching; explain() after a launch fails.
 */
export function useAccountChoice() {
  const [seen, setSeen] = useState<Seen>({ accounts: [], playing: {} });
  const [clash, setClash] = useState<AccountClash | null>(null);

  const refresh = useCallback(async () => {
    const next = await look();
    setSeen(next);
    return next;
  }, []);

  useEffect(() => {
    const again = () => void refresh();
    again();
    watchAccountChanges();
    window.addEventListener(ACCOUNTS_EVENT, again);
    window.addEventListener("focus", again);
    const api = window.instanceAPI;
    const offs = [api?.onAccountsChanged?.(again), api?.onStarted?.(again), api?.onExit?.(again)];
    return () => {
      window.removeEventListener(ACCOUNTS_EVENT, again);
      window.removeEventListener("focus", again);
      for (const off of offs) if (typeof off === "function") off();
    };
  }, [refresh]);


  /** Whether `instance` may start as this account (the active one if none); if not, the clash is shown. */
  const check = useCallback(
    (instance: string, accountId?: string) => {
      const found = clashFor(seen, instance, accountId);
      setClash(found);
      return !found;
    },
    [seen]
  );

  /** After a launch failed: whether it was because the account is in another game (shown if so). */
  const explain = useCallback(
    async (instance: string, accountId?: string) => {
      const found = clashFor(await refresh(), instance, accountId);
      setClash(found);
      return Boolean(found);
    },
    [refresh]
  );

  return {
    accounts: seen.accounts,
    playing: seen.playing,
    loaded: Boolean(seen.loaded),
    unavailable: Boolean(seen.unavailable),
    /** The instance this account's game is in, if any (other than `instance`). */
    busyIn: (accountId: string, instance?: string) => busyIn(seen, accountId, instance),
    // Gone once the game holding the account closes.
    clash: clash && busyIn(seen, clash.account.id, clash.instance) ? clash : null,
    check,
    explain,
    dismiss: () => setClash(null),
    refresh,
  };
}

export type AccountChoice = ReturnType<typeof useAccountChoice>;

export type PlayAsItem = Exclude<MenuItem, "separator">;

/** The "Play as" menu's entries for one instance: every signed-in account, those in another game greyed. */
export function playAsItems(choice: AccountChoice, instance: string, onPlayAs: (accountId: string) => void): PlayAsItem[] {
  return choice.accounts.map((account) => {
    const busy = choice.busyIn(account.uuid, instance);
    return {
      label: busy ? `${account.name}: playing ${busy}` : `Play as ${account.name}${account.active ? " (default)" : ""}`,
      icon: <Monogram name={account.name} size={16} />,
      disabled: Boolean(busy),
      onSelect: () => onPlayAs(account.uuid),
    };
  });
}
