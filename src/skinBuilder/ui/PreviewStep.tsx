import { useEffect, useState } from "react";
import type { BuiltModel } from "../build";
import { familyOf, findItem } from "../catalog";
import type { BuildParams, SkinGroup } from "../types";
import type { Draft } from "../workingImage";
import ItemPreview3D from "./ItemPreview3D";
import { usePrompt } from "./prompt";
import Button from "../../components/ui/Button";
import { ErrorNote, PromptDialog } from "./shared";
import { fieldStyle } from "./styles";

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
    <div className="sk-workspace sk-workspace--stretch">
      <div className="sk-view">
        <ItemPreview3D
          built={built}
          display={built.display}
          footer={
            <span data-testid="preview-stats" style={{ display: "contents" }}>
              <span>Applies to <b>{appliesTo}</b></span>
              <span>Texture <b>{built.raster.width} x {built.raster.height} px{built.glow ? ", plus glow" : ""}</b></span>
              <span>Atlas <b>{built.atlasPixels.toLocaleString()} px</b></span>
              <span>Model <b>{built.elements.length} elements</b></span>
            </span>
          }
        />
      </div>

      <div className="sk-ctl">
        <div className="sk-ctl__body">
        <h2 className="sk-ctl__title">Your item model</h2>

        <label style={{ display: "block", fontSize: 13, color: "var(--color-text-secondary)", marginBottom: 12 }}>
          Name
          <input
            aria-label="Model name"
            value={draft.name}
            maxLength={60}
            onChange={(event) => onDraftChange({ name: event.target.value })}
            style={{ ...fieldStyle, marginTop: 4 }}
          />
        </label>

        <label style={{ display: "block", fontSize: 13, color: "var(--color-text-secondary)", marginBottom: 14 }}>
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

        <div className="sk-sec">
          <h3 className="sk-sec__title">Applies to</h3>
          <div className="sk-appl">{appliesTo}</div>
        </div>

        <div className="sk-sec">
          <h3 className="sk-sec__title">Not right yet?</h3>
          <div className="sk-sec__pair">
            <Button size="sm" onClick={onEditSelection}>Edit selection</Button>
            <Button size="sm" onClick={onEditThickness}>Edit thickness</Button>
          </div>
        </div>

        {(error || groupError) && (
          <div style={{ marginBottom: 12 }}><ErrorNote>{error ?? groupError}</ErrorNote></div>
        )}

        </div>

        <div className="sk-ctl__foot">
          <Button variant="primary" size="lg" disabled={!canSave} onClick={onSave}>
            {saving ? "Saving..." : "Save"}
          </Button>
          {onOpenInBlockbench && (
            <Button
              disabled={!canSave}
              onClick={onOpenInBlockbench}
              title="Saves it, then opens it in Blockbench to change its shape or paint it"
            >
              Save and open in Blockbench
            </Button>
          )}
          <Button size="sm" variant="ghost" className="sk-ctl__discard" onClick={onDiscard}>Discard</Button>
        </div>
      </div>

      <PromptDialog request={request} />
    </div>
  );
}
