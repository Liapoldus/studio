import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

const root = dirname(fileURLToPath(import.meta.url))

export default defineConfig({
  root,
  plugins: [react()],
  build: {
    outDir: resolve(root, '../internal/infrastructure/assets/web/dist'),
    emptyOutDir: true,
    rollupOptions: {
      input: resolve(root, 'index.web.html'),
    },
  },
})
