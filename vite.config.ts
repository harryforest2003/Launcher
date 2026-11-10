import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  // The installed app loads from files, where paths starting with "/" lead nowhere.
  base: './',
  server: {
    port: 5174,
  },
})
