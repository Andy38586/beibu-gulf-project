import { defineConfig } from 'vitest/config'

// 后端测试运行在 Node 环境（HTTP 路由 / 文件 IO mock），
// 与 frontend 的 jsdom 配置隔离，独立配置避免误解析 @ 别名。
export default defineConfig({
  test: {
    environment: 'node',
    globals: true,
    include: ['**/*.test.js'],
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
