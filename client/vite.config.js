import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      // Backend not built yet — proxy is ready for when /api goes live.
      '/api': 'http://localhost:4000',
    },
  },
})
