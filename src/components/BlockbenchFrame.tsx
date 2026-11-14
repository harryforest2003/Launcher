import { useEffect, useRef, useState } from "react";
import { leaveBlockbench } from "./leaveBlockbench";

/*
 * Makes room for Blockbench over the page it was opened from, under a bar of the
 * launcher's own. The launcher's sidebar stays beside it. Blockbench itself is drawn by the main process into the space this
 * leaves, so the space is reported whenever it changes size.
 */
export default function BlockbenchFrame({ title }: { title: string }) {
  const spaceRef = useRef<HTMLDivElement>(null);
  const [status, setStatus] = useState<string | null>(null);

  useEffect(() => {
    const space = spaceRef.current;
    if (!space) return;

    const report = () => {
      const box = space.getBoundingClientRect();
      window.blockbenchAPI.setBounds({ x: box.left, y: box.top, width: box.width, height: box.height });
    };

    report();
    const observer = new ResizeObserver(report);
    observer.observe(space);
    window.addEventListener("resize", report);

    return () => {
      observer.disconnect();
      window.removeEventListener("resize", report);
    };
  }, []);

  useEffect(() => window.blockbenchAPI.onSaved(setStatus), []);

  return (
    <div
      data-testid="blockbench-frame"
      style={{
        position: "absolute",
        inset: 0,
        zIndex: 50,
        background: "var(--color-bg)",
        display: "flex",
        flexDirection: "column",
      }}
    >
      <div
        style={{
          height: 52,
          flexShrink: 0,
          display: "flex",
          alignItems: "center",
          gap: 14,
          padding: "0 16px",
          background: "var(--color-surface)",
          borderBottom: "1px solid var(--color-border)",
        }}
      >
        <span style={{ color: "var(--color-accent-text)", fontFamily: "var(--font-ui)", fontWeight: 700 }}>Blockbench</span>
        <span style={{ color: "var(--color-text-muted)", fontSize: 13 }}>{title}</span>
        <span style={{ flex: 1 }} />
        {status && (
          <span data-testid="blockbench-status" style={{ color: "var(--color-success-text)", fontSize: 12 }}>
            {status}
          </span>
        )}
        <button className="sidebar-button" style={{ padding: "6px 16px" }} onClick={() => window.blockbenchAPI.save()}>
          Save
        </button>
        <button
          className="sidebar-button"
          style={{ padding: "6px 16px", background: "var(--color-accent)", color: "var(--color-on-accent)" }}
          onClick={() => leaveBlockbench()}
        >
          Done
        </button>
      </div>

      {/* Blockbench is drawn over this once what it's editing is open. */}
      <div
        ref={spaceRef}
        style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", color: "var(--color-text-muted)", fontSize: 14 }}
      >
        Opening the model editor...
      </div>
    </div>
  );
}
