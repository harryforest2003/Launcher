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

export default defineConfig(({ mode }) => {
  // CurseForge needs a key, and the browser must never see one. So when a key is
  // set, in the environment or in .env.local (which git ignores), this dev server
  // adds it to requests itself. Without one, the preview just shows Modrinth.
  const curseForgeKey =
    process.env.CURSEFORGE_API_KEY ?? loadEnv(mode, process.cwd(), 'CURSEFORGE_').CURSEFORGE_API_KEY

  return {
    plugins: [react(), injectMockBridge()],
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
