import "./ui.css";

/* A small turning ring for "working on it". Give it a label when nothing else on screen says what's happening. */
export default function Spinner({ size = 16, label }: { size?: number; label?: string }) {
  return (
    <span
      className="ui-spinner"
      style={{ width: size, height: size }}
      role={label ? "status" : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
    />
  );
}
