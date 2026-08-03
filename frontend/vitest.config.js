import { defineConfig } from 'vitest/config'
import vue from '@vitejs/plugin-vue'
import { fileURLToPath, URL } from 'node:url'

export default defineConfig({
  plugins: [vue()],
  test: {
    environment: 'jsdom',
    globals: true,
    coverage: {
      provider: 'v8',
      include: ['src/**/*.{ts,vue}'],
      exclude: [
        'src/**/*.d.ts',
        'src/**/__tests__/**',
        'src/**/*.test.ts',
        'src/mock/**',
        'src/types/**',
        'src/env.d.ts',
        'src/auto-imports.d.ts',
        'src/components.d.ts',
      ],
      reporter: ['text-summary', 'html', 'lcov', 'json-summary'],
      reportOnFailure: true,
      thresholds: { lines: 25, functions: 20, branches: 15, statements: 25 },
    },
  },
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
})
