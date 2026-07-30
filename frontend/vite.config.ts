import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { fileURLToPath, URL } from 'node:url'

const src = fileURLToPath(new URL('./src', import.meta.url))

// The bridge alias is the seam described in PLAN.md §1: set VITE_BRIDGE=mock to
// run the whole UI in a plain browser (tests, Playwright) with no Go process.
//
// Vitest always gets the mock. Running the suite against the Wails bindings
// fails deep inside generated code with an unhelpful error, so the test runner
// is never allowed to reach them by accident.
const underTest = process.env.VITEST !== undefined
const bridgeImpl = underTest || process.env.VITE_BRIDGE === 'mock' ? 'mock' : 'wails'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@': src,
      '@bridge': `${src}/services/bridge/impl/${bridgeImpl}`,
    },
  },
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    coverage: {
      provider: 'v8',
      include: ['src/services/**', 'src/stores/**', 'src/hooks/**', 'src/utils/**'],
    },
  },
})
