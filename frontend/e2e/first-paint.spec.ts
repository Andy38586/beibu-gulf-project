/**
 * 首屏就绪探针（z037，A-6 目标：业务路由直链可达 ≤5s 本机 dev；「加载中」态可打断）：
 * 直链进入业务路由，测量「地图壳挂载 → 遮罩消失 → canvas 可见且无错误态」的耗时；
 * 后端 API 全部拦截为 404（页面走各自错误兜底），探针只测**地图就绪时序**，不测数据面。
 */
import { expect, type Page, test } from '@playwright/test'

/** 拦截一切后端域请求：统一 404 业务码（页面按各自错误路径兜底，不阻塞地图初始化） */
async function stubBackend404(page: Page): Promise<void> {
  // 🔴 只按 pathname 前缀命中后端域：正则 /\/(nest-api|api)\// 会把前端自身模块
  // `/src/types/api/forecast.ts` 也拦成 404（实测：app 直接不挂载）。
  await page.route('**/*', (route) => {
    const { pathname } = new URL(route.request().url())
    if (!pathname.startsWith('/nest-api/') && !pathname.startsWith('/api/')) {
      return route.fallback()
    }
    return route.fulfill({
      status: 404,
      contentType: 'application/json',
      body: JSON.stringify({ code: 404001, error: 'E2E 探针：后端未接', data: null }),
    })
  })
}

async function timeToMapReady(page: Page, path: string): Promise<number> {
  await stubBackend404(page)
  const t0 = Date.now()
  await page.goto(path)
  // ① 应用壳先挂载（防"遮罩还没渲染就断言其不存在"的假绿）
  await expect(page.locator('.unified-map-wrapper')).toBeVisible({ timeout: 15_000 })
  // ② 遮罩（.map-loading）在 `loading || switching` 期间常驻；消失 = 初始化结束
  await expect(page.locator('.map-loading')).toHaveCount(0, { timeout: 45_000 })
  // ③ 渲染器真的画出来了（canvas 在容器内可见），且无错误态——否则"遮罩消失"可能是初始化失败
  // `:visible` 必需：两个引擎容器常驻（v-show），`.first()` 会选中隐藏的那个
  await expect(page.locator('.map-container canvas:visible').first()).toBeVisible({
    timeout: 15_000,
  })
  await expect(page.locator('.map-error')).toHaveCount(0)
  return Date.now() - t0
}

test.describe('首屏就绪探针（A-6：≤5s）', () => {
  test('2D 业务路由直链（/forecast）：加载中遮罩 ≤5s 消失', async ({ page }) => {
    const elapsed = await timeToMapReady(page, '/forecast')
    test.info().annotations.push({ type: '首屏耗时(ms)', description: String(elapsed) })
    console.log(`[first-paint] /forecast 就绪 ${elapsed}ms`)
    expect(elapsed, `直链 /forecast 首屏 ${elapsed}ms 超过 A-6 目标 5000ms`).toBeLessThanOrEqual(
      5000
    )
  })

  test('3D 业务路由直链（/flood-analysis）：加载中遮罩 ≤5s 消失', async ({ page }) => {
    const elapsed = await timeToMapReady(page, '/flood-analysis')
    test.info().annotations.push({ type: '首屏耗时(ms)', description: String(elapsed) })
    console.log(`[first-paint] /flood-analysis 就绪 ${elapsed}ms`)
    expect(
      elapsed,
      `直链 /flood-analysis 首屏 ${elapsed}ms 超过 A-6 目标 5000ms`
    ).toBeLessThanOrEqual(5000)
  })

  test('3D 准备期可打断：CPU 6× 降速下点导航「首页」仍能离页', async ({ page }) => {
    await stubBackend404(page)
    const cdp = await page.context().newCDPSession(page)
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: 6 })
    await page.goto('/flood-analysis')
    // 导航条挂载即代表交互可用（3D 准备态用进度环表达，pointer-events:none 不拦点击）
    await page.getByRole('button', { name: '首页' }).click({ timeout: 30_000 })
    await expect(page).toHaveURL(/\/$/)
    await expect(page.locator('.home-page')).toBeVisible({ timeout: 15_000 })
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 })
  })
})
