import { defineConfig } from 'vitest/config'
import vue from '@vitejs/plugin-vue'
import { fileURLToPath, URL } from 'node:url'

export default defineConfig({
  plugins: [vue()],
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./test/setup.ts'],
    // 进程挂起根因：forks 池下 mount 组件的测试（UnifiedMap 等）测试完成后
    // worker 残留 open handle 不退出 → 套件"跑不完"（测试本身全绿）。
    // 方案：全局用 threads 池（实测正常退出）；OLRenderer 两个测试文件因
    // ol/source/GeoTIFF 依赖 web-worker 在 threads 嵌套 worker 崩溃，已在
    // 测试文件内 vi.mock('ol/source/GeoTIFF') 绕过（见两个 OLRenderer 测试）。
    // 注意：此改动与 setup.ts 曾被执行 git checkout 覆盖（2026-08-07），
    // 若再出现"测试挂起/16 unhandled rejection"先检查本文件是否被还原。
    pool: 'threads',
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
