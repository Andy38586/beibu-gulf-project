import { defineConfig } from 'vitest/config'

// 后端测试运行在 Node 环境（HTTP 路由 / 文件 IO mock），
// 与 frontend 的 jsdom 配置隔离，独立配置避免误解析 @ 别名。
export default defineConfig({
  test: {
    environment: 'node',
    globals: true,
    include: ['**/*.test.js'],
    // 默认 5s 对 app.test/health.test 的首次冷启动（读盘+HTTP 握手）偏紧，偶发 flake（副-15）
    testTimeout: 20000,
    hookTimeout: 20000,
    coverage: {
      provider: 'v8',
      include: ['**/*.js'],
      exclude: [
        'node_modules/**',
        '**/__tests__/**',
        '**/*.test.js',
        'vitest.config.js',
        'coverage/**',
      ],
      reporter: ['text-summary', 'html', 'lcov', 'json-summary'],
      reportOnFailure: true,
      thresholds: { lines: 50, functions: 45, branches: 50, statements: 50 },
    },
  },
})
