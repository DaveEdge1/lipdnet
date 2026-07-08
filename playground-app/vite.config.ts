import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Served by the Express app at /playground. The build output goes into
// website/public/playground-app so the existing static middleware serves the
// assets, while the /playground route (which records usage stats) serves index.html.
export default defineConfig({
  base: '/playground-app/',
  plugins: [react()],
  build: {
    outDir: '../website/public/playground-app',
    emptyOutDir: true
  },
  optimizeDeps: {
    include: ['plotly.js-dist-min']
  },
  server: {
    port: 3001
  }
})
