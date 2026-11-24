import { useRef, useState } from "react";
import { ImagePlus } from "lucide-react";
import { Button } from "./ui";
import InstanceArt from "./InstanceArt";
import { setInstancePicture, squarePicture, useInstancePicture } from "../utils/instancePictures";

const message = (err: unknown) =>
  (err instanceof Error ? err.message : String(err)).replace(/^Error invoking remote method '[^']+': (Error: )?/, "");

const card: React.CSSProperties = {
  background: "var(--color-surface)",
  border: "1px solid var(--color-border)",
  borderRadius: 12,
  padding: 14,
};

/* An instance's own picture, on its Settings tab: choose one (or drop one on), or go back to the pattern. */
export function InstancePictureCard({ instanceName, onError }: { instanceName: string; onError: (text: string) => void }) {
  const picture = useInstancePicture(instanceName);
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [dropping, setDropping] = useState(false);

  const save = async (work: () => Promise<string | null>) => {
    setBusy(true);
    try {
      setInstancePicture(instanceName, await work());
    } catch (err) {
      onError(message(err));
    } finally {
      setBusy(false);
    }
  };

  const choose = (file: File | undefined) => {
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      onError("That file isn't a picture. Choose a PNG, JPEG, WebP or GIF.");
      return;
    }
    save(async () => window.instanceAPI.setPicture(instanceName, await squarePicture(file)));
  };

  return (
    <div
      style={card}
      data-testid="instance-picture"
      onDragOver={(event) => {
        if (![...event.dataTransfer.items].some((item) => item.kind === "file")) return;
        event.preventDefault();
        setDropping(true);
      }}
      onDragLeave={() => setDropping(false)}
      onDrop={(event) => {
        event.preventDefault();
        setDropping(false);
        choose(event.dataTransfer.files[0]);
      }}
    >
      <p style={{ color: "var(--color-accent-text)", marginBottom: 10 }}>Picture</p>
      <div className={`id-picture${dropping ? " is-dropping" : ""}`} style={{ display: "flex", gap: 14, alignItems: "center" }}>
        <InstanceArt name={instanceName} />
        <div style={{ display: "flex", flexDirection: "column", gap: 8, minWidth: 0 }}>
          <span style={{ color: "var(--color-text-muted)", fontSize: 12 }}>
            Shown in the Library, on the home screen and here. Square pictures fit best; others are cut to a square from the middle. You can drop one here too.
          </span>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <Button size="sm" icon={<ImagePlus size={15} />} disabled={busy} onClick={() => input.current?.click()}>
              {picture ? "Change picture" : "Choose picture"}
            </Button>
            {picture && (
              <Button size="sm" variant="ghost" disabled={busy} onClick={() => save(() => window.instanceAPI.clearPicture(instanceName))}>
                Use the pattern instead
              </Button>
            )}
          </div>
        </div>
      </div>
      <input
        ref={input}
        type="file"
        accept="image/png,image/jpeg,image/webp,image/gif,image/bmp"
        hidden
        onChange={(event) => {
          choose(event.target.files?.[0]);
          event.target.value = "";
        }}
      />
    </div>
  );
}
