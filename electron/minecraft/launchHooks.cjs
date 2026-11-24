const { spawn } = require("child_process");

/*
 * An instance's own launch commands, set by hand on its Settings tab and never from an
 * imported pack: one run before the game starts (the game waits for it, and doesn't
 * start if it fails), a wrapper that runs Java itself, one run after the game closes,
 * and extra environment variables.
 */

const MAX_COMMAND = 2000;
const MAX_VARIABLES = 50;
const ENV_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;
const BEFORE_LAUNCH_LIMIT = 5 * 60 * 1000;

const command = (value) => String(value ?? "").replace(/[\r\n]+/g, " ").trim().slice(0, MAX_COMMAND);

/* What Settings saves: commands as typed, and variables with usable names only. */
function cleanHooks(input) {
    if (!input || typeof input !== "object") return { preLaunch: "", wrapper: "", postExit: "", env: {} };
    const env = {};
    const entries = Object.entries(input.env && typeof input.env === "object" ? input.env : {});
    for (const [name, value] of entries.slice(0, MAX_VARIABLES)) {
        const key = String(name).trim();
        if (!ENV_NAME.test(key)) throw new Error(`"${key}" can't be an environment variable's name. Use letters, digits and _, not starting with a digit.`);
        env[key] = String(value ?? "").slice(0, MAX_COMMAND);
    }
    return { preLaunch: command(input.preLaunch), wrapper: command(input.wrapper), postExit: command(input.postExit), env };
}

/* A wrapper command split into words the way a shell would, quotes included. */
function splitWords(text) {
    const words = [];
    let word = "";
    let quote = null;
    let started = false;
    for (let i = 0; i < text.length; i += 1) {
        const char = text[i];
        if (quote) {
            if (char === quote) quote = null;
            else if (char === "\\" && quote === '"' && i + 1 < text.length) word += text[++i];
            else word += char;
        } else if (char === '"' || char === "'") {
            quote = char;
            started = true;
        } else if (/\s/.test(char)) {
            if (started || word) words.push(word);
            word = "";
            started = false;
        } else if (char === "\\" && i + 1 < text.length) {
            word += text[++i];
        } else {
            word += char;
        }
    }
    if (quote) throw new Error("The wrapper command has a quote that isn't closed.");
    if (started || word) words.push(word);
    return words;
}

/* The variables every command gets, naming the instance, as Prism and MultiMC give. */
function instanceVariables({ instance, folder, gameDirectory, javaPath }) {
    return {
        INST_NAME: instance.name,
        INST_ID: instance.name,
        INST_DIR: folder,
        INST_MC_DIR: gameDirectory,
        INST_JAVA: javaPath,
        INST_MC_VERSION: instance.version ?? "",
    };
}

/* Runs a command in a shell, in the game folder, writing what it prints to the log. */
function runCommand(text, { cwd, env, onLog, timeout = 0 }) {
    return new Promise((resolve, reject) => {
        const child = spawn(text, { shell: true, cwd, env: { ...process.env, ...env }, windowsHide: true });
        const timer = timeout ? setTimeout(() => {
            child.kill();
            reject(new Error(`It was still running after ${Math.round(timeout / 60000)} minutes, so it was stopped.`));
        }, timeout) : null;
        child.stdout.on("data", (chunk) => onLog?.(chunk.toString()));
        child.stderr.on("data", (chunk) => onLog?.(chunk.toString()));
        child.on("error", (err) => {
            if (timer) clearTimeout(timer);
            reject(err);
        });
        child.on("close", (code) => {
            if (timer) clearTimeout(timer);
            resolve(code ?? 1);
        });
    });
}

async function runBeforeLaunch(text, options) {
    let code;
    try {
        code = await runCommand(text, { ...options, timeout: BEFORE_LAUNCH_LIMIT });
    } catch (err) {
        throw new Error(`The before-launch command couldn't run: ${err.message} The game wasn't started.`);
    }
    if (code !== 0) throw new Error(`The before-launch command failed (exit code ${code}), so the game wasn't started. Change it on the instance's Settings tab.`);
}

/* Runs after the game closes; nothing waits for it. */
function runAfterExit(text, options) {
    runCommand(text, options)
        .then((code) => options.onLog?.(`[Unity Launcher] The after-exit command finished (exit code ${code}).\n`))
        .catch((err) => options.onLog?.(`[Unity Launcher] The after-exit command couldn't run: ${err.message}\n`));
}

module.exports = { cleanHooks, splitWords, instanceVariables, runBeforeLaunch, runAfterExit };
