import { defineConfig } from 'vitest/config'

// 覆盖率门禁 2026-09-12（CI 审查 C5）由固定阈值（原 50/45/50/50）改为
// scripts/coverage-ratchet.cjs 基线棘轮（backend/coverage-baseline.json，容差 0.5pt）——
// 真库门控套件激活后测试集随环境增减，固定阈值易假红；棘轮只拦相对基线的实质回退。
// json-summary reporter 供棘轮脚本读取 total.*.pct。
export default defineConfig({
  test: {
    include: ['test/**/*.e2e-spec.ts', 'test/**/*.spec.ts'],
    // 多套真库 e2e（auth/plans/favorites/flood/route…）共享同一个 v3_dev：文件级并行
    // 会产生跨套件的库状态竞态（run#177：auth.e2e 的用户清理落在 plans.e2e 执行期间
    // → 认证守卫查库无此人 → 对方 9 用例全 401）。测试文件必须串行执行。
    fileParallelism: false,
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
      reporter: ['text-summary', 'json-summary'],
      // 失败也出报告：棘轮/排障需要失败轮的覆盖率数据（前端同名配置同口径）
      reportOnFailure: true,
    },
  },
})
