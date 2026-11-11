import { useEffect, useState } from "react";

type Props = {
  /** Smaller, for the sidebar. */
  compact?: boolean;
};

const ADD = "__add__";

const message = (err: unknown) =>
  (err instanceof Error ? err.message : String(err)).replace(/^Error invoking remote method '[^']+': (Error: )?/, "");

/*
 * Who the game launches as, and switching between signed-in Microsoft accounts, or
 * adding another (Microsoft asks which account to use).
 */
export default function AccountSwitcher({ compact = false }: Props) {
  const [accounts, setAccounts] = useState<MinecraftAccount[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    window.instanceAPI.listAccounts().then(setAccounts).catch(() => {});
    return window.instanceAPI.onAccountsChanged(setAccounts);
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

  return (
    <div data-testid="account-switcher" style={{ width: "100%" }}>
      {compact && <div style={{ color: "#9ca3af", fontSize: 11, marginBottom: 4 }}>Playing as</div>}
      <select
        aria-label="Minecraft account"
        value={active?.uuid ?? ""}
        disabled={busy}
        onChange={(e) => choose(e.target.value)}
        style={{
          width: "100%",
          padding: compact ? "8px 10px" : "12px",
          borderRadius: 10,
          background: "#232323",
          color: "white",
          border: "1px solid #6d28d9",
          fontSize: compact ? 13 : 14,
        }}
      >
        {!active && <option value="">{busy ? "Signing in..." : "Not signed in"}</option>}
        {accounts.map((account) => (
          <option key={account.uuid} value={account.uuid}>
            {account.name}
          </option>
        ))}
        <option value={ADD}>{accounts.length ? "Add another account..." : "Sign in with Microsoft..."}</option>
      </select>
      {busy && <div style={{ color: "#9ca3af", fontSize: 11, marginTop: 4 }}>Finish signing in in your browser.</div>}
      {error && (
        <div role="alert" style={{ color: "#fca5a5", fontSize: 11, marginTop: 4 }}>
          {error}
        </div>
      )}
    </div>
  );
}
