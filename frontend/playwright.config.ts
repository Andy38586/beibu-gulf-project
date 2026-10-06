import { defineConfig } from '@playwright/test'

/**
 * E2E 配置（z019）：
 * - 只依赖前端 dev server（webServer 自起，5199 端口防与人工 dev 撞车）；
 * - 后端 API 一律由用例内 `page.route` 拦截（无库/无后端也能跑，CI 稳定）；
 * - 产物（trace/截图）落 `.local/tmp-w3/playwright-results`——仓库根不落文件（AGENTS §5.5）。
 */
export default defineConfig({
  testDir: './e2e',
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  reporter: [['list']],
  outputDir: '../.local/tmp-w3/playwright-results',
  use: {
    baseURL: 'http://127.0.0.1:5199',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  webServer: {
    command: 'npm run dev:e2e',
    url: 'http://127.0.0.1:5199',
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    cwd: '..',
  },
})
