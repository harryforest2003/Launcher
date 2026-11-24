import { useEffect, useMemo, useState } from "react";
import { errorText } from "./shared";

type Say = (next: { tone: "good" | "bad" | "warn"; text: string; notes?: string[] }) => void;

/* The bar under the header while a profile is being named or deleted. */
export type ProfileForm = { kind: "new" | "copy" | "rename"; name: string } | { kind: "delete"; id: string };

/*
 * A game's mod profiles: which one is chosen, the mods only other profiles have (kept out
 * of the list and the game's folder), and switching between them.
 */
export default function useGameProfiles(gameId: GameId, mods: GameMod[], reload: () => Promise<void>, say: Say) {
  const [data, setData] = useState<GameProfiles | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  // Fetched again when mods come or go (a new one joins the chosen profile).
  const signature = mods.map((mod) => mod.key).join("|");

  useEffect(() => {
    let current = true;
    window.gamesAPI
      .profiles(gameId)
      .then((found) => {
        if (!current) return;
        setData(found);
        if (found.turnedOff) void reload();
      })
      .catch(() => current && setData(null));
    return () => {
      current = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gameId, signature]);

  const profiles = useMemo(() => data?.profiles ?? [], [data]);
  const active = profiles.find((profile) => profile.id === data?.active) ?? null;
  const hidden = useMemo(() => {
    const mine = new Set(active?.keys ?? []);
    return new Set(profiles.flatMap((profile) => profile.keys).filter((key) => !mine.has(key)));
  }, [profiles, active]);

  async function run<T extends GameProfiles>(label: string, work: () => Promise<T>, after?: (result: T) => void | Promise<void>) {
    setBusy(label);
    try {
      const result = await work();
      setData(result);
      await after?.(result);
      await reload();
      return true;
    } catch (err) {
      say({ tone: "bad", text: errorText(err) });
      return false;
    } finally {
      setBusy(null);
    }
  }

  const switchTo = (id: string) =>
    run("switch", () => window.gamesAPI.switchProfile(gameId, id), (result) => {
      const name = result.profiles.find((profile) => profile.id === id)?.name ?? "that profile";
      say({
        tone: result.problems.length ? "warn" : "good",
        text: `Switched to ${name}${result.changed ? `: ${result.changed} mod${result.changed === 1 ? "" : "s"} moved in or out of the game` : ""}.${result.saves.on && result.saves.folder && !result.saves.pending ? " Its own saves are in the game's saves folder." : ""}`,
        notes: result.problems,
      });
    });

  return {
    profiles,
    active,
    hidden,
    busy,
    switchTo,
    /* Makes one (empty, or a copy of the chosen one) and switches to it. */
    create: (name: string, copy: boolean) =>
      run("create", () => window.gamesAPI.saveProfile(gameId, { name, copyOf: copy ? "active" : null }), async (result) => {
        if (!result.created) return;
        // The first profile also makes "Default" of what's there now: it's chosen until this one is.
        const switched = await window.gamesAPI.switchProfile(gameId, result.created);
        setData(switched);
        const saves = switched.saves.on ? (copy ? " It has a copy of the saves too." : " It starts with no saves.") : "";
        say({
          tone: switched.problems.length ? "warn" : "good",
          text: copy ? `Made ${name}, a copy of ${active?.name ?? "Default"}, and switched to it.${saves}` : `Made ${name} and switched to it. Mods you add now go in it.${saves}`,
          notes: switched.problems,
        });
      }),
    rename: (id: string, name: string) => run("rename", () => window.gamesAPI.saveProfile(gameId, { id, name })),
    remove: (id: string) => run("delete", () => window.gamesAPI.deleteProfile(gameId, id)),
    member: (id: string, key: string, member: boolean) => run("member", () => window.gamesAPI.profileMember(gameId, id, key, member)),
    /* Whether each profile keeps its own saves (on unless turned off). */
    saves: data?.saves ?? { on: true, folder: null, pending: false },
    setSaves: (on: boolean) =>
      run("saves", () => window.gamesAPI.profileSaves(gameId, on), () =>
        say({
          tone: "good",
          text: on
            ? `Each profile keeps its own saves now. The saves in the game's folder count as ${active?.name ?? "this profile"}'s.`
            : "Profiles share the game's saves now. Other profiles' saves stay in the launcher until this is turned back on.",
        })
      ),
  };
}

export type GameProfilesApi = ReturnType<typeof useGameProfiles>;
