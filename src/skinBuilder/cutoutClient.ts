let worker: Worker | null = null;
let nextRequestId = 1;
let pending: { requestId: number; reject: (reason: Error) => void } | null = null;

function createWorker() {
  return new Worker(new URL("./cutout.worker.ts", import.meta.url), { type: "module" });
}

/** Thrown when a newer request replaced this one, so the caller can ignore it. */
export class CutoutCancelled extends Error {}

/**
 * Runs the cut-out on a worker. A new request stops the previous one by replacing
 * the worker, because a running min-cut cannot be interrupted from outside.
 */
export function runCutout(image: ImageData, hints: Uint8Array | null): Promise<Uint8Array> {
  if (pending && worker) {
    worker.terminate();
    worker = null;
    pending.reject(new CutoutCancelled("Replaced by a newer cut-out."));
    pending = null;
  }

  const active = (worker ??= createWorker());
  const requestId = nextRequestId;
  nextRequestId += 1;

  return new Promise((resolve, reject) => {
    pending = { requestId, reject };

    active.onmessage = (event: MessageEvent) => {
      if (event.data.requestId !== requestId) return;
      pending = null;
      if (event.data.error) reject(new Error(event.data.error));
      else resolve(event.data.mask);
    };

    active.onerror = (event) => {
      pending = null;
      worker = null;
      reject(new Error(event.message || "The cut-out worker stopped unexpectedly."));
    };

    active.postMessage({
      requestId,
      rgba: image.data,
      width: image.width,
      height: image.height,
      hints,
    });
  });
}
