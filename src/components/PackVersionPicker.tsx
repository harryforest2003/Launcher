import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { Badge, Button, Modal, Monogram } from "./ui";
import { CHANNEL, channelOf, defaultVersion, gameVersions, loaderNames, newestFirst, versionLabel, type PackVersion } from "./packVersions";
import { countChannels, newestIn, useChannelFilter } from "./versionChannels";
import ChannelFilterBar from "./ChannelFilterBar";
import "./packVersionPicker.css";

type Props = {
  source: "modrinth" | "curseforge";
  projectId: string;
  name: string;
  icon?: string | null;
  /** Versions already loaded (the project page has them). Otherwise they're looked up. */
  versions?: PackVersion[];
  /** The main button's verb. */
  actionLabel?: string;
  onPick: (version: PackVersion) => void;
  onClose: () => void;
};

const date = (value?: string) =>
  value ? new Date(value).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" }) : "";

const message = (err: unknown) =>
  (err instanceof Error ? err.message : String(err)).replace(/^Error invoking remote method '[^']+': (Error: )?/, "");

/*
 * Which version of a modpack to install, open while it's mounted. Every version is listed,
 * newest first, each with whether it's a full release, a beta or an alpha, and the list can
 * be narrowed to one of those (remembered across every version list). The newest full
 * release starts picked.
 */
export default function PackVersionPicker({ source, projectId, name, icon, versions: given, actionLabel = "Install", onPick, onClose }: Props) {
  const [fetched, setFetched] = useState<PackVersion[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  // null until a row is clicked: the default version is picked until then.
  const [chosen, setChosen] = useState<string | null>(null);
  const rows = useRef<Map<string, HTMLButtonElement>>(new Map());

  useEffect(() => {
    if (given) return;
    let current = true;
    window.launcherAPI
      .getProject(source, projectId)
      .then((project) => {
        if (!current) return;
        if (!project) throw new Error("Couldn't load this modpack's versions. Check your connection.");
        setFetched(project.versions ?? []);
      })
      .catch((err) => current && setLoadError(message(err)));
    return () => {
      current = false;
    };
  }, [given, source, projectId]);

  const loaded = given ?? fetched;
  const all = useMemo(() => newestFirst(loaded ?? []), [loaded]);
  const counts = useMemo(() => countChannels(all.map(channelOf)), [all]);
  const { filter, wanted, setFilter } = useChannelFilter(counts);
  // Until a row is clicked: the newest full release, or the newest of the channel shown.
  const start = filter === "all" ? defaultVersion(all) : newestIn(all, channelOf, filter);
  const chosenId = chosen ?? (start ? String(start.id) : null);

  const shown = filter === "all" ? all : all.filter((v) => channelOf(v) === filter);
  const picked = all.find((v) => String(v.id) === chosenId) ?? null;
  const newestRelease = all.find((v) => channelOf(v) === "release");

  // Up and down move through the list, as in any radio group.
  const onKey = (event: KeyboardEvent, index: number) => {
    const step = event.key === "ArrowDown" ? 1 : event.key === "ArrowUp" ? -1 : 0;
    if (!step) return;
    event.preventDefault();
    const next = shown[Math.max(0, Math.min(shown.length - 1, index + step))];
    if (!next) return;
    setChosen(String(next.id));
    rows.current.get(String(next.id))?.focus();
  };

  const pickedSummary = picked
    ? `${versionLabel(picked)}: Minecraft ${gameVersions(picked) || "unknown"}${loaderNames(picked) ? `, ${loaderNames(picked)}` : ""}`
    : "";
  // The checked row takes Tab; with none in view, the first does.
  const focusable = shown.some((v) => String(v.id) === chosenId) ? chosenId : shown[0] && String(shown[0].id);

  return (
    <Modal
      open
      onClose={onClose}
      size="lg"
      title={
        <span className="pvp-title">
          {icon ? <img src={icon} alt="" width={32} height={32} /> : <Monogram name={name} size={32} />}
          {name}
        </span>
      }
      lead={`Pick the version to install. The newest ${filter === "all" ? "full release" : CHANNEL[filter].label.toLowerCase()} is picked to start with.`}
      footer={
        <>
          <span className="pvp-summary" aria-live="polite" title={pickedSummary}>
            {pickedSummary}
          </span>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" data-testid="pack-version-install" disabled={!picked} onClick={() => picked && onPick(picked)}>
            {actionLabel}
          </Button>
        </>
      }
    >
      {loadError ? (
        <p className="pvp-note pvp-note--error" role="alert">
          {loadError}
        </p>
      ) : !loaded ? (
        <p className="pvp-note">Finding versions...</p>
      ) : !all.length ? (
        <p className="pvp-note">This modpack has no versions to install.</p>
      ) : (
        <>
          <div className="pvp-filters">
            <ChannelFilterBar counts={counts} value={filter} wanted={wanted} onChange={setFilter} />
          </div>
          <div className="pvp-list" role="radiogroup" aria-label="Versions">
            {shown.map((version, index) => {
              const id = String(version.id);
              const channel = CHANNEL[channelOf(version)];
              return (
                <button
                  key={id}
                  ref={(el) => {
                    if (el) rows.current.set(id, el);
                    else rows.current.delete(id);
                  }}
                  type="button"
                  role="radio"
                  aria-checked={id === chosenId}
                  tabIndex={id === focusable ? 0 : -1}
                  className="pvp-row"
                  data-testid="pack-version-row"
                  onClick={() => setChosen(id)}
                  onDoubleClick={() => onPick(version)}
                  onKeyDown={(event) => onKey(event, index)}
                >
                  <span className="pvp-radio" aria-hidden="true" />
                  <span className="pvp-main">
                    <span className="pvp-line">
                      <span className="pvp-name">{versionLabel(version)}</span>
                      <span title={channel.hint}>
                        <Badge tone={channel.tone}>{channel.label}</Badge>
                      </span>
                      {version === all[0] && <span className="pvp-flag">Newest</span>}
                      {version === newestRelease && version !== all[0] && <span className="pvp-flag">Newest release</span>}
                    </span>
                    <span className="pvp-meta">
                      {[
                        gameVersions(version) && `Minecraft ${gameVersions(version)}`,
                        loaderNames(version),
                        date(version.date_published),
                        version.downloads != null && `${version.downloads.toLocaleString()} downloads`,
                      ]
                        .filter(Boolean)
                        .join(" · ")}
                    </span>
                  </span>
                </button>
              );
            })}
          </div>
        </>
      )}
    </Modal>
  );
}
