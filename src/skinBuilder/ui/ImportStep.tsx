import { useRef, useState } from "react";

type Props = {
  busy: boolean;
  error: string | null;
  onFile: (file: File) => void;
};

export default function ImportStep({ busy, error, onFile }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);

  const takeFirst = (files: FileList | null) => {
    const file = files?.[0];
    if (file) onFile(file);
  };

  return (
    <div
      role="button"
      tabIndex={0}
      aria-label="Choose an image of an item"
      onClick={() => inputRef.current?.click()}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") inputRef.current?.click();
      }}
      onDragOver={(event) => {
        event.preventDefault();
        setDragging(true);
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={(event) => {
        event.preventDefault();
        setDragging(false);
        takeFirst(event.dataTransfer.files);
      }}
      style={{
        minHeight: 360,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: 10,
        padding: 30,
        textAlign: "center",
        cursor: "pointer",
        border: `2px dashed ${dragging ? "var(--color-accent-line)" : "var(--color-border)"}`,
        borderRadius: 16,
        background: dragging ? "var(--color-accent-subtle)" : "var(--color-surface-sunken)",
      }}
    >
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        aria-label="Item image file"
        style={{ display: "none" }}
        onChange={(event) => {
          takeFirst(event.target.files);
          event.target.value = "";
        }}
      />

      <div style={{ fontSize: 20, color: "var(--color-accent-text)" }}>{busy ? "Cutting out your item..." : "Drop an image of an item here"}</div>
      <div style={{ color: "var(--color-text-secondary)", fontSize: 14 }}>
        {busy ? "This runs on your computer and nothing is uploaded." : "or click to choose a file. PNG, JPEG and WebP all work."}
      </div>
      <div style={{ color: "var(--color-text-muted)", fontSize: 13, maxWidth: 460, marginTop: 8 }}>
        One item on a plain background cuts out best. You can correct the selection in the next step.
      </div>

      {error && <div style={{ color: "var(--color-danger-text)", fontSize: 14, marginTop: 10 }}>{error}</div>}
    </div>
  );
}
