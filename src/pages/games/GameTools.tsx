import { useEffect, useState } from "react";
import { FileText, FolderOpen, History, Pencil, Play, Plus, SlidersHorizontal, Sparkles, Wrench } from "lucide-react";
import Toggle from "../../components/Toggle";
import IconButton from "../../components/IconButton";
import { BinIcon } from "../../components/Icons";
import SettingsLayout, { SettingsHeader, type SettingsCategory } from "../../components/SettingsLayout";
import { Badge, Button, Menu, Notice } from "../../components/ui";
import { errorText, shortDate, sizeText } from "./shared";
import GraphicsSection from "./GraphicsSection";

type Say = (text: string | null, tone?: "good" | "bad") => void;

const inputPad = { padding: "var(--space-2) var(--space-3)" };

/*
 * A game's tools page. For a Bethesda game: its modding tools (xEdit, BodySlide, Nemesis,
 * Pandora...), started from here (through CrossOver on a Mac), and its INI files, with quick
 * settings for the usual changes and a plain editor that keeps a copy before each save.
 * For any game on Windows: ReShade, and ENB where there is one.
 */
export default function GameTools({ detail }: { detail: GameDetail }) {
  const [message, setMessage] = useState<{ text: string; tone: "good" | "bad" } | null>(null);
  const say: Say = (text, tone = "good") => setMessage(text ? { text, tone } : null);

  // Modding tools and INI files are for Bethesda games; ReShade and ENB for any game on Windows.
  const bethesda = detail.loadOrder === "plugins";
  const categories: SettingsCategory[] = [
    ...(bethesda
      ? [
          {
            id: "tools",
            label: "Modding tools",
            group: "Tools",
            icon: <Wrench size={16} aria-hidden="true" />,
            content: <ToolsSection detail={detail} say={say} />,
          },
        ]
      : []),
    {
      id: "graphics",
      label: "ReShade & ENB",
      group: "Graphics",
      icon: <Sparkles size={16} aria-hidden="true" />,
      content: <GraphicsSection detail={detail} say={say} />,
    },
    ...(bethesda
      ? [
          {
            id: "ini",
            label: "INI files",
            group: "Settings files",
            icon: <SlidersHorizontal size={16} aria-hidden="true" />,
            content: <IniSection detail={detail} say={say} />,
          },
        ]
      : []),
  ];

  return (
    <div className="set-page" data-testid="game-tools">
      <SettingsHeader
        title={`${detail.name} tools`}
        lead={bethesda ? "Modding tools, ReShade and ENB, and the game's INI files." : "ReShade for the game's graphics, and ENB where it's made for the game."}
        status={bethesda ? "INI edits save with the Save button" : undefined}
      />
      {message && (
        <Notice tone={message.tone === "bad" ? "danger" : "success"} actions={<Button size="sm" variant="ghost" onClick={() => setMessage(null)}>Dismiss</Button>}>
          {message.text}
        </Notice>
      )}
      <SettingsLayout label={`${detail.name} tools sections`} categories={categories} />
    </div>
  );
}

/* ---------------- modding tools ---------------- */

function ToolsSection({ detail, say }: { detail: GameDetail; say: Say }) {
  const [data, setData] = useState<ModTools | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const [editing, setEditing] = useState<{ id: string; name: string; args: string } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    let current = true;
    window.gamesAPI
      .tools(detail.id)
      .then((found) => current && setData(found))
      .catch((err) => current && setFailed(errorText(err)));
    return () => {
      current = false;
    };
  }, [detail.id]);

  async function act(label: string, work: () => Promise<ModTools | null>) {
    setBusy(label);
    try {
      const next = await work();
      if (next) setData(next);
      return true;
    } catch (err) {
      say(errorText(err), "bad");
      return false;
    } finally {
      setBusy(null);
    }
  }

  async function run(tool: ModTool) {
    setBusy(tool.id);
    try {
      const started = await window.gamesAPI.runTool(detail.id, tool.id);
      say(`Started ${started.started}${started.bottle ? ` in the ${started.bottle} bottle` : ""}. It opens in its own window.`);
    } catch (err) {
      say(errorText(err), "bad");
    } finally {
      setBusy(null);
    }
  }

  if (failed) return <Notice tone="danger">{failed}</Notice>;
  if (!data) return <p className="set-help">Looking for tools...</p>;

  return (
    <section className="ui-panel set-panel set-flat" data-testid="tools-panel">
      {data.howToRun && <Notice tone="warning">{data.howToRun}</Notice>}
      {data.tools.length === 0 && (
        <div className="set-frow">
          <div className="set-frow-text">
            <h4 className="set-row-name">No tools found</h4>
            <p className="set-help">None are in or near {detail.name}'s folder. Add xEdit, BodySlide, Nemesis or Pandora by choosing its .exe.</p>
          </div>
        </div>
      )}
      {data.tools.map((tool) =>
        editing?.id === tool.id ? (
          <form
            key={tool.id}
            className="set-frow"
            data-testid="tool-edit"
            onSubmit={async (event) => {
              event.preventDefault();
              if (await act("save", () => window.gamesAPI.saveTool(detail.id, tool.id, { name: editing.name, args: editing.args }))) setEditing(null);
            }}
          >
            <div className="set-frow-text" style={{ display: "grid", gap: "var(--space-2)" }}>
              <input className="ui-input" style={inputPad} value={editing.name} onChange={(event) => setEditing({ ...editing, name: event.target.value })} aria-label="Name" maxLength={60} />
              <input
                className="ui-input"
                style={{ ...inputPad, fontFamily: "var(--font-mono, ui-monospace, monospace)" }}
                value={editing.args}
                onChange={(event) => setEditing({ ...editing, args: event.target.value })}
                aria-label="Arguments"
                placeholder={tool.kind === "xedit" ? "Arguments, e.g. -quickautoclean" : "Arguments (optional)"}
                spellCheck={false}
              />
              <p className="set-help">Arguments go to the tool as typed; put paths with spaces in "double quotes". On a Mac, paths are the bottle's Windows paths (C:\...).</p>
            </div>
            <div className="set-frow-ctl">
              <Button type="submit" size="sm" variant="primary" disabled={Boolean(busy)}>
                Save
              </Button>
              <Button size="sm" onClick={() => setEditing(null)}>
                Cancel
              </Button>
            </div>
          </form>
        ) : (
          <div key={tool.id} className="set-frow" data-testid="tool-row">
            <div className="set-frow-text" style={{ minWidth: 0 }}>
              <h4 className="set-row-name">
                {tool.name} {!tool.found && <Badge tone="neutral">Added</Badge>} {!tool.exists && <Badge tone="danger">Missing</Badge>}
              </h4>
              {tool.about && <p className="set-help">{tool.about}</p>}
              <p className="set-help" title={tool.exe} style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", direction: "rtl", textAlign: "left" }}>
                <bdi>{tool.exe}</bdi>
              </p>
              {tool.args && (
                <p className="set-help" style={{ fontFamily: "var(--font-mono, ui-monospace, monospace)" }}>
                  {tool.args}
                </p>
              )}
            </div>
            <div className="set-frow-ctl">
              <Button size="sm" variant="primary" icon={<Play size={14} aria-hidden="true" />} disabled={Boolean(busy) || !tool.exists || Boolean(data.howToRun)} onClick={() => void run(tool)}>
                {busy === tool.id ? "Starting..." : "Run"}
              </Button>
              <IconButton tip="Name and arguments" label={`Name and arguments for ${tool.name}`} onClick={() => setEditing({ id: tool.id, name: tool.name, args: tool.args })}>
                <Pencil size={14} aria-hidden="true" />
              </IconButton>
              <IconButton tip="Take off the list" label={`Take ${tool.name} off the list`} disabled={Boolean(busy)} onClick={() => void act("remove", () => window.gamesAPI.removeTool(detail.id, tool.id))}>
                <BinIcon size={14} />
              </IconButton>
            </div>
          </div>
        )
      )}
      <div className="set-frow">
        <div className="set-frow-text">
          <p className="set-help">Nemesis, Pandora and BodySlide write their output into the game's Data folder: run them again after animation or body mods change.</p>
        </div>
        <div className="set-frow-ctl">
          {data.hidden > 0 && (
            <Button size="sm" variant="ghost" disabled={Boolean(busy)} onClick={() => void act("show", () => window.gamesAPI.showAllTools(detail.id))}>
              Show {data.hidden} taken off
            </Button>
          )}
          <Button size="sm" icon={<Plus size={14} aria-hidden="true" />} disabled={Boolean(busy)} onClick={() => void act("add", () => window.gamesAPI.addTool(detail.id))} data-testid="tool-add">
            Add a tool...
          </Button>
        </div>
      </div>
    </section>
  );
}

/* ---------------- INI files ---------------- */

function IniSection({ detail, say }: { detail: GameDetail; say: Say }) {
  const [data, setData] = useState<IniFiles | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const [open, setOpen] = useState<IniFile | null>(null);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const changed = Boolean(open) && draft !== open?.text;

  useEffect(() => {
    let current = true;
    window.gamesAPI
      .iniList(detail.id)
      .then((found) => current && setData(found))
      .catch((err) => current && setFailed(errorText(err)));
    return () => {
      current = false;
    };
  }, [detail.id]);

  const refresh = async () => setData(await window.gamesAPI.iniList(detail.id));

  async function act(label: string, work: () => Promise<void>) {
    setBusy(label);
    try {
      await work();
    } catch (err) {
      say(errorText(err), "bad");
    } finally {
      setBusy(null);
    }
  }

  const show = (file: IniFile) => {
    setOpen(file);
    setDraft(file.text);
  };

  const openFile = (name: string) => {
    if (changed && !window.confirm(`Drop your changes to ${open?.name}?`)) return;
    void act("open", async () => show(await window.gamesAPI.iniRead(detail.id, name)));
  };

  if (failed) return <Notice tone="danger">{failed}</Notice>;
  if (!data) return <p className="set-help">Looking for the INI files...</p>;
  if (!data.folder) return <Notice tone="info">{detail.name} hasn't made its settings folder yet: start the game once, then come back.</Notice>;

  return (
    <section className="ui-panel set-panel set-flat" data-testid="ini-panel">
      <div className="set-frow set-frow--path">
        <div className="set-frow-text" style={{ minWidth: 0 }}>
          <h4 className="set-row-name">Settings folder</h4>
          <p className="set-help" title={data.folder} style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", direction: "rtl", textAlign: "left" }}>
            <bdi>{data.folder}</bdi>
          </p>
        </div>
        <div className="set-frow-ctl">
          <Button size="sm" icon={<FolderOpen size={14} aria-hidden="true" />} onClick={() => void act("folder", () => window.gamesAPI.openIniFolder(detail.id))}>
            Open
          </Button>
        </div>
      </div>

      {data.presets.map((preset) => (
        <div key={preset.id} className="set-frow" data-testid={`ini-preset-${preset.id}`}>
          <div className="set-frow-text">
            <h4 className="set-row-name">
              {preset.label} {preset.state === "partial" && <Badge tone="warning">Partly set</Badge>}
            </h4>
            <p className="set-help">
              {preset.detail} In {preset.file}.
            </p>
          </div>
          <div className="set-frow-ctl">
            <Toggle
              on={preset.state === "on"}
              label={preset.label}
              disabled={Boolean(busy)}
              onChange={(on) =>
                void act("preset", async () => {
                  setData(await window.gamesAPI.iniPreset(detail.id, preset.id, on));
                  // The editor shows the file as it is now, when it's the one changed and not being edited.
                  if (open && open.name.toLowerCase() === preset.file.toLowerCase() && !changed) show(await window.gamesAPI.iniRead(detail.id, open.name));
                  say(`${preset.label} ${on ? "on" : "off"} in ${preset.file}. A copy from before is kept.`);
                })
              }
            />
          </div>
        </div>
      ))}

      {data.files.map((file) => (
        <div key={file.name} className="set-frow" data-testid="ini-file">
          <div className="set-frow-text">
            <h4 className="set-row-name">
              <FileText size={14} aria-hidden="true" style={{ verticalAlign: "-2px", marginRight: 6 }} />
              {file.name}
            </h4>
            <p className="set-help">
              {file.size ? sizeText(file.size) : "Empty"} · changed {shortDate(file.modified)}
              {file.backups ? ` · ${file.backups} ${file.backups === 1 ? "copy" : "copies"} kept` : ""}
            </p>
          </div>
          <div className="set-frow-ctl">
            <Button size="sm" variant={open?.name === file.name ? "primary" : "secondary"} disabled={Boolean(busy)} onClick={() => openFile(file.name)}>
              {open?.name === file.name ? "Editing" : "Edit"}
            </Button>
          </div>
        </div>
      ))}
      {data.files.length === 0 && <p className="set-help">No INI files in the folder yet.</p>}

      {open && (
        <div className="set-frow" style={{ display: "block" }} data-testid="ini-editor">
          <div style={{ display: "flex", alignItems: "center", gap: "var(--space-2)", marginBottom: "var(--space-2)", flexWrap: "wrap" }}>
            <h4 className="set-row-name" style={{ flex: 1, margin: 0 }}>
              {open.name}
              {changed ? " (not saved)" : ""}
            </h4>
            {open.backups.length > 0 && (
              <Menu
                align="end"
                label={`Put back an earlier copy of ${open.name}`}
                triggerClassName="ui-button ui-button--secondary ui-button--sm"
                trigger={
                  <>
                    <History size={14} aria-hidden="true" />
                    Earlier copies
                  </>
                }
                items={open.backups.map((copy) => ({
                  label: `${new Date(copy.at).toLocaleString()} (${sizeText(copy.size)})`,
                  onSelect: () => {
                    if (!window.confirm(`Put back ${open.name} as it was on ${new Date(copy.at).toLocaleString()}? What's there now is kept as a copy too.`)) return;
                    void act("restore", async () => {
                      show(await window.gamesAPI.iniRestore(detail.id, open.name, copy.id));
                      await refresh();
                      say(`Put back ${open.name} from ${new Date(copy.at).toLocaleString()}.`);
                    });
                  },
                }))}
              />
            )}
            <Button size="sm" disabled={!changed || Boolean(busy)} onClick={() => setDraft(open.text)}>
              Undo changes
            </Button>
            <Button
              size="sm"
              variant="primary"
              disabled={!changed || Boolean(busy)}
              data-testid="ini-save"
              onClick={() =>
                void act("save", async () => {
                  show(await window.gamesAPI.iniSave(detail.id, open.name, draft));
                  await refresh();
                  say(`Saved ${open.name}. The copy from before is under Earlier copies.`);
                })
              }
            >
              {busy === "save" ? "Saving..." : "Save"}
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                if (changed && !window.confirm(`Drop your changes to ${open.name}?`)) return;
                setOpen(null);
              }}
            >
              Close
            </Button>
          </div>
          <textarea
            className="ui-input"
            aria-label={`${open.name} text`}
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            spellCheck={false}
            wrap="off"
            style={{ ...inputPad, width: "100%", minHeight: 360, resize: "vertical", fontFamily: "var(--font-mono, ui-monospace, monospace)", fontSize: 12, lineHeight: 1.5, boxSizing: "border-box", whiteSpace: "pre" }}
          />
          <p className="set-help">Close the game before saving: it writes some of these files when it quits.</p>
        </div>
      )}
    </section>
  );
}
