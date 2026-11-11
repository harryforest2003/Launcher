import BackgroundLogo from "../components/BackgroundLogo";
import { useCallback, useEffect, useRef, useState } from "react";
import BlockbenchFrame from "../components/BlockbenchFrame";
import Sidebar from "../components/MCSidebar";
import { applyBlockbenchEdit } from "../skinBuilder/blockbenchEdit";
import { profileFor } from "../skinBuilder/catalog";
import type { BuiltModel } from "../skinBuilder/build";
import { CutoutCancelled, runCutout } from "../skinBuilder/cutoutClient";
import type { BuildParams, SkinMeta } from "../skinBuilder/types";
import ImportStep from "../skinBuilder/ui/ImportStep";
import LibraryView from "../skinBuilder/ui/LibraryView";
import PreviewStep from "../skinBuilder/ui/PreviewStep";
import SelectionStep from "../skinBuilder/ui/SelectionStep";
import ThicknessStep from "../skinBuilder/ui/ThicknessStep";
import {
  firstParams,
  imageDataOf,
  loadDraft,
  loadWorkingImage,
  saveDraft,
  type Draft,
} from "../skinBuilder/workingImage";

type Props = {
  onBack: () => void;
  goHome: () => void;
  goMinecraft: () => void;
  goDiscover: () => void;
  goLibrary: () => void;
  goSkinSelector: () => void;
  goSettings: () => void;
};

type Step = "library" | "import" | "selection" | "thickness" | "preview";

const WIZARD_STEPS: { id: Step; label: string }[] = [
  { id: "import", label: "Import" },
  { id: "selection", label: "Selection" },
  { id: "thickness", label: "Item and thickness" },
  { id: "preview", label: "Preview" },
];

const DEFAULT_ITEM = "diamond_sword";

export default function SkinBuilder({
  onBack,
  goHome,
  goMinecraft,
  goDiscover,
  goLibrary,
  goSkinSelector,
  goSettings,
}: Props) {
  const [step, setStep] = useState<Step>("library");
  const [draft, setDraft] = useState<Draft | null>(null);
  const [params, setParams] = useState<BuildParams | null>(null);
  const [built, setBuilt] = useState<BuiltModel | null>(null);
  const [busy, setBusy] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const reset = () => {
    setDraft(null);
    setParams(null);
    setBuilt(null);
    setError(null);
  };

  const importFile = async (file: File) => {
    setBusy(true);
    setError(null);
    try {
      const { source, detail, name } = await loadWorkingImage(file);
      const hints = new Uint8Array(source.width * source.height);
      const mask = await runCutout(imageDataOf(source), null);

      setDraft({ id: null, createdAt: null, name, groupId: null, source, detail, mask, hints, params: null });
      setParams(null);
      setBuilt(null);
      setStep("selection");
      setBusy(false);
    } catch (err) {
      // A second image was dropped, and that one's result will arrive instead.
      if (err instanceof CutoutCancelled) return;
      setError(err instanceof Error ? err.message : String(err));
      setBusy(false);
    }
  };

  const editSaved = async (skin: SkinMeta) => {
    setError(null);
    setNotice(null);
    try {
      const loaded = await loadDraft(skin);
      setDraft(loaded);
      setParams(loaded.params);
      setBuilt(null);
      setStep("thickness");
    } catch (err) {
      setNotice(null);
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const updateSelection = useCallback((mask: Uint8Array, hints: Uint8Array) => {
    setDraft((current) => (current ? { ...current, mask, hints } : current));
    setBuilt(null);
  }, []);

  const approveSelection = () => {
    if (!draft) return;
    // Standing the item upright depends on the selection, so a changed one is redone.
    setParams((current) => {
      if (!current) return firstParams(draft, DEFAULT_ITEM);
      const fresh = firstParams(draft, current.itemId);
      return { ...current, angle: fresh.angle, flip: fresh.flip };
    });
    setStep("thickness");
  };

  // Saves the model and goes back to the library. Resolves with the saved skin, or null.
  const save = async () => {
    if (!draft || !built || !params) return null;
    setSaving(true);
    setError(null);
    let saved: SkinMeta | null = null;
    try {
      saved = await saveDraft({ ...draft, name: draft.name.trim() }, built, params);
      setNotice(`Saved "${saved.name}".`);
      reset();
      setStep("library");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
    setSaving(false);
    return saved;
  };

  // Blockbench edits saved skins, so a new one is saved first.
  const saveAndOpenInBlockbench = async () => {
    const saved = await save();
    if (saved) await editInBlockbench(saved, `Saved "${saved.name}".`);
  };

  const discard = () => {
    if (!window.confirm("Discard this skin? Anything since your last save will be lost.")) return;
    reset();
    setNotice(null);
    setStep("library");
  };

  // A saved skin open in Blockbench, and a number that reloads the library after.
  const [inBlockbench, setInBlockbench] = useState<SkinMeta | null>(null);
  const [libraryVersion, setLibraryVersion] = useState(0);
  const [blockbenchReady, setBlockbenchReady] = useState(false);

  useEffect(() => {
    window.blockbenchAPI
      .available()
      .then((ready) => {
        setBlockbenchReady(ready);
        // Started now, so it opens at once when a Blockbench button is pressed.
        if (ready) window.blockbenchAPI.prepare().catch(() => {});
      })
      .catch(() => {});
  }, []);

  // Set from the first click, so a quick second one can't open another editor and take
  // down the bar of the one that's open.
  const blockbenchOpen = useRef(false);

  // `unchanged` is what to say if Blockbench closes with nothing saved.
  async function editInBlockbench(skin: SkinMeta, unchanged?: string) {
    if (blockbenchOpen.current) return;
    blockbenchOpen.current = true;

    setInBlockbench(skin);
    setError(null);
    setNotice(null);

    try {
      const saved = await window.skinBuilderAPI.editInBlockbench(skin.id);

      if (saved) {
        await applyBlockbenchEdit(skin, saved, profileFor(skin.itemId).frame === "diagonal");
        setNotice(`Updated "${skin.name}" from Blockbench.`);
      } else if (unchanged) {
        setNotice(unchanged);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, "") : String(err));
    }

    blockbenchOpen.current = false;
    setInBlockbench(null);
    setLibraryVersion((version) => version + 1);
  }

  const inWizard = step !== "library";
  const stepIndex = WIZARD_STEPS.findIndex((entry) => entry.id === step);

  return (
    <div
      style={{
        display: "flex",
        height: "100vh",
        backgroundColor: "#0d0d0d",
        color: "white",
      }}
    >
      <Sidebar
        currentPage="skinbuilder"
        goHome={goHome}
        goMinecraft={goMinecraft}
        goDiscover={goDiscover}
        goLibrary={goLibrary}
        goSkinSelector={goSkinSelector}
        goSettings={goSettings}
        showBack
        onBack={onBack}
      />

      <div style={{ flex: 1, minWidth: 0, position: "relative", display: "flex", overflow: "hidden" }}>
      {inWizard && <BackgroundLogo />}
      {inBlockbench && <BlockbenchFrame title={`Editing ${inBlockbench.name}`} />}

      {/* The library fits the window and only its models scroll; the wizard steps scroll as a page. */}
      <div
        style={{
          flex: 1,
          minWidth: 0,
          overflow: "auto",
          padding: 26,
          boxSizing: "border-box",
          position: "relative",
          ...(inWizard ? {} : { display: "flex", flexDirection: "column" }),
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 16, flexWrap: "wrap", marginBottom: 18, flexShrink: 0 }}>
          <h2 style={{ color: "#c084fc", fontSize: "1.8rem", margin: 0, fontFamily: "'Orbitron', sans-serif" }}>
            Model Builder
          </h2>

          {inWizard && (
            <ol
              aria-label="Progress"
              style={{ display: "flex", gap: 8, listStyle: "none", margin: 0, padding: 0, flexWrap: "wrap", fontSize: 13 }}
            >
              {WIZARD_STEPS.map((entry, index) => (
                <li
                  key={entry.id}
                  aria-current={entry.id === step ? "step" : undefined}
                  style={{
                    padding: "5px 11px",
                    borderRadius: 999,
                    border: "1px solid #6d28d9",
                    background: entry.id === step ? "#6d28d9" : "transparent",
                    color: index > stepIndex ? "#777" : "white",
                  }}
                >
                  {index + 1}. {entry.label}
                </li>
              ))}
            </ol>
          )}

          {inWizard && (
            <button
              type="button"
              className="sidebar-button"
              onClick={() => {
                if (draft && !window.confirm("Leave this skin? Anything since your last save will be lost.")) return;
                reset();
                setStep("library");
              }}
              style={{ marginLeft: "auto", padding: "8px 12px", fontSize: 13 }}
            >
              Back to my skins
            </button>
          )}
        </div>

        {step === "library" && (
          <>
            {error && <div style={{ color: "#fda4af", marginBottom: 12, flexShrink: 0 }}>{error}</div>}
            <LibraryView
              key={libraryVersion}
              notice={notice}
              onEditInBlockbench={editInBlockbench}
              onNewSkin={() => {
                reset();
                setNotice(null);
                setStep("import");
              }}
              onEdit={editSaved}
            />
          </>
        )}

        {step === "import" && <ImportStep busy={busy} error={error} onFile={importFile} />}

        {step === "selection" && draft && (
          <SelectionStep
            draft={draft}
            onChange={updateSelection}
            onApprove={approveSelection}
            onStartOver={() => {
              reset();
              setStep("import");
            }}
          />
        )}

        {step === "thickness" && draft && params && (
          <ThicknessStep
            draft={draft}
            params={params}
            onChange={setParams}
            onBack={() => setStep("selection")}
            onBuild={(model) => {
              setBuilt(model);
              setStep("preview");
            }}
          />
        )}

        {step === "preview" && draft && params && built && (
          <PreviewStep
            draft={draft}
            params={params}
            built={built}
            saving={saving}
            error={error}
            onDraftChange={(changes) => setDraft((current) => (current ? { ...current, ...changes } : current))}
            onSave={save}
            onOpenInBlockbench={blockbenchReady ? saveAndOpenInBlockbench : undefined}
            onEditSelection={() => setStep("selection")}
            onEditThickness={() => setStep("thickness")}
            onDiscard={discard}
          />
        )}
      </div>
      </div>
    </div>
  );
}
