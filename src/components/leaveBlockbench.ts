/*
 * Leaving Blockbench, from its Done button or from anything that leaves the page (the
 * sidebar): with unsaved changes, the launcher asks whether to save them, leave without
 * them, or stay, in its own style (LeaveBlockbenchPrompt), and then does that. Resolves
 * false if Blockbench stays open. With nothing open, it's true at once.
 */

export type LeaveChoice = "save" | "discard" | "cancel";

// Set by LeaveBlockbenchPrompt while it's mounted.
let ask: (() => Promise<LeaveChoice>) | null = null;

export function setLeaveAsker(asker: () => Promise<LeaveChoice>) {
  ask = asker;
  return () => {
    if (ask === asker) ask = null;
  };
}

// One question at a time: pressing Done, or another button, while it's asking waits for the same answer.
let pending: Promise<boolean> | null = null;

export function leaveBlockbench(): Promise<boolean> {
  pending ??= leave().finally(() => {
    pending = null;
  });
  return pending;
}

async function leave(): Promise<boolean> {
  const api = window.blockbenchAPI;
  if (typeof api?.close !== "function") return true;
  try {
    // Without the launcher's own question (or an older bridge), Blockbench asks itself.
    if (!ask || typeof api.unsaved !== "function") return (await api.close()) !== false;
    if (!(await api.unsaved())) return (await api.close("discard")) !== false;

    // Blockbench is drawn over the page, so it steps aside while the page asks.
    await api.hide(true);
    const choice = await ask();
    if (choice === "cancel") {
      await api.hide(false);
      return false;
    }
    const closed = await api.close(choice);
    // A save that failed leaves Blockbench open, saying why.
    if (closed === false) await api.hide(false);
    return closed !== false;
  } catch {
    return true;
  }
}
