import { useEffect, useState } from "react";
import { Swords } from "lucide-react";
import { errorText, note, smallButton } from "./shared";

type Props = {
  detail: GameDetail;
  /* The mods as listed: when they change, conflicts are looked at again. */
  mods: GameMod[];
  reload: () => Promise<void>;
};

const SHOWN = 25;

const list = (names: string[]) => (names.length <= 2 ? names.join(" and ") : `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`);
const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/* What a conflict means, in a sentence each: what they both change, and what happens. */
function describe(clash: GameClash) {
  const names = list(clash.mods.map((m) => m.name));
  const loser = clash.mods.find((m) => m.name !== clash.winner)?.name ?? "";
  switch (clash.kind) {
    case "tuning":
      return {
        title: `${names} change the same ${plural(clash.count, "game setting", "game settings")}`,
        why: "The game only uses one of them, so the other won't work properly. Keep the one you want.",
      };
    case "item":
      return {
        title: `${names} are the same CC (${plural(clash.count, "item", "items")})`,
        why: "It's in your game twice. Keep one copy.",
      };
    case "script":
      return {
        title: `${names} have the same script code`,
        why: "The game only loads one copy, which can break both. Keep the newer one.",
      };
    case "records":
      return {
        title: `${names} change the same ${plural(clash.count, "thing", "things")}`,
        why: `${clash.winner} loads later, so its changes are used and ${loser}'s are lost for those, unless a patch combines them.`,
      };
    case "redscript":
      return {
        title: `${names} replace the same ${plural(clash.count, "game function", "game functions")}`,
        why: "redscript stops with an error when two mods replace the same function, and none of your scripts load. Keep one.",
      };
    case "load":
      return {
        title: `${names} both replace ${plural(clash.count, "the same file", "the same files")}`,
        why: "SMAPI applies neither when two packs replace the same file. Keep one.",
      };
  }
}

/*
 * Mods that change the same thing inside the game: the same tuning, the same CC or script
 * code (The Sims 4), the same records (Skyrim, Fallout 4), the same functions (Cyberpunk)
 * or the same files loaded (Stardew). Each with what it means, and turning one off, or for
 * plugins, choosing which wins.
 */
export default function ClashesPanel({ detail, mods, reload }: Props) {
  const [clashes, setClashes] = useState<GameClash[] | null>(null);
  const [open, setOpen] = useState(false);
  const [all, setAll] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [said, setSaid] = useState<{ tone: "good" | "bad"; text: string } | null>(null);

  useEffect(() => {
    let active = true;
    window.gamesAPI
      .clashes(detail.id)
      .then((found) => active && setClashes(found))
      .catch(() => active && setClashes([]));
    return () => {
      active = false;
    };
  }, [detail.id, mods]);

  async function run(id: string, action: () => Promise<string>) {
    setBusy(id);
    setSaid(null);
    try {
      setSaid({ tone: "good", text: await action() });
    } catch (err) {
      setSaid({ tone: "bad", text: errorText(err) });
    }
    setBusy(null);
  }

  const turnOff = (clash: GameClash, mod: { name: string; key: string }) =>
    run(clash.id, async () => {
      await window.gamesAPI.setEnabled(detail.id, mod.key, false);
      await reload();
      return `${mod.name} is off.`;
    });

  const makeWin = (clash: GameClash, name: string) =>
    run(clash.id, async () => {
      setClashes(await window.gamesAPI.clashLoadAfter(detail.id, name, clash.winner ?? ""));
      return `${name} now loads after ${clash.winner}, so its changes are used.`;
    });

  const hide = (id: string, hidden: boolean) =>
    window.gamesAPI
      .hideClash(detail.id, id, hidden)
      .then(setClashes)
      .catch((err) => setSaid({ tone: "bad", text: errorText(err) }));

  const shown = (clashes ?? []).filter((c) => !c.hidden).sort((a, b) => (a.severity === b.severity ? b.count - a.count : a.severity === "error" ? -1 : 1));
  const hiddenCount = (clashes ?? []).length - shown.length;
  if (!shown.length) {
    if (said) return <div style={note(said.tone)}>{said.text}</div>;
    return null;
  }
  const errors = shown.filter((c) => c.severity === "error").length;
  const visible = all ? shown : shown.slice(0, SHOWN);
  const patchSearch = (clash: GameClash) =>
    detail.nexus && `https://www.nexusmods.com/games/${detail.nexus}/mods?keyword=${encodeURIComponent(`${clash.mods.map((m) => m.name.replace(/\.(esp|esm|esl)$/i, "")).join(" ")} patch`)}`;

  return (
    <div style={note(errors ? "bad" : "warn")} data-testid="clashes">
      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
        <Swords size={18} style={{ flexShrink: 0 }} />
        <span style={{ flex: 1 }}>
          {shown.length === 1 ? `${list(shown[0].mods.map((m) => m.name))} change the same thing in the game` : `${shown.length} pairs of mods change the same things in the game`}
          {errors ? (errors === shown.length ? ": " : ` (${errors} need${errors === 1 ? "s" : ""} fixing): `) : ": "}
          {errors ? (shown.length === 1 ? "keep one." : "keep one of each.") : "the one loaded later wins."}
        </span>
        <button className="sidebar-button" style={{ ...smallButton, padding: "6px 12px", fontSize: 12, flexShrink: 0 }} onClick={() => setOpen((now) => !now)}>
          {open ? "Hide" : "See which"}
        </button>
      </div>
      {said && <div style={{ fontSize: 12, marginTop: 8, color: said.tone === "bad" ? "#fca5a5" : "#86efac" }}>{said.text}</div>}
      {open && (
        <div style={{ display: "flex", flexDirection: "column", gap: 6, marginTop: 10 }}>
          {visible.map((clash) => {
            const text = describe(clash);
            const loser = clash.kind === "records" ? clash.mods.find((m) => m.name !== clash.winner) : null;
            const search = clash.kind === "records" ? patchSearch(clash) : null;
            return (
              <div key={clash.id} style={{ padding: "8px 10px", background: "rgba(0, 0, 0, 0.25)", borderRadius: 8 }} data-testid="clash">
                <div style={{ fontSize: 13, fontWeight: 600 }}>{text.title}</div>
                <div style={{ fontSize: 12, marginTop: 3, opacity: 0.85 }}>{text.why}</div>
                {clash.examples.length > 0 && (
                  <div style={{ fontSize: 11, marginTop: 4, fontFamily: "monospace", opacity: 0.7, overflowWrap: "anywhere" }}>
                    {clash.examples.join(", ")}
                    {clash.count > clash.examples.length && clash.kind !== "records" ? `, and ${clash.count - clash.examples.length} more` : ""}
                  </div>
                )}
                <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 6 }}>
                  {loser && (
                    <button className="sidebar-button" disabled={busy !== null} style={{ ...smallButton, padding: "5px 10px", fontSize: 12 }} onClick={() => makeWin(clash, loser.name)}>
                      Make {loser.name} win
                    </button>
                  )}
                  {search && (
                    <button className="sidebar-button" style={{ ...smallButton, padding: "5px 10px", fontSize: 12 }} onClick={() => window.gamesAPI.openUrl(search)}>
                      Find a patch
                    </button>
                  )}
                  {clash.mods.map((mod) => (
                    <button key={mod.key} className="sidebar-button" disabled={busy !== null} style={{ ...smallButton, padding: "5px 10px", fontSize: 12 }} onClick={() => turnOff(clash, mod)}>
                      Turn off {mod.name}
                    </button>
                  ))}
                  <button className="sidebar-button" style={{ ...smallButton, padding: "5px 10px", fontSize: 12 }} title="Stop showing this one" onClick={() => hide(clash.id, true)}>
                    It's fine
                  </button>
                </div>
              </div>
            );
          })}
          {shown.length > visible.length && (
            <button className="sidebar-button" style={{ ...smallButton, padding: "6px 12px", fontSize: 12, alignSelf: "flex-start" }} onClick={() => setAll(true)}>
              Show all {shown.length}
            </button>
          )}
          {hiddenCount > 0 && (
            <button
              style={{ background: "none", border: "none", padding: 0, color: "inherit", cursor: "pointer", font: "inherit", fontSize: 12, textDecoration: "underline", alignSelf: "flex-start", opacity: 0.8 }}
              onClick={() => hide("*", false)}
            >
              Show the {hiddenCount === 1 ? "one" : `${hiddenCount}`} marked fine
            </button>
          )}
        </div>
      )}
    </div>
  );
}
