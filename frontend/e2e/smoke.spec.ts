/**
 * 关键路径冒烟（z019，A-7）：启动 → 选址适宜性 → 预测 → 3D 图层。
 * 只断言「页面壳挂载 + 地图就绪 + 无错误态」——数据面由单测/契约检查承担；
 * 后端 API 一律 404 兜底（无库无后端也能在 CI 跑），验证的是前端自身的启动与降级路径。
 */
import { expect, type Page, test } from '@playwright/test'

async function stubBackend404(page: Page): Promise<void> {
  await page.route('**/*', (route) => {
    const { pathname } = new URL(route.request().url())
    if (!pathname.startsWith('/nest-api/') && !pathname.startsWith('/api/')) {
      return route.fallback()
    }
    return route.fulfill({
      status: 404,
      contentType: 'application/json',
      body: JSON.stringify({ code: 404001, error: 'E2E 冒烟：后端未接', data: null }),
    })
  })
}

async function expectBoot(page: Page, path: string, shell: string): Promise<void> {
  await stubBackend404(page)
  await page.goto(path)
  await expect(page.locator(shell)).toBeVisible({ timeout: 30_000 })
  await expect(page.locator('.unified-map-wrapper')).toBeVisible({ timeout: 30_000 })
  await expect(page.locator('.map-loading')).toHaveCount(0, { timeout: 45_000 })
  // `:visible` 必需：两个引擎容器常驻（v-show），`.first()` 会选中隐藏的那个
  await expect(page.locator('.map-container canvas:visible').first()).toBeVisible({
    timeout: 15_000,
  })
  await expect(page.locator('.map-error')).toHaveCount(0)
}

test.describe('关键路径冒烟（z019）', () => {
  test('① 启动：首页壳 + 地图 + 底部导航', async ({ page }) => {
    await expectBoot(page, '/', '.home-page')
    await expect(page.getByRole('button', { name: '选址分析' })).toBeVisible()
    await expect(page.getByRole('button', { name: '预测分析' })).toBeVisible()
  })

  test('② 选址适宜性：页面壳 + 地图就绪（后端 404 走降级）', async ({ page }) => {
    await expectBoot(page, '/site-suitability', '.ss-page')
  })

  test('③ 预测：页面壳 + 地图就绪（后端 404 走降级）', async ({ page }) => {
    await expectBoot(page, '/forecast', '.forecast-page')
  })

  test('④ 3D 图层：页面壳 + 地图就绪（后端 404 走降级）', async ({ page }) => {
    await expectBoot(page, '/flood-analysis', '.flood-analysis-page')
  })
})
