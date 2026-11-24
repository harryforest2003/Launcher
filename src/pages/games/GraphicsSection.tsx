import { useEffect, useState } from "react";
import { Download, ExternalLink, FolderOpen, Sparkles } from "lucide-react";
import Toggle from "../../components/Toggle";
import IconButton from "../../components/IconButton";
import { BinIcon } from "../../components/Icons";
import { Badge, Button, Notice, Select } from "../../components/ui";
import { errorText } from "./shared";

type Say = (text: string | null, tone?: "good" | "bad") => void;

/* "6.10.1" is newer than "6.9.2". */
function newer(latest: string | null | undefined, have: string) {
  if (!latest) return false;
  const a = latest.split(".").map(Number);
  const b = have.split(".").map(Number);
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    if ((a[i] ?? 0) !== (b[i] ?? 0)) return (a[i] ?? 0) > (b[i] ?? 0);
  }
  return false;
}

const leftText = (left: string[] | undefined) =>
  left?.length ? ` Left ${left.join(", ")}: ${left.length === 1 ? "it was" : "they were"} changed after the launcher put ${left.length === 1 ? "it" : "them"} in.` : "";

/*
 * ReShade (post-processing shaders, from reshade.me, with its shader packages) and ENB
 * (Boris Vorontsov's lighting for Skyrim, Fallout 4 and GTA V, downloaded by hand: his site
 * doesn't allow downloads by other programs). Both are DLLs beside the game's exe.
 */
export default function GraphicsSection({ detail, say }: { detail: GameDetail; say: Say }) {
  const [data, setData] = useState<GameGraphics | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [api, setApi] = useState<string | null>(null);
  const [packages, setPackages] = useState<string[] | null>(null);

  useEffect(() => {
    let current = true;
    window.gamesAPI
      .graphics(detail.id)
      .then((found) => current && setData(found))
      .catch((err) => current && setFailed(errorText(err)));
    return () => {
      current = false;
    };
  }, [detail.id]);

  async function act(label: string, work: () => Promise<GameGraphics | null>, done?: (next: GameGraphics) => string) {
    setBusy(label);
    try {
      const next = await work();
      if (next) {
        setData(next);
        if (done) say(done(next));
      }
    } catch (err) {
      say(errorText(err), "bad");
    } finally {
      setBusy(null);
    }
  }

  if (failed) return <Notice tone="danger">{failed}</Notice>;
  if (!data) return <p className="set-help">Looking at the game's folder...</p>;
  if (!data.supported) return <Notice tone="info">{data.why}</Notice>;

  const reshade = data.reshade;
  const chosenApi = api ?? reshade?.api ?? data.api ?? "dxgi";
  const chosenPackages = packages ?? reshade?.packages ?? Object.keys(data.packages);
  const update = reshade && newer(data.latest, reshade.version);
  const changed = reshade && (chosenApi !== reshade.api || [...chosenPackages].sort().join() !== [...reshade.packages].sort().join());
  const taken = (data.taken ?? []).filter((dll) => dll !== reshade?.dll);
  const enb = data.enb;
  const enbIn = enb?.installed ?? null;

  return (
    <>
      <section className="ui-panel set-panel set-flat" data-testid="reshade-panel">
        <div className="set-frow">
          <div className="set-frow-text">
            <h4 className="set-row-name">
              ReShade{" "}
              {reshade ? (
                <Badge tone={reshade.off ? "neutral" : "success"}>
                  {reshade.version}
                  {reshade.off ? ", off" : ""}
                </Badge>
              ) : (
                data.latest && <Badge tone="neutral">{data.latest}</Badge>
              )}
            </h4>
            <p className="set-help">
              Post-processing effects: sharpening, colour, depth of field, ambient occlusion and more. Press Home in the game to open it and pick effects.
            </p>
          </div>
          <div className="set-frow-ctl">
            {reshade && <Toggle on={!reshade.off} disabled={Boolean(busy)} label="ReShade on" onChange={(on) => void act("reshadeOn", () => window.gamesAPI.reshadeOn(detail.id, on))} />}
            {reshade && (
              <IconButton
                tip="Remove ReShade"
                label="Remove ReShade"
                disabled={Boolean(busy)}
                onClick={() => void act("reshadeRemove", () => window.gamesAPI.reshadeRemove(detail.id), (next) => `Removed ReShade. Its settings and presets stay in the game's folder.${leftText(next.left)}`)}
              >
                <BinIcon size={14} />
              </IconButton>
            )}
          </div>
        </div>

        <div className="set-frow">
          <div className="set-frow-text" style={{ display: "grid", gap: "var(--space-2)" }}>
            <label className="set-help" style={{ display: "grid", gap: "var(--space-1)", maxWidth: 360 }}>
              The game draws with
              <Select size="sm" value={chosenApi} disabled={Boolean(busy)} onChange={(event) => setApi(event.target.value)} aria-label="How the game draws">
                {Object.entries(data.apis).map(([key, name]) => (
                  <option key={key} value={key}>
                    {name} ({key}.dll)
                  </option>
                ))}
              </Select>
            </label>
            {Object.entries(data.packages).map(([key, pack]) => (
              <label key={key} className="set-help" style={{ display: "flex", gap: "var(--space-2)", alignItems: "center" }}>
                <input
                  type="checkbox"
                  checked={chosenPackages.includes(key)}
                  disabled={Boolean(busy)}
                  onChange={(event) => setPackages(event.target.checked ? [...chosenPackages, key] : chosenPackages.filter((entry) => entry !== key))}
                />
                {pack.name}
              </label>
            ))}
          </div>
          <div className="set-frow-ctl">
            {(!reshade || update || changed) && (
              <Button
                size="sm"
                variant="primary"
                icon={<Download size={14} aria-hidden="true" />}
                disabled={Boolean(busy)}
                data-testid="reshade-install"
                onClick={() =>
                  void act("reshadeInstall", () => window.gamesAPI.reshadeInstall(detail.id, { api: chosenApi, packages: chosenPackages }), (next) => {
                    setApi(null);
                    setPackages(null);
                    return `ReShade ${next.reshade?.version ?? ""} is in, as ${next.reshade?.dll ?? `${chosenApi}.dll`}. Press Home in the game to open it.`;
                  })
                }
              >
                {busy === "reshadeInstall" ? "Downloading..." : !reshade ? `Install ReShade${data.latest ? ` ${data.latest}` : ""}` : update && !changed ? `Update to ${data.latest}` : "Apply"}
              </Button>
            )}
          </div>
        </div>

        {taken.length > 0 && (
          <Notice tone="warning">
            {taken.join(", ")} {taken.length === 1 ? "is" : "are"} already in the game's folder, from a mod or put in by hand. The launcher won't replace {taken.length === 1 ? "it" : "them"}: pick
            another way the game draws above if ReShade's goes there.
          </Notice>
        )}
        {data.byHand?.reshade && <Notice tone="info">ReShade looks put in by hand already. Remove it first so there aren't two.</Notice>}
        <p className="set-help">Some online games' anti-cheat doesn't allow ReShade. Turn it off before playing online if unsure.</p>
      </section>

      {enb && (
        <section className="ui-panel set-panel set-flat" data-testid="enb-panel">
          <div className="set-frow">
            <div className="set-frow-text">
              <h4 className="set-row-name">
                ENB{" "}
                {enbIn && (
                  <Badge tone={enbIn.off ? "neutral" : "success"}>
                    {enbIn.version ?? "in"}
                    {enbIn.off ? ", off" : ""}
                  </Badge>
                )}
              </h4>
              <p className="set-help">
                Replaces the game's lighting, shadows and effects. enbdev.com doesn't allow downloads by other programs, so get it there: pick {detail.name}, open its newest
                version and use the download link at the bottom of the page. Then install it here.
              </p>
            </div>
            <div className="set-frow-ctl">
              {enbIn && <Toggle on={!enbIn.off} disabled={Boolean(busy)} label="ENB on" onChange={(on) => void act("enbOn", () => window.gamesAPI.enbOn(detail.id, on))} />}
              {enbIn && (
                <IconButton
                  tip="Remove ENB"
                  label="Remove ENB"
                  disabled={Boolean(busy)}
                  onClick={() => void act("enbRemove", () => window.gamesAPI.enbRemove(detail.id), (next) => `Removed ENB. Its settings files stay, for a preset.${leftText(next.left)}`)}
                >
                  <BinIcon size={14} />
                </IconButton>
              )}
            </div>
          </div>
          <div className="set-frow">
            <div className="set-frow-text">
              {enb.download ? (
                <p className="set-help">
                  Found in Downloads: <bdi>{enb.download.name}</bdi>
                  {enb.download.version ? ` (version ${enb.download.version})` : ""}.
                </p>
              ) : (
                <p className="set-help">No ENB for {detail.name} in Downloads yet.</p>
              )}
              <p className="set-help">ENB presets install as mods, from the Mods page. Installing ENB again keeps a preset's settings.</p>
            </div>
            <div className="set-frow-ctl">
              <Button size="sm" icon={<ExternalLink size={14} aria-hidden="true" />} onClick={() => void window.gamesAPI.enbSite().catch((err) => say(errorText(err), "bad"))}>
                enbdev.com
              </Button>
              {enb.download && enb.download.version !== enbIn?.version && (
                <Button
                  size="sm"
                  variant="primary"
                  icon={<Sparkles size={14} aria-hidden="true" />}
                  disabled={Boolean(busy)}
                  data-testid="enb-install"
                  onClick={() => void act("enbInstall", () => window.gamesAPI.enbInstall(detail.id, true), (next) => `ENB ${next.enb?.installed?.version ?? ""} is in.`)}
                >
                  Install {enb.download.version ? `ENB ${enb.download.version}` : "it"}
                </Button>
              )}
              <Button size="sm" disabled={Boolean(busy)} onClick={() => void act("enbInstall", () => window.gamesAPI.enbInstall(detail.id, false), (next) => `ENB ${next.enb?.installed?.version ?? ""} is in.`)}>
                Choose a file...
              </Button>
            </div>
          </div>
          {data.byHand?.enb && <Notice tone="info">ENB looks put in by hand already. To install it here, take its d3d11.dll out of the game's folder first; its settings files can stay.</Notice>}
        </section>
      )}

      <div className="set-frow">
        <div className="set-frow-text">
          <p className="set-help" title={data.dir ?? undefined} style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", direction: "rtl", textAlign: "left" }}>
            <bdi>{data.dir}</bdi>
          </p>
        </div>
        <div className="set-frow-ctl">
          <Button size="sm" variant="ghost" icon={<FolderOpen size={14} aria-hidden="true" />} onClick={() => void window.gamesAPI.openGraphicsFolder(detail.id).catch((err) => say(errorText(err), "bad"))}>
            Open folder
          </Button>
        </div>
      </div>
    </>
  );
}
