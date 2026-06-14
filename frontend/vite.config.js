import { rmSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

const __dirname = dirname(fileURLToPath(import.meta.url))

function cleanDuplicateBoundaryCopies() {
  const duplicateFiles = [
    'Wards_1..geojson',
    'Wards_1..qmd',
    'constituency_1..geojson',
    'constituency_1..qmd',
    'counties_1..geojson',
    'counties_1..qmd',
  ]

  return {
    name: 'aeis-clean-duplicate-boundary-copies',
    closeBundle() {
      for (const file of duplicateFiles) {
        rmSync(resolve(__dirname, 'dist', 'data', file), { force: true })
      }
    },
  }
}

export default defineConfig({
  plugins: [react(), cleanDuplicateBoundaryCopies()],
  server: {
    host: "0.0.0.0",
    port: 5173,
    allowedHosts: true,
    proxy: {
      "/api": {
        target: "http://127.0.0.1:5000",
        changeOrigin: true
      }
    }
  }
})
