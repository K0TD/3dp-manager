import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    port: 8080,
    proxy: {
      '/api': {
        target: 'http://localhost:3100',
        changeOrigin: true
      },
      '/bus': {
        target: 'http://localhost:3100',
        changeOrigin: true
      }
    }
  },
})
