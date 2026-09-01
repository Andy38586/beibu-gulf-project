import { defineConfig } from 'vitest/config'

// 覆盖率阈值对齐 backend/vitest.config.js 的门禁口径（lines 50 / functions 45 / branches 50 / statements 50）
export default defineConfig({
  test: {
    include: ['test/**/*.e2e-spec.ts', 'test/**/*.spec.ts'],
    // @nestjs/throttler 是 CJS 包，vite ESM interop 会丢 named export（SkipThrottle），
    // inline 强制走 Node 解析
    server: {
      deps: {
        inline: ['@nestjs/throttler'],
      },
    },
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      // main.ts 为进程启动引导（测试链路不经过，e2e 经 TestingModule 直建 app），
      // 与 backend 侧豁免 index.js 同口径
      exclude: ['src/main.ts'],
      thresholds: { lines: 50, functions: 45, branches: 50, statements: 50 },
    },
  },
})
