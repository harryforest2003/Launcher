import { useEffect, useState } from "react";
import LoaderPicker from "./LoaderPicker";
import { CheckIcon, DownloadIcon } from "./Icons";

type Props = {
  instanceName: string;
  /** The loader build the instance has now; the check runs again when it changes. */
  loaderVersion: string;
  onDone: (result: UpdateResult & DependencyCheck & { loader: { name: string; from: string; to: string } }) => void;
};

const GREEN = "#16a34a";

/*
 * Beside the loader's name: a green button when a newer build is out, or a tick when it's
 * the newest. Either opens the list of builds, to update or go back.
 */
export default function LoaderUpdate({ instanceName, loaderVersion, onDone }: Props) {
  const wanted = `${instanceName}#${loaderVersion}`;
  const [found, setFound] = useState<{ for: string; newest: string | null; loaderName: string } | null>(null);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    let current = true;
    window.instanceAPI
      .loaderVersions(instanceName)
      .then((list) => current && setFound({ for: wanted, newest: list.newest, loaderName: list.loaderName }))
      .catch(() => {
        // Offline, or the list is down: no button, nothing to report.
      });
    return () => {
      current = false;
    };
  }, [instanceName, wanted]);

  const state = found?.for === wanted ? found : null;
  if (!state) return null;

  return (
    <>
      {state.newest ? (
        <button
          data-testid="loader-update"
          title={`${state.loaderName} ${state.newest} is out. Click to see what updating would take.`}
          onClick={() => setOpen(true)}
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 4,
            marginLeft: 6,
            padding: "1px 8px 1px 6px",
            fontSize: 12,
            lineHeight: "18px",
            verticalAlign: "middle",
            background: GREEN,
            color: "white",
            border: "none",
            borderRadius: 8,
            cursor: "pointer",
          }}
        >
          <DownloadIcon size={13} />
          {state.newest}
        </button>
      ) : (
        <button
          data-testid="loader-current"
          className="tick-button"
          title={`${state.loaderName} is up to date. Click to choose another version.`}
          aria-label={`Choose a version of ${state.loaderName}`}
          onClick={() => setOpen(true)}
          style={{ display: "inline-flex", alignItems: "center", marginLeft: 4, padding: "1px 3px", verticalAlign: "middle", color: GREEN }}
        >
          <CheckIcon size={14} />
        </button>
      )}
      {open && <LoaderPicker instanceName={instanceName} onDone={onDone} onClose={() => setOpen(false)} />}
    </>
  );
}
