import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import { Pipette } from "lucide-react";
import { clamp, hexToRgb, hsvToRgb, hueName, parseColor, rgbToHex, rgbToHsv, type HSV } from "./color.ts";
import "../components/ui/ui.css";
import "./appearance.css";

type Props = {
  value: string;
  /** Called on every change while dragging; `done` is true when a drag or key press ends. */
  onChange: (hex: string, done: boolean) => void;
};

/** Anything the browser understands as a colour (names like "teal" included), as #rrggbb. */
function readColor(text: string): string | null {
  const parsed = parseColor(text);
  if (parsed) return rgbToHex(parsed);
  if (!/^[a-z]+$/i.test(text.trim())) return null;
  // Named colours: let the browser resolve the name, then read back the pixel it paints.
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 1;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) return null;
  const probe = (fill: string) => {
    ctx.clearRect(0, 0, 1, 1);
    ctx.fillStyle = fill;
    ctx.fillStyle = text.trim();
    ctx.fillRect(0, 0, 1, 1);
    return ctx.getImageData(0, 0, 1, 1).data;
  };
  // An unknown name leaves the previous fill in place, so try two different ones.
  const a = probe("#000000");
  const b = probe("#ffffff");
  if (a[0] !== b[0] || a[1] !== b[1] || a[2] !== b[2]) return null;
  return rgbToHex({ r: a[0] / 255, g: a[1] / 255, b: a[2] / 255 });
}

type EyeDropperCtor = new () => { open: () => Promise<{ sRGBHex: string }> };

/*
 * The colour picker: a saturation/brightness area, a hue strip, a code field and (where the
 * system has one) a pick-from-screen dropper. Both sliders work from the keyboard: arrows
 * move one step, Shift+arrows ten, Page Up/Down and Home/End jump.
 */
export default function ColorPicker({ value, onChange }: Props) {
  const [hsv, setHsv] = useState<HSV>(() => rgbToHsv(hexToRgb(value) ?? { r: 0, g: 0, b: 0 }));
  const [code, setCode] = useState(value);
  const [codeError, setCodeError] = useState<string | null>(null);
  const lastSent = useRef(value);
  const keyed = useRef(false);
  const eyeDropper = (window as unknown as { EyeDropper?: EyeDropperCtor }).EyeDropper;

  // A colour set from outside (a preset, Reset) moves the handles; our own changes don't,
  // so the hue isn't lost while dragging through greys.
  useEffect(() => {
    if (value === lastSent.current) return;
    lastSent.current = value;
    setHsv(rgbToHsv(hexToRgb(value) ?? { r: 0, g: 0, b: 0 }));
    setCode(value);
    setCodeError(null);
  }, [value]);

  const send = (next: HSV, done: boolean) => {
    setHsv(next);
    const hex = rgbToHex(hsvToRgb(next));
    lastSent.current = hex;
    setCode(hex);
    setCodeError(null);
    onChange(hex, done);
  };

  /* ---- the saturation/brightness area ---- */

  const fromAreaPointer = (event: PointerEvent<HTMLDivElement>, done: boolean) => {
    const box = event.currentTarget.getBoundingClientRect();
    send({ h: hsv.h, s: clamp((event.clientX - box.left) / box.width, 0, 1), v: clamp(1 - (event.clientY - box.top) / box.height, 0, 1) }, done);
  };

  const onAreaKey = (event: KeyboardEvent) => {
    const step = event.shiftKey ? 0.1 : 0.01;
    let { s, v } = hsv;
    switch (event.key) {
      case "ArrowLeft": s -= step; break;
      case "ArrowRight": s += step; break;
      case "ArrowUp": v += step; break;
      case "ArrowDown": v -= step; break;
      case "PageUp": v += 0.1; break;
      case "PageDown": v -= 0.1; break;
      case "Home": s = 0; break;
      case "End": s = 1; break;
      default: return;
    }
    event.preventDefault();
    keyed.current = true;
    send({ h: hsv.h, s: clamp(s, 0, 1), v: clamp(v, 0, 1) }, false);
  };

  /* ---- the hue strip ---- */

  const fromStripPointer = (event: PointerEvent<HTMLDivElement>, done: boolean) => {
    const box = event.currentTarget.getBoundingClientRect();
    send({ ...hsv, h: clamp((event.clientX - box.left) / box.width, 0, 1) * 359.9 }, done);
  };

  const onStripKey = (event: KeyboardEvent) => {
    const step = event.shiftKey ? 10 : 1;
    let h = hsv.h;
    switch (event.key) {
      case "ArrowLeft":
      case "ArrowDown": h -= step; break;
      case "ArrowRight":
      case "ArrowUp": h += step; break;
      case "PageUp": h += 30; break;
      case "PageDown": h -= 30; break;
      case "Home": h = 0; break;
      case "End": h = 359; break;
      default: return;
    }
    event.preventDefault();
    keyed.current = true;
    send({ ...hsv, h: (h + 360) % 360 }, false);
  };

  /* Pointer dragging on the area and the strip: capture the pointer so the drag carries on
     outside the box, and give the handle keyboard focus so arrows continue from there. */
  const down = (event: PointerEvent<HTMLDivElement>, handler: (event: PointerEvent<HTMLDivElement>, done: boolean) => void) => {
    if (event.button !== 0) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    (event.currentTarget.querySelector("[role=slider]") as HTMLElement | null)?.focus({ preventScroll: true });
    handler(event, false);
  };
  const move = (event: PointerEvent<HTMLDivElement>, handler: (event: PointerEvent<HTMLDivElement>, done: boolean) => void, done: boolean) => {
    if (event.currentTarget.hasPointerCapture(event.pointerId)) handler(event, done);
  };

  const commitCode = () => {
    if (code.trim().toLowerCase() === value) return;
    const hex = readColor(code);
    if (!hex) {
      setCodeError("That isn't a colour the launcher knows. Try a code like #7b34e6, rgb(123 52 230), hsl(264 78% 55%) or a name like teal.");
      return;
    }
    lastSent.current = hex;
    setHsv(rgbToHsv(hexToRgb(hex)!));
    setCode(hex);
    setCodeError(null);
    onChange(hex, true);
  };

  const pickFromScreen = async () => {
    if (!eyeDropper) return;
    try {
      const { sRGBHex } = await new eyeDropper().open();
      const hex = readColor(sRGBHex);
      if (!hex) return;
      lastSent.current = hex;
      setHsv(rgbToHsv(hexToRgb(hex)!));
      setCode(hex);
      onChange(hex, true);
    } catch {
      // Cancelled with Escape: nothing changes.
    }
  };

  const pure = rgbToHex(hsvToRgb({ h: hsv.h, s: 1, v: 1 }));
  const name = hueName(hsv.h, hsv.s, hsv.v);
  // Keyboard changes count as finished (for Recent) when the handle loses focus.
  const settle = () => {
    if (keyed.current && lastSent.current === value) onChange(value, true);
    keyed.current = false;
  };

  return (
    <div className="cp">
      <div
        className="cp-area"
        style={{ background: `linear-gradient(to top, #000000, transparent), linear-gradient(to right, #ffffff, ${pure})` }}
        onPointerDown={(event) => down(event, fromAreaPointer)}
        onPointerMove={(event) => move(event, fromAreaPointer, false)}
        onPointerUp={(event) => move(event, fromAreaPointer, true)}
      >
        <div
          role="slider"
          tabIndex={0}
          aria-label="Colour: lightness and strength"
          aria-roledescription="2D slider"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(hsv.s * 100)}
          aria-valuetext={`${name}, strength ${Math.round(hsv.s * 100)} percent, brightness ${Math.round(hsv.v * 100)} percent`}
          className="cp-thumb"
          style={{ left: `${hsv.s * 100}%`, top: `${(1 - hsv.v) * 100}%`, background: value }}
          onKeyDown={onAreaKey}
          onBlur={settle}
        />
      </div>

      <div
        className="cp-hue"
        onPointerDown={(event) => down(event, fromStripPointer)}
        onPointerMove={(event) => move(event, fromStripPointer, false)}
        onPointerUp={(event) => move(event, fromStripPointer, true)}
      >
        <div
          role="slider"
          tabIndex={0}
          aria-label="Hue"
          aria-valuemin={0}
          aria-valuemax={359}
          aria-valuenow={Math.round(hsv.h)}
          aria-valuetext={`${Math.round(hsv.h)} degrees, ${hueName(hsv.h, 1, 1)}`}
          className="cp-thumb cp-thumb--hue"
          style={{ left: `${(hsv.h / 359.9) * 100}%`, background: pure }}
          onKeyDown={onStripKey}
          onBlur={settle}
        />
      </div>

      <div className="cp-row">
        <label className="cp-code">
          <span className="cp-code-label">Colour code or name</span>
          <input
            className="ui-input ui-input--mono"
            value={code}
            spellCheck={false}
            autoComplete="off"
            placeholder="teal, #f4c2d7..."
            aria-invalid={codeError ? true : undefined}
            aria-describedby={codeError ? "cp-code-error" : undefined}
            onChange={(event) => setCode(event.target.value)}
            onBlur={commitCode}
            onKeyDown={(event) => {
              if (event.key === "Enter") commitCode();
              if (event.key === "Escape") {
                setCode(value);
                setCodeError(null);
              }
            }}
          />
        </label>
        {eyeDropper && (
          <button
            type="button"
            className="ui-button ui-button--secondary cp-dropper"
            onClick={pickFromScreen}
            title="Pick a colour from anywhere on your screen"
          >
            <Pipette size={16} aria-hidden="true" />
            Pick from screen
          </button>
        )}
      </div>
      {codeError && (
        <p id="cp-code-error" role="alert" className="cp-error">
          {codeError}
        </p>
      )}
    </div>
  );
}
