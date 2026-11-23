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
// On a Mac, a throwaway copy never touches the real app's Keychain entry (no Keychain prompt).
if (process.platform === "darwin") args.push("--use-mock-keychain");
// A throwaway copy never looks for updates of the launcher itself.
const app = spawn(program, args, { stdio: "ignore", env: { ...process.env, UNITY_NO_UPDATES: "1" } });

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
      // The launcher's page is served on its own scheme (electron/security.cjs), never file://.
      const page = targets.find((target) => target.type === "page" && target.url.startsWith("app://unity/"));
      if (page) return page;
    } catch {
      // Not listening yet.
    }
    await wait(500);
  }
  throw new Error("The app didn't open its window within a minute.");
}

/* Runs an expression in the window and resolves with its value, once the page can run one. */
async function evaluate(page, expression) {
  for (let tries = 0; ; tries++) {
    try {
      return await evaluateOnce(page, expression);
    } catch (err) {
      // Found before its page has started: asked again shortly.
      if (tries < 60 && /execution context/i.test(err.message)) {
        await wait(500);
        continue;
      }
      throw err;
    }
  }
}

function evaluateOnce(page, expression) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(page.webSocketDebuggerUrl);
    ws.onerror = () => reject(new Error("Couldn't connect to the app's window."));
    ws.onopen = () =>
      ws.send(JSON.stringify({ id: 1, method: "Runtime.evaluate", params: { expression, awaitPromise: true, returnByValue: true } }));
    ws.onmessage = (event) => {
      const message = JSON.parse(event.data);
      if (message.id !== 1) return;
      ws.close();
      if (message.error) {
        reject(new Error(`The app's window couldn't run the check (${message.error.message}).`));
      } else if (message.result?.exceptionDetails) {
        reject(new Error(message.result.exceptionDetails.exception?.description ?? "The check failed inside the app."));
      } else {
        resolve(message.result?.result?.value);
      }
    };
  });
}

const CHECKS = `(async () => {
  // The window can be found before its page has any content.
  const text = () => document.body?.innerText ?? "";
  for (let i = 0; i < 60 && !text().includes("Minecraft"); i++) {
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  // Its Content-Security-Policy allows no inline script, so this one mustn't run.
  const policyInForce = await new Promise((resolve) => {
    let refused = false;
    document.addEventListener("securitypolicyviolation", () => (refused = true), { once: true });
    window.__inlineScriptRan = false;
    const script = document.createElement("script");
    script.textContent = "window.__inlineScriptRan = true";
    document.head.appendChild(script);
    setTimeout(() => resolve(refused && !window.__inlineScriptRan), 300);
  });
  return {
    name: /Unity\\s+Launcher/.test(text()),
    homeScreen: text().includes("Minecraft"),
    appConnected: typeof window.instanceAPI === "object",
    // A message to the main process gets an answer (its sender is checked first).
    messagesAnswered: Array.isArray(await window.launcherAPI.getLoaders()),
    noNodeInPage: typeof window.require === "undefined" && typeof window.process === "undefined",
    policyInForce,
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
    if (!result || typeof result !== "object") failure = "The app started, but its window gave no answer to the checks.";
    else if (failed.length) failure = `The app started, but these checks failed: ${failed.join(", ")}.`;
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
