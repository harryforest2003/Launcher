import { useEffect, useState } from "react";
import type { BuiltModel } from "../build";
import { familyOf, findItem } from "../catalog";
import type { BuildParams, SkinGroup } from "../types";
import type { Draft } from "../workingImage";
import ItemPreview3D from "./ItemPreview3D";
import { usePrompt } from "./prompt";
import { Button, ErrorNote, PromptDialog } from "./shared";
import { fieldStyle, panelStyle } from "./styles";

type Props = {
  draft: Draft;
  params: BuildParams;
  built: BuiltModel;
  saving: boolean;
  error: string | null;
  onDraftChange: (changes: Partial<Pick<Draft, "name" | "groupId">>) => void;
  onSave: () => void;
  /** Saves, then opens the model in Blockbench. Missing when Blockbench isn't in the launcher. */
  onOpenInBlockbench?: () => void;
  onEditSelection: () => void;
  onEditThickness: () => void;
  onDiscard: () => void;
};

const NEW_GROUP = "__new_group__";

export default function PreviewStep({
  draft,
  params,
  built,
  saving,
  error,
  onDraftChange,
  onSave,
  onOpenInBlockbench,
  onEditSelection,
  onEditThickness,
  onDiscard,
}: Props) {
  const [groups, setGroups] = useState<SkinGroup[]>([]);
  const [groupError, setGroupError] = useState<string | null>(null);
  const { request, ask } = usePrompt();

  useEffect(() => {
    window.skinBuilderAPI.getLibrary().then((library) => setGroups(library.groups)).catch((err) => {
      setGroupError(err instanceof Error ? err.message : String(err));
    });
  }, []);

  const chooseGroup = async (value: string) => {
    if (value !== NEW_GROUP) {
      onDraftChange({ groupId: value || null });
      return;
    }

    const name = await ask("Name for the new group");
    if (!name) return;

    try {
      const group = await window.skinBuilderAPI.createGroup(name);
      setGroups((current) => [...current, group]);
      onDraftChange({ groupId: group.id });
    } catch (err) {
      setGroupError(err instanceof Error ? err.message : String(err));
    }
  };

  const item = findItem(params.itemId);
  const family = familyOf(params.itemId);
  const appliesTo =
    params.allMaterials && family.length > 1
      ? `${family.length} ${item.group === "Armour" ? "pieces of this type" : item.group.toLowerCase()}`
      : item.label;
  const canSave = draft.name.trim().length > 0 && !saving;

  return (
    <div style={{ display: "flex", gap: 18, alignItems: "stretch", flexWrap: "wrap" }}>
      <div style={{ ...panelStyle, flex: "1 1 460px", minWidth: 320, minHeight: 520 }}>
        <ItemPreview3D built={built} display={built.display} />
      </div>

      <div style={{ ...panelStyle, flex: "0 0 300px" }}>
        <div style={{ color: "#c084fc", fontSize: 16, marginBottom: 12 }}>Your skin</div>

        <label style={{ display: "block", fontSize: 13, color: "#ccc", marginBottom: 12 }}>
          Name
          <input
            aria-label="Skin name"
            value={draft.name}
            maxLength={60}
            onChange={(event) => onDraftChange({ name: event.target.value })}
            style={{ ...fieldStyle, marginTop: 4 }}
          />
        </label>

        <label style={{ display: "block", fontSize: 13, color: "#ccc", marginBottom: 14 }}>
          Group
          <select
            aria-label="Group"
            value={draft.groupId ?? ""}
            onChange={(event) => chooseGroup(event.target.value)}
            style={{ ...fieldStyle, marginTop: 4 }}
          >
            <option value="">Single (no group)</option>
            {groups.map((group) => (
              <option key={group.id} value={group.id}>{group.name}</option>
            ))}
            <option value={NEW_GROUP}>New group...</option>
          </select>
        </label>

        <div data-testid="preview-stats" style={{ fontSize: 13, color: "#ccc", lineHeight: 1.7, marginBottom: 16 }}>
          <div>Applies to: {appliesTo}</div>
          <div>Texture: {built.raster.width} x {built.raster.height} px{built.glow ? ", plus glow" : ""}</div>
          <div>Atlas space: {built.atlasPixels.toLocaleString()} px</div>
          <div>Model: {built.elements.length} elements</div>
        </div>

        {(error || groupError) && (
          <div style={{ marginBottom: 12 }}><ErrorNote>{error ?? groupError}</ErrorNote></div>
        )}

        <Button primary disabled={!canSave} onClick={onSave} style={{ width: "100%", marginBottom: 8 }}>
          {saving ? "Saving..." : "Save"}
        </Button>
        {onOpenInBlockbench && (
          <Button
            disabled={!canSave}
            onClick={onOpenInBlockbench}
            title="Saves it, then opens it in Blockbench to change its shape or paint it"
            style={{ width: "100%", marginBottom: 8 }}
          >
            Save and open in Blockbench
          </Button>
        )}
        <div style={{ display: "flex", gap: 8, marginBottom: 8 }}>
          <Button onClick={onEditSelection} style={{ flex: 1 }}>Edit selection</Button>
          <Button onClick={onEditThickness} style={{ flex: 1 }}>Edit thickness</Button>
        </div>
        <Button danger onClick={onDiscard} style={{ width: "100%" }}>Discard</Button>
      </div>

      <PromptDialog request={request} />
    </div>
  );
}
