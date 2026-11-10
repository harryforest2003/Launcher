/*
 * Starts a built copy of the launcher with a throwaway profile and checks it reaches its
 * home screen, with its built-in Blockbench. The GitHub build runs it before publishing
 * anything. Run it yourself with the path to the app's program:
 *   node scripts/check-app-starts.cjs "release/win-unpacked/Unity Launcher.exe"
 */

const { spawn, spawnSync } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");

const PORT = 9339;
const program = process.argv[2];

if (!program || !fs.existsSync(program)) {
  console.error(`There's no app at ${program}.`);
  process.exit(1);
}

const profile = fs.mkdtempSync(path.join(os.tmpdir(), "unity-launcher-check-"));
const args = [`--user-data-dir=${profile}`, `--remote-debugging-port=${PORT}`];
// On Linux, Electron's sandbox needs setting up that an unpacked build doesn't have.
if (process.platform === "linux") args.push("--no-sandbox");
const app = spawn(program, args, { stdio: "ignore" });

let exited = null;
app.on("exit", (code) => (exited = code));
app.on("error", (err) => (exited = err.message));

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/* The launcher's window, once it's open. */
async function appWindow(deadline) {
  while (Date.now() < deadline) {
    if (exited !== null) throw new Error(`The app closed straight away (${exited}).`);
    try {
      const targets = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
      const page = targets.find((target) => target.type === "page" && target.url.startsWith("file:"));
      if (page) return page;
    } catch {
      // Not listening yet.
    }
    await wait(500);
  }
  throw new Error("The app didn't open its window within a minute.");
}

/* Runs an expression in the window and resolves with its value. */
function evaluate(page, expression) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(page.webSocketDebuggerUrl);
    ws.onerror = () => reject(new Error("Couldn't connect to the app's window."));
    ws.onopen = () =>
      ws.send(JSON.stringify({ id: 1, method: "Runtime.evaluate", params: { expression, awaitPromise: true, returnByValue: true } }));
    ws.onmessage = (event) => {
      const message = JSON.parse(event.data);
      if (message.id !== 1) return;
      ws.close();
      if (message.result?.exceptionDetails) {
        reject(new Error(message.result.exceptionDetails.exception?.description ?? "The check failed inside the app."));
      } else {
        resolve(message.result?.result?.value);
      }
    };
  });
}

const CHECKS = `(async () => {
  for (let i = 0; i < 60 && !document.body.innerText.includes("Minecraft"); i++) {
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  return {
    name: /Unity\\s+Launcher/.test(document.body.innerText),
    homeScreen: document.body.innerText.includes("Minecraft"),
    appConnected: typeof window.instanceAPI === "object",
    blockbench: await window.blockbenchAPI.available(),
  };
})()`;

function stop() {
  if (process.platform === "win32") spawnSync("taskkill", ["/pid", String(app.pid), "/T", "/F"]);
  else app.kill();
}

(async () => {
  let failure = null;

  try {
    const result = await evaluate(await appWindow(Date.now() + 60 * 1000), CHECKS);
    console.log(JSON.stringify(result));
    const failed = Object.keys(result ?? {}).filter((name) => !result[name]);
    if (failed.length) failure = `The app started, but these checks failed: ${failed.join(", ")}.`;
  } catch (err) {
    failure = err.message;
  }

  stop();
  await wait(1500);
  try {
    fs.rmSync(profile, { recursive: true, force: true });
  } catch {
    // Windows can hold files a moment after the app closes. It's a temporary folder.
  }

  if (failure) {
    console.error(failure);
    process.exit(1);
  }
  console.log("The app starts and shows its home screen.");
})();
