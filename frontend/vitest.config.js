import { fileURLToPath, URL } from 'node:url'

import vue from '@vitejs/plugin-vue'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  plugins: [vue()],
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./test/setup.ts'],
    // 功能域清单固定为生产默认值（与 docker-compose.yml 的 VITE_USE_NEST_MODULES 同源）：
    // 此前测试路由解析依赖本机 .env.local（不入库）→ CI 干净树上清单为空，
    // route 域解析回退 /api 致 useRouteApi 前缀断言红（2026-09-12 两轮 CI 实锤）。
    // 测试环境必须与部署默认对齐，禁止依赖本机未入库 env。
    env: {
      VITE_USE_NEST_MODULES: 'auth,plans,favorites,forecast,flood,site-analysis,route',
      VITE_NEST_API_BASE: '/nest-api',
      VITE_API_BASE: '/api',
    },
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
      // 2026-08-11（审查副-35）：覆盖率作为回归基线而非上线门禁（阈值曾逐级上调又回调，
      // 45/35/28/45 超实测导致 CI 全红——见 git 历史 38/29/26/36 一带注释）。
      // 2026-09-12（CI 审查 C5）：固定百分比阈值整体退役，改 scripts/coverage-ratchet.cjs
      // 基线棘轮（frontend/coverage-baseline.json，容差 0.5pt）——根除"大版本分母暴涨
      // → 总体百分比必然下滑 → 第一次 CI 必红"的机制性追尾；增长由 ci:local 的
      // --update 写回基线（只升不降）。
      // thresholds: 已移除（历史口径 38/29/26/36）
    },
  },
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
})
