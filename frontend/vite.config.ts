import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  envDir: '..',
  plugins: [react()],
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes('node_modules')) {
            return
          }

          if (id.includes('@twa-dev/sdk')) {
            return 'telegram'
          }

          if (id.includes('axios')) {
            return 'network'
          }

          if (id.includes('zustand')) {
            return 'state'
          }

          if (id.includes('lucide-react')) {
            return 'icons'
          }

          if (id.includes('react')) {
            return 'react-vendor'
          }
        },
      },
    },
  },
  server: {
    host: '0.0.0.0',
    allowedHosts: true,
    proxy: {
      '/api': {
        target: 'http://localhost:8787',
        changeOrigin: true,
      },
    },
  },
})
