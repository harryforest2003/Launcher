# CurseForge proxy

CurseForge gives API keys to apps rather than to players, and anything shipped inside a
downloaded app can be read out of it. So Unity Launcher carries no CurseForge key.
Instead it asks this small Cloudflare Worker, which adds the key on Cloudflare's side.

- The key is kept only in the Worker's encrypted secret store, never in this repo or the app.
- Only the six requests the launcher makes are let through:
  - GET: search, a project, its files, its description.
  - POST: the two batch lookups used when installing a modpack.
  - Anything else gets a 404.
- Each address can make 120 requests a minute. Beyond that the answer is 429, which the
  launcher shows as "CurseForge is busy" and waits out.
- Searches and projects are cached on Cloudflare for 5–60 minutes, so popular ones don't
  each cost a request.

## Setting it up

You need a free Cloudflare account, and Node.js.

1. Get a CurseForge key at https://console.curseforge.com. Use a new one rather than an
   old key that has ever been in a file or a commit.
2. In this folder, sign in to Cloudflare and deploy:

   ```bash
   npx wrangler login
   npx wrangler deploy
   ```

   It prints the Worker's address, like `https://unity-launcher-curseforge.<you>.workers.dev`.
3. Give it the key. Wrangler asks for it, so it never appears in your shell history:

   ```bash
   npx wrangler secret put CURSEFORGE_API_KEY
   ```

4. Put the Worker's address in `PROXY_URL` in `electron/curseforge.cjs`, then rebuild the
   launcher (`npm run app:install`).

To check it's working, open the address with `/v1/mods/search?gameId=432&searchFilter=jei`
on the end. You should see search results, and no key anywhere in them.

## Changing the key later

Run `npx wrangler secret put CURSEFORGE_API_KEY` again. The launcher doesn't need rebuilding.

## Trying it locally

`npx wrangler dev` runs it at `http://localhost:8787`. It reads the key from a `.dev.vars`
file in this folder (`CURSEFORGE_API_KEY=...`), which git ignores. Run the launcher from
source with `CURSEFORGE_PROXY_URL=http://localhost:8787` to send it there, even on a
computer that has a key saved.

## What it can't stop

The Worker's address is public once the launcher ships, so anyone could call it. They
can only make the launcher's six requests, at the launcher's rate. That's the usual
trade-off for an app's key, and far better than a key inside the app. If it's ever
abused, set a new key with `wrangler secret put` and the old one stops working.
