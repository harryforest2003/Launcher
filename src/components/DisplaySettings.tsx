import type { ReactNode } from "react";
import { Gamepad2 } from "lucide-react";
import Toggle from "./Toggle";
import { BIG_ZOOM, setBigScreen, setControllerOn, setFullScreen, useDisplayMode } from "../utils/displayMode";

const BUTTONS: [string, string][] = [
  ["D-pad or left stick", "Move between buttons, cards and fields"],
  ["A", "Choose"],
  ["B", "Back, or close what's open"],
  ["LB / RB", "Jump to the sidebar / the page"],
  ["Right stick", "Scroll"],
  ["Menu", "Search everything"],
  ["View", "Full screen"],
];

/* Settings: full screen, Big screen and the controller. */
export default function DisplaySettings() {
  const display = useDisplayMode();
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
        {row("Full screen", "Fills the screen with the launcher. F11 or the controller's View button switches it too.", (
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
        <dl className="set-pad-map" aria-label="Controller buttons">
          {BUTTONS.map(([button, does]) => (
            <div key={button}>
              <dt>{button}</dt>
              <dd>{does}</dd>
            </div>
          ))}
        </dl>
        <p className="set-help">It only listens while the launcher is in front, so a game you start keeps the controller to itself.</p>
      </div>
    </section>
  );
}
