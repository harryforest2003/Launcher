import { useEffect, useMemo, useRef, useState } from "react";
import SearchDropdown from "../../components/SearchDropdown";
import { buildModel, guessOrientation, type BuiltModel } from "../build";
import { SKIN_ITEMS, familyOf, findItem, profileFor } from "../catalog";
import type { BuildParams } from "../types";
import type { Draft } from "../workingImage";
import Button from "../../components/ui/Button";
import Segmented from "../../components/ui/Segmented";
import { Slider } from "./shared";
import { fieldStyle } from "./styles";

type Props = {
  draft: Draft;
  params: BuildParams;
  onChange: (params: BuildParams) => void;
  onBack: () => void;
  onBuild: (built: BuiltModel) => void;
};

const ITEM_OPTIONS = SKIN_ITEMS.map((item) => ({ value: item.id, label: item.label }));

const ATLAS_PIXELS = 16384 * 16384;

type Layer = "thickness" | "texture" | "glow";

/** A theme colour as [r, g, b], whatever notation the token is written in. */
function themeRgb(token: string): number[] {
  const probe = document.createElement("canvas");
  probe.width = 1;
  probe.height = 1;
  const ctx = probe.getContext("2d", { willReadFrequently: true });
  if (!ctx) return [150, 110, 255];
  ctx.fillStyle = getComputedStyle(document.documentElement).getPropertyValue(token).trim() || "#9669ff";
  ctx.fillRect(0, 0, 1, 1);
  const [r, g, b] = ctx.getImageData(0, 0, 1, 1).data;
  return [r, g, b];
}

function drawLayer(canvas: HTMLCanvasElement, built: BuiltModel, layer: Layer) {
  const { raster, thickness, glow } = built;
  const { cellsWide, cellsHigh, texelsPerCell: k, levels, levelValues, handleRow } = thickness;

  canvas.width = raster.width;
  canvas.height = raster.height;
  const ctx = canvas.getContext("2d");
  if (!ctx) return;

  if (layer === "glow") {
    if (!glow) return;
    const still = document.createElement("canvas");
    still.width = glow.stillWidth;
    still.height = glow.stillHeight;
    still.getContext("2d")?.putImageData(new ImageData(new Uint8ClampedArray(glow.still), glow.stillWidth, glow.stillHeight), 0, 0);
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(still, 0, 0, raster.width, raster.height);
    return;
  }

  if (layer === "texture") {
    ctx.putImageData(new ImageData(new Uint8ClampedArray(raster.rgba), raster.width, raster.height), 0, 0);
    return;
  }

  const image = ctx.createImageData(raster.width, raster.height);
  const thin = themeRgb("--color-accent");
  const thick = themeRgb("--color-accent-text").map((c) => c + (255 - c) * 0.4);
  const thinnest = levelValues[0] ?? 0;
  const span = Math.max(0.001, (levelValues[levelValues.length - 1] ?? 1) - thinnest);

  for (let y = 0; y < raster.height; y += 1) {
    const cy = Math.min(cellsHigh - 1, Math.floor(y / k));
    for (let x = 0; x < raster.width; x += 1) {
      const cx = Math.min(cellsWide - 1, Math.floor(x / k));
      const level = levels[cy * cellsWide + cx];
      if (!level) continue;

      // Accent at the thinnest, through to a pale tint of it at the thickest.
      const t = (levelValues[level - 1] - thinnest) / span;
      const p = (y * raster.width + x) * 4;
      image.data[p] = thin[0] + (thick[0] - thin[0]) * t;
      image.data[p + 1] = thin[1] + (thick[1] - thin[1]) * t;
      image.data[p + 2] = thin[2] + (thick[2] - thin[2]) * t;
      image.data[p + 3] = 255;
    }
  }
  ctx.putImageData(image, 0, 0);

  if (handleRow < cellsHigh) {
    ctx.fillStyle = `rgb(${themeRgb("--color-warning-text").join(",")})`;
    ctx.fillRect(0, handleRow * k, raster.width, Math.max(1, raster.height / 128));
  }
}

export default function ThicknessStep({ draft, params, onChange, onBack, onBuild }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [built, setBuilt] = useState<BuiltModel | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [layer, setLayer] = useState<Layer>("thickness");

  const item = findItem(params.itemId);
  const profile = profileFor(params.itemId);
  const family = familyOf(params.itemId);
  // Turning glow off while viewing it falls back rather than showing an empty canvas.
  const shownLayer: Layer = layer === "glow" && !params.glow ? "thickness" : layer;

  const patch = (changes: Partial<BuildParams>) => onChange({ ...params, ...changes });

  useEffect(() => {
    const timer = setTimeout(() => {
      try {
        setBuilt(buildModel(draft.detail, draft.mask, draft.source.width, draft.source.height, params));
        setError(null);
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      }
    }, 100);
    return () => clearTimeout(timer);
  }, [draft.detail, draft.source, draft.mask, params]);

  useEffect(() => {
    if (canvasRef.current && built) drawLayer(canvasRef.current, built, shownLayer);
  }, [built, shownLayer]);

  const chooseItem = (itemId: string) => {
    const next = profileFor(itemId);
    const orientation = guessOrientation(draft.mask, draft.source.width, draft.source.height, itemId);
    onChange({
      ...params,
      itemId,
      angle: orientation.angle,
      flip: orientation.flip,
      handleFraction: orientation.handleFraction,
      edge: next.edge,
      middle: next.middle,
      handle: next.handle,
    });
  };

  const reguess = () => {
    const orientation = guessOrientation(draft.mask, draft.source.width, draft.source.height, params.itemId);
    patch(orientation);
  };

  const stats = useMemo(() => {
    if (!built) return null;
    const { raster, elements, faceCount, atlasPixels, thickness } = built;
    return {
      width: raster.width,
      height: raster.height,
      elements: elements.length,
      faces: faceCount,
      atlasPixels,
      atlasShare: (atlasPixels / ATLAS_PIXELS) * 100,
      detailReduced: thickness.detailReduced,
    };
  }, [built]);

  // A texture can't hold more detail than the image it comes from.
  const sourceLongest = Math.max(draft.detail.width, draft.detail.height);
  const textureOutgrowsImage = params.textureSize > sourceLongest * 1.5;

  const layerOptions: { value: Layer; label: string }[] = [
    { value: "thickness", label: "Thickness map" },
    { value: "texture", label: "Texture" },
    ...(params.glow ? [{ value: "glow" as Layer, label: "Glow" }] : []),
  ];
  const overLimit = stats ? stats.elements > params.maxElements : false;

  return (
    <div className="sk-workspace">
      <div className="sk-view sk-view--thick">
        <div className="sk-view__bar">
          <Segmented<Layer> label="Layer" value={shownLayer} onChange={setLayer} options={layerOptions} />
        </div>

        <div className="sk-fit">
          <div
            className="sk-fit__frame"
            style={{ ["--sk-ar" as string]: built ? built.raster.width / built.raster.height : 1 }}
          >
            <canvas ref={canvasRef} data-testid="thickness-canvas" className="sk-fit__canvas" style={{ cursor: "default" }} />
          </div>
        </div>

        <div className="sk-view__strip">
          {shownLayer === "thickness" && (
            <span className="sk-legend">
              Thin <span className="sk-legend__ramp" /> Thick
              {params.handleFraction > 0 && (
                <>
                  <span className="sk-legend__line" /> Handle starts
                </>
              )}
            </span>
          )}
          {stats && (
            <span data-testid="build-stats" style={{ display: "contents" }}>
              <span>Texture <b>{stats.width} x {stats.height} px</b></span>
              <span>
                Atlas <b>{stats.atlasShare < 0.01 ? "under 0.01" : stats.atlasShare.toFixed(2)}%</b> of the maximum
              </span>
              <span>Model <b>{stats.elements} elements</b></span>
              {stats.detailReduced && <span className="sk-view__warn">Voxel detail was reduced to stay within the element limit.</span>}
              {overLimit && <span className="sk-view__warn">This goes over the element limit. Lower the shape detail or the glow amount.</span>}
            </span>
          )}
          {params.glow && built && !built.glow && <span className="sk-view__warn">Nothing in this image is bright enough to glow.</span>}
          {textureOutgrowsImage && (
            <span className="sk-view__warn">Your image is only {sourceLongest} px, so a texture this large adds size without adding detail.</span>
          )}
          {error && <span className="sk-view__warn">{error}</span>}
        </div>
      </div>

      <div className="sk-ctl">
        <div className="sk-ctl__body">
          <h2 className="sk-ctl__title">Item and thickness</h2>

          <div className="sk-sec">
            <h3 className="sk-sec__title">Item</h3>
            <SearchDropdown options={ITEM_OPTIONS} value={item.label} placeholder="Search items..." onChange={chooseItem} />
            {profile.note && <p className="sk-sec__note">{profile.note}</p>}
            {family.length > 1 && (
              <label className="sk-sec__check">
                <input
                  type="checkbox"
                  aria-label="Apply to every material"
                  checked={params.allMaterials}
                  onChange={(event) => patch({ allMaterials: event.target.checked })}
                  style={{ accentColor: "var(--color-accent)" }}
                />
                Apply to all {family.length} {item.group.toLowerCase() === "armour" ? "pieces of this type" : item.group.toLowerCase()}
              </label>
            )}
          </div>

          <div className="sk-sec">
            <h3 className="sk-sec__title">Orientation</h3>
            <Slider label="Rotation" value={params.angle} min={-180} max={180} step={0.5} format={(v) => `${v}°`} onChange={(angle) => patch({ angle })} />
            <div className="sk-sec__pair">
              <Button size="sm" onClick={() => patch({ flip: !params.flip })}>Swap handle end</Button>
              <Button size="sm" onClick={reguess}>Auto</Button>
            </div>
          </div>

          <div className="sk-sec">
            <h3 className="sk-sec__title">Thickness, where 16 is one block</h3>
            <Slider label="Edge" value={params.edge} min={0.05} max={3} step={0.05} format={(v) => v.toFixed(2)} onChange={(edge) => patch({ edge })} />
            <Slider label="Middle" value={params.middle} min={0.1} max={5} step={0.05} format={(v) => v.toFixed(2)} onChange={(middle) => patch({ middle })} />
            <Slider label="Handle" value={params.handle} min={0.1} max={5} step={0.05} format={(v) => v.toFixed(2)} onChange={(handle) => patch({ handle })} />
            <Slider
              label="Handle length"
              value={params.handleFraction}
              min={0}
              max={0.9}
              step={0.01}
              format={(v) => (v === 0 ? "None" : `${Math.round(v * 100)}%`)}
              onChange={(handleFraction) => patch({ handleFraction })}
            />
          </div>

          <details className="sk-acc">
            <summary>Advanced</summary>
            <div className="sk-sec">
              <h3 className="sk-sec__title">Blocks and voxels</h3>
              <Slider label="Block steps" value={params.levels} min={2} max={12} step={1} onChange={(levels) => patch({ levels })} />
              <Slider
                label="Voxel detail"
                value={params.surfaceDetail}
                min={0}
                max={1}
                step={0.05}
                format={(v) => (v === 0 ? "Off" : `${Math.round(v * 100)}%`)}
                onChange={(surfaceDetail) => patch({ surfaceDetail })}
              />
              <Slider label="Element limit" value={params.maxElements} min={100} max={2500} step={50} onChange={(maxElements) => patch({ maxElements })} />
              <p className="sk-sec__note">Flat areas stay as big blocks. Detail in the image becomes small voxels.</p>
            </div>

            <div className="sk-sec">
              <h3 className="sk-sec__title">Glow</h3>
              <label className="sk-sec__check">
                <input
                  type="checkbox"
                  aria-label="Add a glow layer"
                  checked={params.glow}
                  onChange={(event) => patch({ glow: event.target.checked })}
                  style={{ accentColor: "var(--color-accent)" }}
                />
                Add a glow layer, animated with a still version
              </label>
              {params.glow && (
                <Slider
                  label="Glow amount"
                  value={params.glowAmount}
                  min={0.05}
                  max={1}
                  step={0.05}
                  format={(v) => `${Math.round(v * 100)}%`}
                  onChange={(glowAmount) => patch({ glowAmount })}
                />
              )}
            </div>


            <div className="sk-sec">
              <h3 className="sk-sec__title">Size and resolution</h3>
              <Slider
                label="Model size"
                value={params.modelScale}
                min={0.3}
                max={1}
                step={0.05}
                format={(v) => `${Math.round(v * 100)}%`}
                onChange={(modelScale) => patch({ modelScale })}
              />
              <div className="sk-sec__pair">
                <label>
                  Texture
                  <select
                    aria-label="Texture size"
                    value={params.textureSize}
                    onChange={(event) => {
                      const textureSize = Number(event.target.value) as BuildParams["textureSize"];
                      patch({ textureSize, rows: Math.min(params.rows, textureSize) as BuildParams["rows"] });
                    }}
                    style={fieldStyle}
                  >
                    <option value={64}>64 px</option>
                    <option value={128}>128 px</option>
                    <option value={256}>256 px</option>
                    <option value={512}>512 px</option>
                    <option value={1024}>1024 px</option>
                  </select>
                </label>
                <label>
                  Shape detail
                  <select
                    aria-label="Shape detail"
                    value={params.rows}
                    onChange={(event) => patch({ rows: Number(event.target.value) as BuildParams["rows"] })}
                    style={fieldStyle}
                  >
                    <option value={32}>Low</option>
                    <option value={64}>Medium</option>
                    {params.textureSize >= 128 && <option value={128}>High</option>}
                    {params.textureSize >= 256 && <option value={256}>Very high</option>}
                  </select>
                </label>
              </div>
              <label className="sk-sec__check">
                <input
                  type="checkbox"
                  aria-label="Smooth outline"
                  checked={params.smoothOutline}
                  onChange={(event) => patch({ smoothOutline: event.target.checked })}
                  style={{ accentColor: "var(--color-accent)" }}
                />
                Smooth outline, using the texture instead of extra elements
              </label>
            </div>
          </details>
        </div>

        <div className="sk-ctl__foot">
          <Button variant="primary" size="lg" disabled={!built || built.elements.length === 0} onClick={() => built && onBuild(built)}>
            Continue to preview
          </Button>
          <Button variant="ghost" size="sm" onClick={onBack}>Back to selection</Button>
        </div>
      </div>
    </div>
  );
}
