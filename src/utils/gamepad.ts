import { toast } from "../components/ui";
import { displayState, setPadName, toggleFullScreen } from "./displayMode";

/*
 * Moving around the launcher with a controller (standard layout: Xbox, PlayStation, Switch Pro).
 * D-pad or left stick: move between controls. A: choose. B: back (Escape). Menu: search.
 * View: full screen. LB / RB: the sidebar / the page. Right stick: scroll.
 * Only while the launcher's window has focus, so a game in front keeps its controller.
 */

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';
const REPEAT_DELAY = 400;
const REPEAT_EVERY = 120;
const STICK = 0.5;
const SCROLL_DEAD = 0.2;

type Dir = "up" | "down" | "left" | "right";
const ARROW: Record<Dir, string> = { up: "ArrowUp", down: "ArrowDown", left: "ArrowLeft", right: "ArrowRight" };

const visible = (el: HTMLElement) => {
  if (el.closest("[inert]")) return false;
  const rect = el.getBoundingClientRect();
  if (rect.width === 0 && rect.height === 0) return false;
  return getComputedStyle(el).visibility !== "hidden";
};

/** Where focus may go: the dialog or drawer on top, else the whole launcher. */
function scope(): HTMLElement {
  const layers = [...document.querySelectorAll<HTMLElement>('dialog[open], [aria-modal="true"]')].filter(visible);
  return layers[layers.length - 1] ?? document.body;
}

const focusables = (root: ParentNode) => [...root.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(visible);

function focus(el: HTMLElement) {
  el.focus({ preventScroll: true });
  el.scrollIntoView({ block: "nearest", inline: "nearest" });
}

function send(el: Element, key: string) {
  const init = { key, code: key, bubbles: true, cancelable: true };
  const down = new KeyboardEvent("keydown", init);
  el.dispatchEvent(down);
  el.dispatchEvent(new KeyboardEvent("keyup", init));
  return down;
}

const current = () => {
  const el = document.activeElement;
  return el instanceof HTMLElement && el !== document.body ? el : null;
};

/**
 * Where to start when nothing (or only a drawer itself) has focus: the first control in view,
 * passing over a drawer's close button so the next press reaches its choices and Play.
 */
function start(root: HTMLElement) {
  const inPage = root === document.body ? document.querySelector<HTMLElement>("main") : null;
  const list = focusables(inPage ?? root).filter((el) => !/^close\b/i.test(el.getAttribute("aria-label") ?? ""));
  const inView = list.find((el) => {
    const rect = el.getBoundingClientRect();
    return rect.bottom > 0 && rect.top < window.innerHeight;
  });
  const first = inView ?? list[0] ?? focusables(root)[0];
  if (first) focus(first);
}

/* Lists, menus and tabs move with their own arrow keys; everything else moves on screen. */
function ownsArrow(el: HTMLElement, dir: Dir) {
  const vertical = dir === "up" || dir === "down";
  const role = el.getAttribute("role");
  if (role === "combobox" || role === "listbox") return vertical;
  if (el.closest('[role="menu"], [role="listbox"]')) return true;
  if (role === "tab" || role === "radio" || role === "slider") return !vertical;
  return false;
}

/*
 * A drop-down or a range moves its value with left and right, like a console's settings.
 * Options ending in "..." start something (sign in, make a group), so stepping skips them;
 * with nowhere left to step, focus moves on instead of sticking.
 */
function stepValue(el: HTMLElement, dir: Dir) {
  if (dir !== "left" && dir !== "right") return false;
  const by = dir === "right" ? 1 : -1;
  if (el instanceof HTMLSelectElement) {
    for (let next = el.selectedIndex + by; next >= 0 && next < el.options.length; next += by) {
      const option = el.options[next];
      if (option.disabled || /(\.\.\.|\u2026)\s*$/.test(option.text)) continue;
      el.selectedIndex = next;
      el.dispatchEvent(new Event("change", { bubbles: true }));
      return true;
    }
    return false;
  }
  if (el instanceof HTMLInputElement && el.type === "range") {
    if (by > 0) el.stepUp();
    else el.stepDown();
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
    return true;
  }
  return false;
}

function move(dir: Dir) {
  const root = scope();
  const from = current();
  if (!from || !root.contains(from) || !from.matches(FOCUSABLE)) return start(root);
  if (ownsArrow(from, dir)) return void send(from, ARROW[dir]);
  if (stepValue(from, dir)) return;

  const a = from.getBoundingClientRect();
  const ax = a.left + a.width / 2;
  const ay = a.top + a.height / 2;
  let best: HTMLElement | null = null;
  let bestScore = Infinity;
  for (const el of focusables(root)) {
    if (el === from) continue;
    const b = el.getBoundingClientRect();
    const bx = b.left + b.width / 2;
    const by = b.top + b.height / 2;
    // In that direction at all: past the middle of where focus is now.
    const ahead = dir === "down" ? b.top >= ay : dir === "up" ? b.bottom <= ay : dir === "right" ? b.left >= ax : b.right <= ax;
    if (!ahead) continue;
    const gap =
      dir === "down" ? b.top - a.bottom : dir === "up" ? a.top - b.bottom : dir === "right" ? b.left - a.right : a.left - b.right;
    const side =
      dir === "down" || dir === "up" ? Math.max(0, b.left - a.right, a.left - b.right) : Math.max(0, b.top - a.bottom, a.top - b.bottom);
    const drift = dir === "down" || dir === "up" ? Math.abs(bx - ax) : Math.abs(by - ay);
    const score = Math.max(0, gap) + side * 2 + drift * 0.05;
    if (score < bestScore) {
      bestScore = score;
      best = el;
    }
  }
  if (best) focus(best);
}

function choose() {
  const el = current();
  if (!el || !el.matches(FOCUSABLE)) return start(scope());
  const role = el.getAttribute("role");
  const typing =
    el instanceof HTMLTextAreaElement ||
    (el instanceof HTMLInputElement && !["checkbox", "radio", "button", "submit", "reset", "range", "color", "file"].includes(el.type));
  if (role === "combobox" || role === "listbox") return void send(el, "Enter");
  if (typing) {
    if (el instanceof HTMLInputElement && el.form) return el.form.requestSubmit();
    return void send(el, "Enter");
  }
  el.click();
}

function back() {
  const el = current() ?? document.body;
  if (send(el, "Escape").defaultPrevented) return;
  // A <dialog> closes on the browser's own Escape, which a made-up key press doesn't start.
  const dialogs = document.querySelectorAll<HTMLDialogElement>("dialog[open]");
  const top = dialogs[dialogs.length - 1];
  if (!top) return;
  const cancel = new Event("cancel", { cancelable: true });
  top.dispatchEvent(cancel);
  if (!cancel.defaultPrevented) top.close();
}

/** LB: the sidebar's current page. RB: the page itself. Not while a dialog is open. */
function region(which: "sidebar" | "page") {
  if (scope() !== document.body) return;
  if (which === "page") return start(document.body);
  const bar = document.querySelector<HTMLElement>('[data-testid="sidebar"]');
  if (!bar) return;
  const here = bar.querySelector<HTMLElement>('[aria-current="page"]');
  const first = here && visible(here) ? here : focusables(bar)[0];
  if (first) focus(first);
}

function scrollBy(dx: number, dy: number) {
  let el: HTMLElement | null = current() ?? document.querySelector("main");
  while (el && el !== document.body) {
    const style = getComputedStyle(el);
    const canY = dy !== 0 && /(auto|scroll)/.test(style.overflowY) && el.scrollHeight > el.clientHeight;
    const canX = dx !== 0 && /(auto|scroll)/.test(style.overflowX) && el.scrollWidth > el.clientWidth;
    if (canY || canX) break;
    el = el.parentElement;
  }
  (el && el !== document.body ? el : document.scrollingElement)?.scrollBy({ left: dx, top: dy });
}

const cleanName = (id: string) => id.replace(/\s*\(.*\)\s*$/, "").trim() || "Controller";

/* Starts listening for controllers; the returned function stops. */
export function startGamepad({ onSearch }: { onSearch: () => void }) {
  if (typeof navigator.getGamepads !== "function") return () => {};
  const held = new Map<string, { since: number; last: number }>();
  let raf = 0;
  let lastFrame = 0;

  const fresh = (id: string, down: boolean, now: number, repeat: boolean) => {
    const was = held.get(id);
    if (!down) {
      held.delete(id);
      return false;
    }
    if (!was) {
      held.set(id, { since: now, last: now });
      return true;
    }
    if (repeat && now - was.since >= REPEAT_DELAY && now - was.last >= REPEAT_EVERY) {
      was.last = now;
      return true;
    }
    return false;
  };

  const markPad = () => document.documentElement.classList.add("is-gamepad");

  const frame = (now: number) => {
    raf = 0;
    const pad = [...navigator.getGamepads()].find((one) => one?.connected);
    if (!pad) {
      held.clear();
      return;
    }
    const dt = lastFrame ? Math.min(now - lastFrame, 50) : 16;
    lastFrame = now;
    if (displayState().controller && document.hasFocus()) {
      const on = (i: number) => Boolean(pad.buttons[i]?.pressed);
      const [lx = 0, ly = 0, rx = 0, ry = 0] = pad.axes;
      const dirs: [Dir, boolean][] = [
        ["up", on(12) || ly < -STICK],
        ["down", on(13) || ly > STICK],
        ["left", on(14) || lx < -STICK],
        ["right", on(15) || lx > STICK],
      ];
      for (const [dir, down] of dirs) {
        if (fresh(dir, down, now, true)) {
          markPad();
          move(dir);
        }
      }
      const press: [number, () => void][] = [
        [0, choose],
        [1, back],
        [4, () => region("sidebar")],
        [5, () => region("page")],
        [8, () => void toggleFullScreen()],
        [9, onSearch],
      ];
      for (const [button, run] of press) {
        if (fresh(`b${button}`, on(button), now, false)) {
          markPad();
          run();
        }
      }
      const sx = Math.abs(rx) > SCROLL_DEAD ? rx : 0;
      const sy = Math.abs(ry) > SCROLL_DEAD ? ry : 0;
      if (sx || sy) scrollBy(sx * dt * 1.4, sy * dt * 1.4);
    } else {
      held.clear();
    }
    raf = requestAnimationFrame(frame);
  };
  const run = () => {
    if (!raf) {
      lastFrame = 0;
      raf = requestAnimationFrame(frame);
    }
  };

  const onConnect = (event: GamepadEvent) => {
    const name = cleanName(event.gamepad.id);
    setPadName(name);
    run();
    if (displayState().controller) {
      toast({ title: `${name} connected`, body: "D-pad to move, A to choose, B to go back, Menu to search, View for full screen." });
    }
  };
  const onDisconnect = () => {
    const left = [...navigator.getGamepads()].find((one) => one?.connected);
    setPadName(left ? cleanName(left.id) : null);
  };
  // The mouse or a real key press hands the focus ring back to the page's own style.
  const offPad = (event: Event) => {
    if (!event.isTrusted) return;
    // Chromium sends a still mouse a move when the page scrolls under it: that isn't the mouse.
    if (event instanceof MouseEvent && event.type === "mousemove" && !event.movementX && !event.movementY) return;
    document.documentElement.classList.remove("is-gamepad");
  };

  window.addEventListener("gamepadconnected", onConnect);
  window.addEventListener("gamepaddisconnected", onDisconnect);
  window.addEventListener("pointerdown", offPad, true);
  window.addEventListener("mousemove", offPad, true);
  window.addEventListener("keydown", offPad, true);
  const already = [...navigator.getGamepads()].find((one) => one?.connected);
  if (already) {
    setPadName(cleanName(already.id));
    run();
  }
  return () => {
    if (raf) cancelAnimationFrame(raf);
    raf = 0;
    window.removeEventListener("gamepadconnected", onConnect);
    window.removeEventListener("gamepaddisconnected", onDisconnect);
    window.removeEventListener("pointerdown", offPad, true);
    window.removeEventListener("mousemove", offPad, true);
    window.removeEventListener("keydown", offPad, true);
  };
}
