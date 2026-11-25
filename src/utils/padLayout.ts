/*
 * Which controller it is (Xbox, PlayStation, Switch or another), what its buttons are called,
 * and where its buttons are when the browser doesn't recognise it.
 *
 * Recognised pads come in the "standard" layout, by position: 0 bottom face button, 1 right,
 * 2 left, 3 top, 4/5 bumpers, 6/7 triggers, 8 back/select, 9 start, 12-15 d-pad, axes 0-3 the
 * sticks. Others (a PlayStation pad over Bluetooth on some systems, cheap pads) come raw: the
 * face buttons in another order and the d-pad as a hat on one axis.
 */

export type PadKind = "xbox" | "playstation" | "nintendo" | "generic";

/** What the launcher does with a button, by position on the pad. */
export type PadRole = "bottom" | "right" | "left" | "top" | "lb" | "rb" | "lt" | "rt" | "view" | "menu";

const VENDOR = /vendor:\s*([0-9a-f]{4})/i;
const PREFIX = /^([0-9a-f]{4})-([0-9a-f]{4})-/i;

export function vendorOf(id: string) {
  return (id.match(VENDOR)?.[1] ?? id.match(PREFIX)?.[1] ?? "").toLowerCase();
}

export function padKind(id: string): PadKind {
  const vendor = vendorOf(id);
  const name = id.toLowerCase();
  if (vendor === "054c" || /dualsense|dualshock|playstation|ps[345]\b/.test(name)) return "playstation";
  if (vendor === "045e" || /xbox|xinput/.test(name)) return "xbox";
  if (vendor === "057e" || /pro controller|joy-?con|nintendo|switch/.test(name)) return "nintendo";
  return "generic";
}

/* Button names as printed on each pad. A generic pad is labelled like an Xbox one, as most are. */
const LABELS: Record<Exclude<PadKind, "generic">, Record<PadRole, string>> = {
  xbox: { bottom: "A", right: "B", left: "X", top: "Y", lb: "LB", rb: "RB", lt: "LT", rt: "RT", view: "View", menu: "Menu" },
  playstation: { bottom: "✕", right: "○", left: "□", top: "△", lb: "L1", rb: "R1", lt: "L2", rt: "R2", view: "Create", menu: "Options" },
  nintendo: { bottom: "B", right: "A", left: "Y", top: "X", lb: "L", rb: "R", lt: "ZL", rt: "ZR", view: "−", menu: "+" },
};

export const padLabels = (kind: PadKind) => LABELS[kind === "generic" ? "xbox" : kind];

/* Names for the PlayStation shapes where a symbol alone could be missed by a screen reader. */
const SPOKEN: Record<string, string> = { "✕": "Cross", "○": "Circle", "□": "Square", "△": "Triangle", "−": "Minus", "+": "Plus" };
export const spokenLabel = (label: string) => SPOKEN[label] ?? label;

export const PAD_NAMES: Record<PadKind, string> = {
  xbox: "Xbox",
  playstation: "PlayStation",
  nintendo: "Switch",
  generic: "Controller",
};

/** Whether this kind usually chooses with the right face button (A on a Switch pad). */
export const choosesWithRight = (kind: PadKind) => kind === "nintendo";

type Layout = { buttons: Record<PadRole, number>; rightStick: [number, number] };

const STANDARD: Layout = {
  buttons: { bottom: 0, right: 1, left: 2, top: 3, lb: 4, rb: 5, lt: 6, rt: 7, view: 8, menu: 9 },
  rightStick: [2, 3],
};

/* A DualShock 4 or DualSense the browser hands over raw (DirectInput order). */
const SONY_RAW: Layout = {
  buttons: { left: 0, bottom: 1, right: 2, top: 3, lb: 4, rb: 5, lt: 6, rt: 7, view: 8, menu: 9 },
  rightStick: [2, 5],
};

export function layoutOf(pad: Gamepad): Layout {
  if (pad.mapping === "standard") return STANDARD;
  if (padKind(pad.id) === "playstation") return SONY_RAW;
  return STANDARD;
}

export type DpadState = { up: boolean; down: boolean; left: boolean; right: boolean };

/*
 * A raw pad's d-pad: buttons 12-15 if it has them, else a hat switch on one axis (-1 up,
 * then clockwise in steps of 2/7; anything past 1 is let go).
 */
export function dpadOf(pad: Gamepad): DpadState {
  const on = (i: number) => Boolean(pad.buttons[i]?.pressed);
  if (pad.mapping === "standard" || pad.buttons.length > 15) return { up: on(12), down: on(13), left: on(14), right: on(15) };
  const hat = pad.axes.length > 9 ? pad.axes[9] : undefined;
  if (hat === undefined || hat > 1.05 || hat < -1.05) return { up: false, down: false, left: false, right: false };
  const step = Math.round((hat + 1) / (2 / 7)); // 0 up, 1 up-right ... 7 up-left
  return {
    up: step === 7 || step === 0 || step === 1,
    right: step >= 1 && step <= 3,
    down: step >= 3 && step <= 5,
    left: step >= 5 && step <= 7,
  };
}
