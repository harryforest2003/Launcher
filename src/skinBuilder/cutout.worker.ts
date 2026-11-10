import { cutOut } from "./grabcut";

/** Runs the cut-out away from the UI thread. See cutoutClient.ts for the caller. */
self.onmessage = (event: MessageEvent) => {
  const { requestId, rgba, width, height, hints } = event.data;

  try {
    const mask = cutOut({ rgba, width, height, hints });
    self.postMessage({ requestId, mask }, { transfer: [mask.buffer] });
  } catch (err) {
    self.postMessage({
      requestId,
      error: err instanceof Error ? err.message : String(err),
    });
  }
};
