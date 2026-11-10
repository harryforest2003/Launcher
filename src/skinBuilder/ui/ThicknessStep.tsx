import { useEffect, useMemo, useRef, useState } from "react";
import SearchDropdown from "../../components/SearchDropdown";
import { buildModel, guessOrientation, type BuiltModel } from "../build";
import { SKIN_ITEMS, familyOf, findItem, profileFor } from "../catalog";
import type { BuildParams } from "../types";
import type { Draft } from "../workingImage";
import { Button, ErrorNote, SectionTitle, Slider } from "./shared";
import { CHECKERBOARD, fieldStyle, panelStyle } from "./styles";

type Props = {
  draft: Draft;
  params: BuildParams;
  onChange: (params: BuildParams) => void;
  onBack: () => void;
  onBuild: (built: BuiltModel) => void;
};

const ITEM_OPTIONS = SKIN_ITEMS.map((item) => ({ value: item.id, label: item.label }));

const ATLAS_PIXELS = 16384 * 16384;
const LARGEST_PREVIEW_PX = 520;

type Layer = "thickness" | "texture" | "glow";

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
  const thinnest = levelValues[0] ?? 0;
  const span = Math.max(0.001, (levelValues[levelValues.length - 1] ?? 1) - thinnest);

  for (let y = 0; y < raster.height; y += 1) {
    const cy = Math.min(cellsHigh - 1, Math.floor(y / k));
    for (let x = 0; x < raster.width; x += 1) {
      const cx = Math.min(cellsWide - 1, Math.floor(x / k));
      const level = levels[cy * cellsWide + cx];
      if (!level) continue;

      // Blue is thin, through purple, to hot pink at the thickest.
      const t = (levelValues[level - 1] - thinnest) / span;
      const p = (y * raster.width + x) * 4;
      image.data[p] = 40 + 215 * t;
      image.data[p + 1] = 90 * (1 - t) + 40 * t;
      image.data[p + 2] = 255 - 90 * t;
      image.data[p + 3] = 255;
    }
  }
  ctx.putImageData(image, 0, 0);

  if (handleRow < cellsHigh) {
    ctx.fillStyle = "#ffffff";
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

  const previewHeight = built ? built.raster.height : 128;
  const previewWidth = built ? built.raster.width : 128;
  const pixelSize = Math.min(LARGEST_PREVIEW_PX / previewHeight, LARGEST_PREVIEW_PX / previewWidth);

  // A texture can't hold more detail than the image it comes from.
  const sourceLongest = Math.max(draft.detail.width, draft.detail.height);
  const textureOutgrowsImage = params.textureSize > sourceLongest * 1.5;

  return (
    <div style={{ display: "flex", gap: 18, alignItems: "flex-start", flexWrap: "wrap" }}>
      <div style={{ ...panelStyle, flex: "1 1 360px", minWidth: 300, textAlign: "center" }}>
        <div style={{ display: "flex", gap: 8, justifyContent: "center", marginBottom: 12 }}>
          <Button active={shownLayer === "thickness"} onClick={() => setLayer("thickness")}>Thickness map</Button>
          <Button active={shownLayer === "texture"} onClick={() => setLayer("texture")}>Texture</Button>
          {params.glow && <Button active={shownLayer === "glow"} onClick={() => setLayer("glow")}>Glow</Button>}
        </div>

        <div style={{ display: "inline-block", lineHeight: 0, background: CHECKERBOARD, borderRadius: 8 }}>
          <canvas
            ref={canvasRef}
            data-testid="thickness-canvas"
            style={{
              width: previewWidth * pixelSize,
              height: previewHeight * pixelSize,
              imageRendering: "pixelated",
            }}
          />
        </div>

        {shownLayer === "thickness" && (
          <div style={{ color: "#999", fontSize: 12, marginTop: 10 }}>
            Blue is thin, pink is thick.{params.handleFraction > 0 ? " The white line marks where the handle starts." : ""}
          </div>
        )}
      </div>

      <div style={{ ...panelStyle, flex: "0 0 340px" }}>
        <div style={{ color: "#c084fc", fontSize: 16, marginBottom: 10 }}>Item and thickness</div>

        <label style={{ display: "block", fontSize: 13, color: "#ccc", marginBottom: 6 }}>Minecraft item</label>
        <SearchDropdown
          options={ITEM_OPTIONS}
          value={item.label}
          placeholder="Search items..."
          onChange={chooseItem}
        />
        {profile.note && <div style={{ color: "#999", fontSize: 12, marginTop: 8 }}>{profile.note}</div>}
        {family.length > 1 && (
          <label style={{ display: "flex", gap: 8, alignItems: "center", fontSize: 13, color: "#ccc", marginTop: 10 }}>
            <input
              type="checkbox"
              aria-label="Apply to every material"
              checked={params.allMaterials}
              onChange={(event) => patch({ allMaterials: event.target.checked })}
              style={{ accentColor: "#a855f7" }}
            />
            Apply to all {family.length} {item.group.toLowerCase() === "armour" ? "pieces of this type" : item.group.toLowerCase()}
          </label>
        )}

        <SectionTitle>Orientation</SectionTitle>
        <Slider
          label="Rotation"
          value={params.angle}
          min={-180}
          max={180}
          step={0.5}
          format={(v) => `${v}°`}
          onChange={(angle) => patch({ angle })}
        />
        <div style={{ display: "flex", gap: 8, marginBottom: 6 }}>
          <Button onClick={() => patch({ flip: !params.flip })} style={{ flex: 1 }}>Swap handle end</Button>
          <Button onClick={reguess} style={{ flex: 1 }}>Auto</Button>
        </div>

        <SectionTitle>Thickness, where 16 is one block</SectionTitle>
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

        <SectionTitle>Blocks and voxels</SectionTitle>
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
        <Slider
          label="Element limit"
          value={params.maxElements}
          min={100}
          max={2500}
          step={50}
          onChange={(maxElements) => patch({ maxElements })}
        />
        <div style={{ color: "#999", fontSize: 12, margin: "-4px 0 8px" }}>
          Flat areas stay as big blocks. Detail in the image becomes small voxels.
        </div>

        <SectionTitle>Glow</SectionTitle>
        <label style={{ display: "flex", gap: 8, alignItems: "center", fontSize: 13, color: "#ccc", marginBottom: 10 }}>
          <input
            type="checkbox"
            aria-label="Add a glow layer"
            checked={params.glow}
            onChange={(event) => patch({ glow: event.target.checked })}
            style={{ accentColor: "#a855f7" }}
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
        {params.glow && built && !built.glow && (
          <div style={{ color: "#fbbf24", fontSize: 12, marginBottom: 10 }}>
            Nothing in this image is bright enough to glow.
          </div>
        )}

        <SectionTitle>Size and resolution</SectionTitle>
        <Slider
          label="Model size"
          value={params.modelScale}
          min={0.3}
          max={1}
          step={0.05}
          format={(v) => `${Math.round(v * 100)}%`}
          onChange={(modelScale) => patch({ modelScale })}
        />
        <div style={{ display: "flex", gap: 10, marginBottom: 10 }}>
          <label style={{ flex: 1, fontSize: 13, color: "#ccc" }}>
            Texture
            <select
              aria-label="Texture size"
              value={params.textureSize}
              onChange={(event) => {
                const textureSize = Number(event.target.value) as BuildParams["textureSize"];
                patch({ textureSize, rows: Math.min(params.rows, textureSize) as BuildParams["rows"] });
              }}
              style={{ ...fieldStyle, marginTop: 4 }}
            >
              <option value={64}>64 px</option>
              <option value={128}>128 px</option>
              <option value={256}>256 px</option>
              <option value={512}>512 px</option>
              <option value={1024}>1024 px</option>
            </select>
          </label>
          <label style={{ flex: 1, fontSize: 13, color: "#ccc" }}>
            Shape detail
            <select
              aria-label="Shape detail"
              value={params.rows}
              onChange={(event) => patch({ rows: Number(event.target.value) as BuildParams["rows"] })}
              style={{ ...fieldStyle, marginTop: 4 }}
            >
              <option value={32}>Low</option>
              <option value={64}>Medium</option>
              {params.textureSize >= 128 && <option value={128}>High</option>}
              {params.textureSize >= 256 && <option value={256}>Very high</option>}
            </select>
          </label>
        </div>
        <label style={{ display: "flex", gap: 8, alignItems: "center", fontSize: 13, color: "#ccc", marginBottom: 12 }}>
          <input
            type="checkbox"
            aria-label="Smooth outline"
            checked={params.smoothOutline}
            onChange={(event) => patch({ smoothOutline: event.target.checked })}
            style={{ accentColor: "#a855f7" }}
          />
          Smooth outline, using the texture instead of extra elements
        </label>

        {textureOutgrowsImage && (
          <div style={{ color: "#fbbf24", fontSize: 12, marginBottom: 10 }}>
            Your image is only {sourceLongest} px, so a texture this large adds size without adding detail.
          </div>
        )}

        {stats && (
          <div data-testid="build-stats" style={{ fontSize: 13, color: "#ccc", lineHeight: 1.7, marginBottom: 12 }}>
            <div>Texture: {stats.width} x {stats.height} px</div>
            <div>
              Atlas space: {stats.atlasPixels.toLocaleString()} px, {stats.atlasShare < 0.01 ? "under 0.01" : stats.atlasShare.toFixed(2)}% of the maximum
            </div>
            <div>Model: {stats.elements} elements</div>
            {stats.detailReduced && (
              <div style={{ color: "#fbbf24", fontSize: 12 }}>Voxel detail was reduced to stay within the element limit.</div>
            )}
            {stats.elements > params.maxElements && (
              <div style={{ color: "#fbbf24", fontSize: 12 }}>
                This goes over the element limit. Lower the shape detail or the glow amount.
              </div>
            )}
          </div>
        )}

        {error && <div style={{ marginBottom: 12 }}><ErrorNote>{error}</ErrorNote></div>}

        <div style={{ display: "flex", gap: 8 }}>
          <Button onClick={onBack} style={{ flex: 1 }}>Back to selection</Button>
          <Button
            primary
            disabled={!built || built.elements.length === 0}
            onClick={() => built && onBuild(built)}
            style={{ flex: 1 }}
          >
            Build model
          </Button>
        </div>
      </div>
    </div>
  );
}
