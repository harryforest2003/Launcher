import { useState, type ReactNode } from "react";
import { Gamepad2 } from "lucide-react";
import Toggle from "./Toggle";
import { Segmented } from "./ui";
import { BIG_ZOOM, setBigScreen, setControllerOn, setFullScreen, setPadChoose, useDisplayMode, type PadChoose } from "../utils/displayMode";
import { choosesWithRight, padLabels, spokenLabel, type PadKind } from "../utils/padLayout";

/* What each button does, named as printed on the pad that's connected (Xbox names if none). */
function buttonsFor(kind: PadKind, rightChooses: boolean): [string, string, string?][] {
  const b = padLabels(kind);
  const [yes, no] = rightChooses ? [b.right, b.bottom] : [b.bottom, b.right];
  return [
    ["D-pad or left stick", "Move between buttons, cards and fields"],
    [yes, "Choose", spokenLabel(yes)],
    [no, "Back, or close what's open", spokenLabel(no)],
    [`${b.lb} / ${b.rb}`, "Jump to the sidebar / the page"],
    [`${b.lt} / ${b.rt}`, "A page up / down"],
    ["Right stick", "Scroll"],
    [b.menu, "Search everything", spokenLabel(b.menu)],
    [b.view, "Full screen", spokenLabel(b.view)],
  ];
}

const KINDS: { value: PadKind; label: string }[] = [
  { value: "xbox", label: "Xbox" },
  { value: "playstation", label: "PlayStation" },
  { value: "nintendo", label: "Switch" },
];

/* Settings: full screen, Big screen and the controller. */
export default function DisplaySettings() {
  const display = useDisplayMode();
  // With nothing connected, the legend can be shown for any pad.
  const [preview, setPreview] = useState<PadKind>("xbox");
  const kind = display.pad && display.padKind !== "generic" ? display.padKind : display.pad ? "xbox" : preview;
  const rightChooses = display.padChoose === "right" || (display.padChoose === "auto" && choosesWithRight(kind));
  const names = padLabels(kind);
  const row = (name: string, help: string, control: ReactNode) => (
    <div className="set-frow">
      <div className="set-frow-text">
        <h4 className="set-row-name">{name}</h4>
        <p className="set-help">{help}</p>
      </div>
      <div className="set-frow-ctl">{control}</div>
    </div>
  );
  return (
    <section id="display" aria-labelledby="display-title" className="ui-panel set-panel" data-testid="display-settings">
      <div className="set-section">
        <div className="set-panel-head">
          <div>
            <h2 id="display-title" className="set-panel-title">
              <Gamepad2 size={18} aria-hidden="true" />
              Big screen and controller
            </h2>
            <p className="set-lead">For playing on a TV: fill the screen, make everything larger and move around with a controller.</p>
          </div>
        </div>
        {row("Full screen", "Fills the screen with the launcher. F11 or the controller's View button (Create on PlayStation, − on Switch) switches it too.", (
          <Toggle on={display.fullScreen} label="Full screen" onChange={(on) => void setFullScreen(on)} />
        ))}
        {row("Big screen", `Everything ${Math.round((BIG_ZOOM - 1) * 100)}% larger, easier to read from across the room. Kept on this computer.`, (
          <Toggle on={display.bigScreen} label="Big screen" onChange={setBigScreen} />
        ))}
        {row(
          "Controller",
          display.pad
            ? `${display.pad} is connected.${display.controller ? "" : " It's ignored while this is off."}`
            : "No controller found yet. Connect one and press any button.",
          <Toggle on={display.controller} label="Move around with a controller" onChange={setControllerOn} />
        )}
        {row(
          "Choose with",
          `Which face button chooses; the other goes back. As the pad does: the bottom one on Xbox and PlayStation, A (right) on Switch.`,
          <Segmented<PadChoose>
            label="Choose with"
            value={display.padChoose}
            options={[
              { value: "auto", label: "As the pad does" },
              { value: "bottom", label: `${spokenLabel(names.bottom)} (bottom)` },
              { value: "right", label: `${spokenLabel(names.right)} (right)` },
            ]}
            onChange={setPadChoose}
          />
        )}
        {!display.pad && (
          <Segmented<PadKind> label="Show the buttons of" value={preview} options={KINDS} onChange={setPreview} />
        )}
        <dl className="set-pad-map" aria-label="Controller buttons" data-testid="pad-map">
          {buttonsFor(kind, rightChooses).map(([button, does, spoken]) => (
            <div key={does}>
              <dt aria-label={spoken && spoken !== button ? spoken : undefined}>{button}</dt>
              <dd>{does}</dd>
            </div>
          ))}
        </dl>
        <p className="set-help">It only listens while the launcher is in front, so a game you start keeps the controller to itself.</p>
      </div>
    </section>
  );
}
