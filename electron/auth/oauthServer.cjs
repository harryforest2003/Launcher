const http = require("http");

/*
 * Waits for Microsoft to send the browser back with a sign-in code. Only this
 * computer can reach it, and it gives up after a while so that closing the browser
 * tab doesn't leave a sign-in waiting forever.
 */

const WAIT_MS = 5 * 60 * 1000;

let cancelWaiting = null;

function page(message) {
    return `<!doctype html><meta charset="utf-8"><title>Unity Launcher</title>
<body style="font-family:sans-serif;background:#0d0d0d;color:#fff;padding:40px">
<h2 style="color:#c084fc">Unity Launcher</h2><p>${message}</p></body>`;
}

function waitForCode(port, expectedState) {
    // Trying again replaces any sign-in still waiting from a closed browser tab.
    cancelWaiting?.();

    return new Promise((resolve, reject) => {
        let finished = false;

        const finish = (settle, value) => {
            if (finished) return;
            finished = true;

            clearTimeout(timer);
            cancelWaiting = null;
            server.close();
            settle(value);
        };

        const server = http.createServer((req, res) => {
            const url = new URL(req.url, `http://127.0.0.1:${port}`);

            res.setHeader("Content-Type", "text/html; charset=utf-8");

            // A browser reusing this connection on a retry would reach this old server
            // instead of the new one, and that sign-in would never finish.
            res.setHeader("Connection", "close");

            if (url.pathname !== "/callback") {
                res.statusCode = 404;
                res.end();
                return;
            }

            if (url.searchParams.get("state") !== expectedState) {
                res.end(page("This sign-in link is out of date. Go back to the launcher and try again."));
                finish(reject, new Error("That sign-in link was out of date. Please try again."));
                return;
            }

            if (url.searchParams.get("error")) {
                res.end(page("Sign-in was cancelled. You can close this tab."));
                finish(reject, new Error("Sign-in was cancelled."));
                return;
            }

            res.end(page("Signed in. You can close this tab and go back to the launcher."));
            finish(resolve, url.searchParams.get("code"));
        });

        const timer = setTimeout(
            () => finish(reject, new Error("Sign-in timed out. Please try again.")),
            WAIT_MS
        );

        cancelWaiting = () => finish(reject, new Error("Sign-in was restarted."));

        server.on("error", (err) => {
            finish(
                reject,
                err.code === "EADDRINUSE"
                    ? new Error(`Port ${port} is in use, so sign-in can't finish. Close whatever is using it and try again.`)
                    : err
            );
        });

        server.listen(port, "127.0.0.1");
    });
}

module.exports = {
    waitForCode,
};
