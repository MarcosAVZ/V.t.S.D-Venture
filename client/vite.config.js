import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/api': 'http://127.0.0.1:3000'
    }
  },
  test: {
    environment: 'jsdom',
    // so every commit of a split series keeps `npm test` green even if it has no client tests yet
    passWithNoTests: true,
    setupFiles: ['./src/test/setup.js'],
  }
})
