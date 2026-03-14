import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  base: '/app/', // <-- ADDED: ensures assets are served from /app
  plugins: [react()],
  server: {
    proxy: {
      '/api': 'http://localhost:10000',
      '/chat': 'http://localhost:10000',
      '/generate': 'http://localhost:10000',
      '/upload': 'http://localhost:10000',
      '/task': 'http://localhost:10000',
    }
  }
})
