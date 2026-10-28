import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

const ROOT = __dirname
const SRC = path.join(ROOT, 'src')

export default defineConfig({
  root: SRC,
  plugins: [vue()],
  server: {
    port: 5209,
    strictPort: false,
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:5210',
        changeOrigin: true,
        ws: false
      }
    }
  },
  build: {
    outDir: path.join(SRC, 'dist'),
    emptyOutDir: true,
    chunkSizeWarningLimit: 1200
  }
})
