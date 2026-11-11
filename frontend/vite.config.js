import process from 'node:process'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig, loadEnv } from 'vite'

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  // VITE_API_URL (en .env) = origen del backend, sin /api/v1 (ej. http://localhost:8001).
  const env = loadEnv(mode, process.cwd(), '')

  return {
    plugins: [react(), tailwindcss()],
    // Mantener el mismo transform JSX automático de React en Vitest y en el build.
    esbuild: { jsx: 'automatic' },
    server: {
      // API y WebSocket usan el mismo origen del navegador; Vite reenvía ambos al backend.
      proxy: {
        '/api': env.VITE_API_URL || 'http://localhost:8001',
        '/ws': {
          target: env.VITE_API_URL || 'http://localhost:8001',
          ws: true,
        },
      },
    },
    test: {
      environment: 'jsdom',
      globals: true,
      setupFiles: './src/test/setup.js',
      include: ['src/**/*.{test,spec}.{js,jsx}'],
      clearMocks: true,
      restoreMocks: true,
      coverage: {
        provider: 'v8',
        reporter: ['text', 'html'],
        include: ['src/**/*.{js,jsx}'],
        exclude: ['src/**/*.test.{js,jsx}', 'src/**/test/**'],
      }
    }
  }
})
