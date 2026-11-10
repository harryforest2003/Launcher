const fs = require("fs");
const path = require("path");

const { downloadFile, fetchJson, pool } = require("./net.cjs");

/*
 * Asset downloading.
 *
 * The original pipeline ignored assetIndex entirely, so instances
 * launched with no sound, no music and missing UI text. Assets are
 * content-addressed: every object lives at
 * assets/objects/<first 2 chars of hash>/<hash>.
 */

const RESOURCES = "https://resources.download.minecraft.net";

function assetsDir(instanceFolder) {
    return path.join(instanceFolder, "assets");
}

async function downloadAssets(versionJson, instanceFolder, onProgress) {
    const assetIndex = versionJson.assetIndex;

    if (!assetIndex?.url) {
        // Very old versions have no asset index; nothing to do.
        return { downloaded: 0, total: 0, skipped: true };
    }

    const root = assetsDir(instanceFolder);

    const indexPath = path.join(root, "indexes", `${assetIndex.id}.json`);

    await downloadFile(assetIndex.url, indexPath, {
        sha1: assetIndex.sha1,
        size: assetIndex.size,
    });

    const index = JSON.parse(fs.readFileSync(indexPath, "utf8"));

    const objects = Object.entries(index.objects ?? {});

    if (objects.length === 0) {
        return { downloaded: 0, total: 0 };
    }

    const objectsDir = path.join(root, "objects");

    const { errors } = await pool(
        objects,
        async ([, meta]) => {
            const prefix = meta.hash.slice(0, 2);

            await downloadFile(
                `${RESOURCES}/${prefix}/${meta.hash}`,
                path.join(objectsDir, prefix, meta.hash),
                { sha1: meta.hash, size: meta.size }
            );
        },
        {
            concurrency: 24,
            onProgress: (done, total) => {
                if (onProgress) onProgress(done, total);
            },
        }
    );

    /*
     * Pre-1.7 versions read assets from a flat "virtual" tree instead of
     * the hashed store, so mirror them when the index says so.
     */
    if (index.virtual || index.map_to_resources) {
        const virtualDir = path.join(root, "virtual", "legacy");

        for (const [name, meta] of objects) {
            const source = path.join(
                objectsDir, meta.hash.slice(0, 2), meta.hash
            );
            const target = path.join(virtualDir, name);

            if (!fs.existsSync(source) || fs.existsSync(target)) continue;

            fs.mkdirSync(path.dirname(target), { recursive: true });
            fs.copyFileSync(source, target);
        }
    }

    if (errors.length) {
        console.warn(
            `${errors.length} asset object(s) failed:`,
            errors[0]?.message
        );
    }

    return {
        downloaded: objects.length - errors.length,
        total: objects.length,
        failed: errors.length,
    };
}

module.exports = {
    downloadAssets,
    assetsDir,
};
