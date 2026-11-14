import { useState } from "react";
import { ChevronDown, UserPlus } from "lucide-react";
import { Button, Menu, Monogram, Notice } from "./ui";
import { playAsItems, type AccountChoice } from "./playAsChoice";
import "./playAs.css";

/* The button beside Play that picks who to play as, and the notice when an account is
   already in a game (the state and checks are in playAsChoice.tsx). */

const message = (err: unknown) =>
  (err instanceof Error ? err.message : String(err)).replace(/^Error invoking remote method '[^']+': (Error: )?/, "");

type MenuProps = {
  choice: AccountChoice;
  instance: string;
  onPlayAs: (accountId: string) => void;
  size?: "md" | "lg";
};

/** The button beside Play that picks who to play as. Only there with two or more accounts signed in. */
export function PlayAsMenu({ choice, instance, onPlayAs, size = "md" }: MenuProps) {
  if (choice.accounts.length < 2) return null;
  return (
    <Menu
      label={`Choose who to play ${instance} as`}
      trigger={<ChevronDown size={size === "lg" ? 18 : 16} aria-hidden="true" />}
      triggerClassName={`ui-button ui-button--secondary${size === "lg" ? " ui-button--lg" : ""} play-as__trigger`}
      floating
      items={playAsItems(choice, instance, onPlayAs)}
    />
  );
}

type NoticeProps = {
  choice: AccountChoice;
  /** Only shown for this instance's clash, when given. */
  instance?: string;
  onPlayAs: (accountId: string) => void;
  className?: string;
};

/** When the account is already in another game: says so, and offers the accounts that are free. */
export function AccountClashNotice({ choice, instance, onPlayAs, className }: NoticeProps) {
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { clash } = choice;
  if (!clash || (instance && clash.instance !== instance)) return null;

  const free = choice.accounts.filter((account) => !choice.busyIn(account.uuid, clash.instance));

  async function addAccount() {
    setAdding(true);
    setError(null);
    try {
      await window.launcherAPI.loginMicrosoft();
      await choice.refresh();
    } catch (err) {
      setError(message(err));
    }
    setAdding(false);
  }

  return (
    <Notice tone="warning" className={["play-as__clash", className].filter(Boolean).join(" ")} data-testid="account-clash">
      <p className="play-as__clash-text">
        <strong>{clash.account.name}</strong> is already playing {clash.busyIn}. Minecraft allows one game per account at a time.
        {free.length ? ` Play ${clash.instance} as:` : ` Sign in with another account to play both at once, or close ${clash.busyIn} first.`}
      </p>
      <div className="play-as__choices">
        {free.map((account) => (
          <Button key={account.uuid} size="sm" icon={<Monogram name={account.name} size={16} />} onClick={() => onPlayAs(account.uuid)}>
            {account.name}
          </Button>
        ))}
        {!free.length && (
          <Button size="sm" icon={<UserPlus size={14} aria-hidden="true" />} disabled={adding} onClick={addAccount}>
            {adding ? "Finish signing in in your browser..." : "Add an account"}
          </Button>
        )}
        <Button size="sm" variant="ghost" onClick={choice.dismiss}>
          Not now
        </Button>
      </div>
      {error && <p className="play-as__clash-error">{error}</p>}
    </Notice>
  );
}
