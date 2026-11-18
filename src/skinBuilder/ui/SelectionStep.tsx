import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { CutoutCancelled, runCutout } from "../cutoutClient";
import { HINT_KEEP, HINT_NONE, HINT_REMOVE } from "../grabcut";
import { imageDataOf, type Draft } from "../workingImage";
import Button from "../../components/ui/Button";
import Segmented from "../../components/ui/Segmented";
import { ErrorNote, Slider } from "./shared";
import { useTheme } from "../../theme/runtime";
import { hexToRgb } from "../../theme/color";

// The removed-area tint (magenta, the way Word's background removal shows it).
const REMOVED = { r: 214, g: 40, b: 150 };

/* A theme colour as 0-255 channels, so brush marks follow the colour-vision setting. */
const channels = (hex: string, fallback: { r: number; g: number; b: number }) => {
  const rgb = hexToRgb(hex);
  return rgb ? { r: rgb.r * 255, g: rgb.g * 255, b: rgb.b * 255 } : fallback;
};

type Tool = "keep" | "remove" | "erase";
type View = "marks" | "result";

type Props = {
  draft: Draft;
  onChange: (mask: Uint8Array, hints: Uint8Array) => void;
  onApprove: () => void;
  onStartOver: () => void;
};

const UNDO_LIMIT = 30;
const RERUN_DELAY_MS = 350;

const TOOL_VALUE: Record<Tool, number> = {
  keep: HINT_KEEP,
  remove: HINT_REMOVE,
  erase: HINT_NONE,
};

export default function SelectionStep({ draft, onChange, onApprove, onStartOver }: Props) {
  const { source } = draft;
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const resultRef = useRef<HTMLCanvasElement>(null);
  const cursorRef = useRef<HTMLDivElement>(null);
  const hintsRef = useRef<Uint8Array>(draft.hints);
  const maskRef = useRef<Uint8Array>(draft.mask);
  const undoRef = useRef<Uint8Array[]>([]);
  const strokeRef = useRef<{ x: number; y: number } | null>(null);
  const frameRef = useRef(0);
  const rerunRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [tool, setTool] = useState<Tool>("keep");
  const [view, setView] = useState<View>("marks");
  const [brush, setBrush] = useState(10);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [undoCount, setUndoCount] = useState(0);
  const [keptShare, setKeptShare] = useState(0);
  const [image] = useState(() => imageDataOf(source));
  const { palette } = useTheme();
  const keepHex = palette.colors["success-solid"];
  const removeHex = palette.colors["danger-solid"];

  const paint = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const { width, height } = image;
    const output = ctx.createImageData(width, height);
    const out = output.data;
    const data = image.data;
    const mask = maskRef.current;
    const hints = hintsRef.current;
    const showMarks = view === "marks";
    const keep = channels(keepHex, { r: 34, g: 197, b: 94 });
    const remove = channels(removeHex, { r: 239, g: 68, b: 68 });

    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const i = y * width + x;
        const p = i * 4;
        const kept = mask[i] === 1;

        if (!showMarks) {
          out[p] = data[p];
          out[p + 1] = data[p + 1];
          out[p + 2] = data[p + 2];
          out[p + 3] = kept ? 255 : 0;
          continue;
        }

        let r = data[p];
        let g = data[p + 1];
        let b = data[p + 2];

        if (!kept) {
          r = r * 0.35 + REMOVED.r * 0.65;
          g = g * 0.35 + REMOVED.g * 0.65;
          b = b * 0.35 + REMOVED.b * 0.65;
        } else if (
          x === 0 || y === 0 || x === width - 1 || y === height - 1 ||
          !mask[i - 1] || !mask[i + 1] || !mask[i - width] || !mask[i + width]
        ) {
          r = 255;
          g = 255;
          b = 255;
        }

        if (hints[i] === HINT_KEEP) {
          r = r * 0.4 + keep.r * 0.6;
          g = g * 0.4 + keep.g * 0.6;
          b = b * 0.4 + keep.b * 0.6;
        } else if (hints[i] === HINT_REMOVE) {
          r = r * 0.4 + remove.r * 0.6;
          g = g * 0.4 + remove.g * 0.6;
          b = b * 0.4 + remove.b * 0.6;
        }

        out[p] = r;
        out[p + 1] = g;
        out[p + 2] = b;
        out[p + 3] = 255;
      }
    }

    ctx.putImageData(output, 0, 0);

    // The small result picture in the column follows every change.
    const thumb = resultRef.current?.getContext("2d");
    if (thumb) {
      const cut = thumb.createImageData(width, height);
      for (let i = 0; i < width * height; i += 1) {
        const p = i * 4;
        cut.data[p] = data[p];
        cut.data[p + 1] = data[p + 1];
        cut.data[p + 2] = data[p + 2];
        cut.data[p + 3] = mask[i] === 1 ? 255 : 0;
      }
      thumb.putImageData(cut, 0, 0);
    }
  }, [image, view, keepHex, removeHex]);

  const schedulePaint = useCallback(() => {
    cancelAnimationFrame(frameRef.current);
    frameRef.current = requestAnimationFrame(paint);
  }, [paint]);

  const updateKeptShare = useCallback(() => {
    const mask = maskRef.current;
    let kept = 0;
    for (let i = 0; i < mask.length; i += 1) kept += mask[i];
    setKeptShare(kept / mask.length);
  }, []);

  const rerun = useCallback(async () => {
    setRunning(true);
    setError(null);
    try {
      const mask = await runCutout(image, hintsRef.current);
      maskRef.current = mask;
      updateKeptShare();
      onChange(mask, hintsRef.current);
      schedulePaint();
      setRunning(false);
    } catch (err) {
      if (err instanceof CutoutCancelled) return;
      setRunning(false);
      setError(err instanceof Error ? err.message : String(err));
    }
  }, [image, onChange, schedulePaint, updateKeptShare]);

  const scheduleRerun = useCallback(() => {
    if (rerunRef.current) clearTimeout(rerunRef.current);
    rerunRef.current = setTimeout(rerun, RERUN_DELAY_MS);
  }, [rerun]);

  useEffect(() => {
    updateKeptShare();
    schedulePaint();
    return () => {
      cancelAnimationFrame(frameRef.current);
      if (rerunRef.current) clearTimeout(rerunRef.current);
    };
  }, [schedulePaint, updateKeptShare]);

  const toImagePoint = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    return {
      x: ((event.clientX - rect.left) / rect.width) * source.width,
      y: ((event.clientY - rect.top) / rect.height) * source.height,
    };
  };

  const stamp = (cx: number, cy: number) => {
    const hints = hintsRef.current;
    const value = TOOL_VALUE[tool];
    const radiusSquared = brush * brush;
    const x0 = Math.max(0, Math.floor(cx - brush));
    const x1 = Math.min(source.width - 1, Math.ceil(cx + brush));
    const y0 = Math.max(0, Math.floor(cy - brush));
    const y1 = Math.min(source.height - 1, Math.ceil(cy + brush));

    for (let y = y0; y <= y1; y += 1) {
      for (let x = x0; x <= x1; x += 1) {
        if ((x - cx) ** 2 + (y - cy) ** 2 <= radiusSquared) hints[y * source.width + x] = value;
      }
    }
  };

  const strokeTo = (point: { x: number; y: number }) => {
    const last = strokeRef.current ?? point;
    const distance = Math.hypot(point.x - last.x, point.y - last.y);
    const steps = Math.max(1, Math.ceil(distance / Math.max(1, brush * 0.5)));
    for (let s = 1; s <= steps; s += 1) {
      stamp(last.x + ((point.x - last.x) * s) / steps, last.y + ((point.y - last.y) * s) / steps);
    }
    strokeRef.current = point;
    schedulePaint();
  };

  const moveCursor = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    const cursor = cursorRef.current;
    if (!cursor) return;
    const rect = event.currentTarget.getBoundingClientRect();
    const size = (brush * 2 * rect.width) / source.width;
    cursor.style.display = "block";
    cursor.style.width = `${size}px`;
    cursor.style.height = `${size}px`;
    cursor.style.left = `${event.clientX - rect.left - size / 2}px`;
    cursor.style.top = `${event.clientY - rect.top - size / 2}px`;
  };

  const undo = () => {
    const previous = undoRef.current.pop();
    if (!previous) return;
    hintsRef.current = previous;
    setUndoCount(undoRef.current.length);
    schedulePaint();
    scheduleRerun();
  };

  const clearMarks = () => {
    undoRef.current.push(hintsRef.current.slice());
    undoRef.current = undoRef.current.slice(-UNDO_LIMIT);
    setUndoCount(undoRef.current.length);
    hintsRef.current = new Uint8Array(hintsRef.current.length);
    schedulePaint();
    scheduleRerun();
  };

  const nothingKept = keptShare === 0;

  return (
    <div className="sk-workspace">
      <div className="sk-view">
        <div className="sk-view__bar">
          <Button size="sm" disabled={undoCount === 0} onClick={undo}>Undo</Button>
          <Button size="sm" onClick={clearMarks}>Clear marks</Button>
          <span className="sk-view__spacer" />
          <Segmented<View>
            label="View"
            value={view}
            onChange={setView}
            options={[
              { value: "marks", label: "Marks" },
              { value: "result", label: "Result" },
            ]}
          />
        </div>

        <div className="sk-fit">
          <div className="sk-fit__frame" style={{ ["--sk-ar" as string]: source.width / source.height }}>
            <canvas
              ref={canvasRef}
              data-testid="selection-canvas"
              width={source.width}
              height={source.height}
              className="sk-fit__canvas"
              onPointerDown={(event) => {
                event.currentTarget.setPointerCapture(event.pointerId);
                undoRef.current.push(hintsRef.current.slice());
                undoRef.current = undoRef.current.slice(-UNDO_LIMIT);
                setUndoCount(undoRef.current.length);
                if (rerunRef.current) clearTimeout(rerunRef.current);
                if (view === "result") setView("marks");
                strokeRef.current = null;
                strokeTo(toImagePoint(event));
              }}
              onPointerMove={(event) => {
                moveCursor(event);
                if (strokeRef.current) strokeTo(toImagePoint(event));
              }}
              onPointerUp={() => {
                if (!strokeRef.current) return;
                strokeRef.current = null;
                scheduleRerun();
              }}
              onPointerLeave={() => {
                if (cursorRef.current) cursorRef.current.style.display = "none";
              }}
            />
            <div ref={cursorRef} className="sk-fit__cursor" />
          </div>
        </div>
      </div>

      <div className="sk-ctl">
        <div className="sk-ctl__body">
          <h2 className="sk-ctl__title">Check the selection</h2>
          <p className="sk-ctl__hint">
            Tinted areas will be removed. Brush or click to correct them. The cut-out re-runs after each stroke.
          </p>

          <div className="sk-seg">
            <Segmented<Tool>
              label="Brush"
              value={tool}
              onChange={setTool}
              options={[
                { value: "keep", label: "Keep" },
                { value: "remove", label: "Remove" },
                { value: "erase", label: "Erase" },
              ]}
            />
          </div>

          <Slider label="Brush size" value={brush} min={2} max={60} step={1} format={(v) => `${v} px`} onChange={setBrush} />

          <div className="sk-key">
            <div className="sk-key__row">
              <span className="sk-swatch" style={{ background: "var(--color-success-solid)" }} />Keep mark
            </div>
            <div className="sk-key__row">
              <span className="sk-swatch" style={{ background: "var(--color-danger-solid)" }} />Remove mark
            </div>
            <div className="sk-key__row">
              <span className="sk-swatch" style={{ background: `rgb(${REMOVED.r} ${REMOVED.g} ${REMOVED.b})` }} />Removed area
              <span className="sk-key__share">{Math.round(keptShare * 100)}% kept</span>
            </div>
          </div>

          <div className="sk-thumb" style={{ ["--sk-ar" as string]: source.width / source.height }}>
            <canvas ref={resultRef} width={source.width} height={source.height} aria-label="Result" />
          </div>

          <Button size="sm" onClick={rerun} disabled={running}>
            {running ? "Cutting out..." : "Re-run cut-out"}
          </Button>

          {error && <ErrorNote>{error}</ErrorNote>}
          {nothingKept && !running && <ErrorNote>Nothing is selected. Use Keep to mark the item.</ErrorNote>}
        </div>

        <div className="sk-ctl__foot">
          <Button variant="primary" size="lg" disabled={running || nothingKept} onClick={onApprove}>
            Approve selection
          </Button>
          <Button variant="ghost" size="sm" onClick={onStartOver}>Choose another image</Button>
        </div>
      </div>
    </div>
  );
}
