import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { nodePolyfills } from 'vite-plugin-node-polyfills'

export default defineConfig({
  plugins: [
    react(),
    nodePolyfills()
  ],
  server: {
    port: 5173,
    host: '127.0.0.1',
    strictPort: true
  }
})