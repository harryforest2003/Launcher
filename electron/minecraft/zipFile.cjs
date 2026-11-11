const fsp = require("fs/promises");
const { Readable } = require("stream");
const unzipper = require("unzipper");

/*
 * Reads a zip (a mod jar, a resource pack) through one open file handle, kept until fn
 * finishes. unzipper's own Open.file reopens the file by name for every entry it reads,
 * so a file updated or deleted meanwhile (by Undo, say) failed outside any catch and
 * stopped the launcher with an error box. A handle keeps reading the same file.
 *
 * The streams read by position and never close the handle themselves (unzipper stops
 * reading partway all the time, and a file stream would close it then).
 */
async function withZip(file, fn) {
    const handle = await fsp.open(file, "r");
    let closed = false;
    try {
        const { size } = await handle.stat();
        const directory = await unzipper.Open.custom({
            stream: (start, length) => {
                const end = length ? Math.min(start + length, size) : size;
                let position = start;
                return new Readable({
                    async read() {
                        const want = Math.min(64 * 1024, end - position);
                        if (closed || want <= 0) return this.push(null);
                        try {
                            const buffer = Buffer.alloc(want);
                            const { bytesRead } = await handle.read(buffer, 0, want, position);
                            if (!bytesRead) return this.push(null);
                            position += bytesRead;
                            this.push(bytesRead === want ? buffer : buffer.subarray(0, bytesRead));
                        } catch (err) {
                            // Left unread after the zip was finished with: nothing to report.
                            if (closed) this.push(null);
                            else this.destroy(err);
                        }
                    },
                });
            },
            size: async () => size,
        });
        return await fn(directory);
    } finally {
        closed = true;
        await handle.close().catch(() => {});
    }
}

module.exports = { withZip };
