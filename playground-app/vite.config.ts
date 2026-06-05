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
  define: {
    global: 'globalThis',
    'process.env': {}
  },
  resolve: {
    alias: {
      buffer: 'buffer',
    },
    dedupe: [
      'react',
      'react-dom',
      '@emotion/react',
      '@emotion/styled',
      '@mui/material',
      '@mui/system',
      '@mui/styled-engine'
    ]
  },
  optimizeDeps: {
    include: [
      'react',
      'react-dom',
      'zustand',
      'mapbox-gl',
      '@mui/material',
      '@mui/icons-material',
      '@emotion/react',
      '@emotion/styled',
      '@mui/system',
      '@mui/styled-engine',
      'buffer'
    ]
  },
  css: {
    preprocessorOptions: {
      css: {
        charset: false
      }
    }
  },
  server: {
    port: 3001
  }
})
