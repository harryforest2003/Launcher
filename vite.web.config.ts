import fs from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'
import { defineConfig, loadEnv, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'

// `npm run web`: the launcher UI on localhost, without Electron. It uses its own
// port and cache so it can run beside `npm run electron:dev` (port 5174).
function injectMockBridge(): Plugin {
  return {
    name: 'unity-web-preview-bridge',
    transformIndexHtml() {
      return [
        {
          tag: 'script',
          attrs: { type: 'module', src: '/src/webPreview/mockBridge.ts' },
          injectTo: 'head-prepend',
        },
      ]
    },
  }
}

// More Games in the preview asks the same Steam, Nexus Mods and CurseForge search as the
// app (electron/games/custom.cjs), run by this dev server, so it pages through real games.
// Its caches go in node_modules/.cache, away from the app's own.
function gamesSearch(): Plugin {
  return {
    name: 'unity-web-preview-games',
    configureServer(server) {
      const root = process.cwd()
      const data = path.join(root, 'node_modules', '.cache', 'unity-web-games')
      fs.mkdirSync(data, { recursive: true })
      process.env.UNITY_GAMES_DATA = data
      const load = createRequire(path.join(root, 'package.json'))
      // Node keeps required files across preview restarts; drop the app's own so edits show.
      const backend = path.join(root, 'electron') + path.sep
      const forget = () => {
        for (const key of Object.keys(load.cache)) if (key.startsWith(backend)) delete load.cache[key]
      }
      forget()
      server.watcher.on('change', (file) => {
        if (file.startsWith(backend)) forget()
      })
      server.middlewares.use('/__games/find', (req, res) => {
        const url = new URL(req.url ?? '', 'http://localhost')
        const custom = load('./electron/games/custom.cjs')
        const { GAMES } = load('./electron/games/registry.cjs')
        custom
          .search(url.searchParams.get('q') ?? '', {
            page: Number(url.searchParams.get('page')) || 0,
            source: url.searchParams.get('source') ?? 'all',
            price: url.searchParams.get('price') ?? undefined,
            sort: url.searchParams.get('sort') ?? undefined,
            mac: url.searchParams.get('mac') === '1',
            mods: url.searchParams.get('mods') ?? undefined,
            own: GAMES,
          })
          .then((result: unknown) => {
            res.setHeader('Content-Type', 'application/json')
            res.end(JSON.stringify(result))
          })
          .catch((err: unknown) => {
            res.statusCode = 502
            res.end(JSON.stringify({ error: String(err) }))
          })
      })
      // A game page's Steam news and DLC offers, from the same code as the app.
      server.middlewares.use('/__games/store', (req, res) => {
        const params = new URL(req.url ?? '', 'http://localhost').searchParams
        const appId = params.get('appid') ?? ''
        const name = (params.get('name') ?? '').slice(0, 200)
        if (appId ? !/^\d{1,10}$/.test(appId) : !name) {
          res.statusCode = 400
          res.end('{}')
          return
        }
        load('./electron/games/custom.cjs')
          .storeInfo({ name, steamAppIds: appId ? [appId] : [] })
          .then((result: unknown) => {
            res.setHeader('Content-Type', 'application/json')
            res.end(JSON.stringify(result))
          })
          .catch((err: unknown) => {
            res.statusCode = 502
            res.end(JSON.stringify({ error: String(err) }))
          })
      })
      // CurseForge's worlds, for an instance's Worlds tab, from the same code as the app.
      server.middlewares.use('/__worlds/search', (req, res) => {
        const params = new URL(req.url ?? '', 'http://localhost').searchParams
        load('./electron/minecraft/worlds.cjs')
          .search({
            query: (params.get('q') ?? '').slice(0, 200),
            mcVersion: params.get('version') || null,
            category: params.get('category') || null,
            sort: params.get('sort') ?? undefined,
            page: Number(params.get('page')) || 0,
          })
          .then((result: unknown) => {
            res.setHeader('Content-Type', 'application/json')
            res.end(JSON.stringify(result))
          })
          .catch((err: unknown) => {
            res.statusCode = 502
            res.end(JSON.stringify({ error: String(err) }))
          })
      })
      // Where a page of games can be bought or downloaded (Wikidata and GOG), from the same code as the app.
      server.middlewares.use('/__games/where', (req, res) => {
        const names = new URL(req.url ?? '', 'http://localhost').searchParams.getAll('name').map((n) => n.slice(0, 200)).slice(0, 40)
        load('./electron/games/custom.cjs')
          .whereToGet(names)
          .then((result: unknown) => {
            res.setHeader('Content-Type', 'application/json')
            res.end(JSON.stringify(result))
          })
          .catch((err: unknown) => {
            res.statusCode = 502
            res.end(JSON.stringify({ error: String(err) }))
          })
      })
    },
  }
}

export default defineConfig(({ mode }) => {
  // CurseForge needs a key, and the browser must never see one. So when a key is
  // set, in the environment or in .env.local (which git ignores), this dev server
  // adds it to requests itself. Without one, the preview just shows Modrinth.
  const curseForgeKey =
    process.env.CURSEFORGE_API_KEY ?? loadEnv(mode, process.cwd(), 'CURSEFORGE_').CURSEFORGE_API_KEY

  return {
    plugins: [react(), injectMockBridge(), gamesSearch()],
    cacheDir: 'node_modules/.vite-web',
    // blockbench/ is the model editor's own page, built on its own.
    optimizeDeps: { entries: ['index.html'] },
    define: {
      __WEB_PREVIEW_HAS_CURSEFORGE__: JSON.stringify(Boolean(curseForgeKey)),
    },
    server: {
      port: 5175,
      strictPort: true,
      watch: { ignored: ['**/blockbench/**', '**/vendor/**'] },
      proxy: curseForgeKey
        ? {
            '/curseforge-api': {
              target: 'https://api.curseforge.com',
              changeOrigin: true,
              rewrite: (path) => path.replace(/^\/curseforge-api/, ''),
              headers: { 'x-api-key': curseForgeKey },
            },
          }
        : undefined,
    },
  }
})
