import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  // The installed app loads from files, where paths starting with "/" lead nowhere.
  base: './',
  // blockbench/ is the model editor's own page, built on its own (npm run blockbench:build),
  // so only the launcher's page is scanned and watched.
  optimizeDeps: { entries: ['index.html'] },
  server: {
    port: 5174,
    watch: { ignored: ['**/blockbench/**', '**/vendor/**'] },
  },
})
