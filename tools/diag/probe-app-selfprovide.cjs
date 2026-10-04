/* probe-app-selfprovide.cjs — 只读：App.vue「自 provide 不可自注入」两条消费链的运行时判据。
 *
 * 根因（2026-10-04 实测）：Vue 的 provide 只对后代生效，`App.vue` 给自己 provide 的键
 * 自己 inject 不到 ⇒ 修复前：
 *   ① useLayerIRLayer() 退化为 no-op 桩（任务结果 chip 显示已上图、BLM 里没有图层），
 *      控制台报 Vue "injection Symbol(businessLayerManager) not found" + 一条 warn；
 *   ② useMapControls() 拿到 null ⇒ zoomToRegion 空转：Profile(z9) 手动缩到 z6 后 push('/')，
 *      视图停在 z6 而不复位到 REGION（z9）。
 * 修复=两处改显式传参（App.vue → unifiedMapRef / businessLayerManager）。
 *
 * 判据（任一不满足 ⇒ exit 1）：
 *   A. push('/') 后 OL 视图 zoom == VIEW_LEVELS.REGION.zoom（从源码配置读，不手抄）；
 *   B. 全程 console 里不得出现 /businessLayerManager/i 告警；pageerror 0。
 * 环境性错误（后端 DB 未起 ⇒ /auth/me 401、/route/pois 500；天地图 key 配额 ⇒ 429；
 * 地形幽灵声明 ⇒ .terrain 404）不判红，只打印计数——与 lod-ladder 同一口径。
 * 前置：前端 dev server 在 :5174（vite）。用法：node tools/diag/probe-app-selfprovide.cjs [url]
 */
'use strict'
const fs = require('fs')
const path = require('path')
const { execSync } = require('child_process')
const GROOT = execSync('npm root -g').toString().trim()
const { chromium } = require(path.join(GROOT, 'playwright-core'))

const ROOT = path.resolve(__dirname, '..', '..')
const URL_ = process.argv[2] || 'http://127.0.0.1:5174/profile'

/** REGION.zoom 从配置源码读（不手抄）：`zoom: 9,` 紧随 REGION 块 */
const cfg = fs.readFileSync(path.join(ROOT, 'frontend/src/core/config/map.ts'), 'utf8')
const m = /REGION:\s*\{[\s\S]*?zoom:\s*([\d.]+)/.exec(cfg)
if (!m) {
  console.error('PROBE-FAIL: 未从 map.ts 的 VIEW_LEVELS.REGION 读到 zoom')
  process.exit(1)
}
const EXPECT_ZOOM = Number(m[1])

;(async () => {
  const browser = await chromium.launch({
    channel: 'msedge',
    headless: true,
    args: ['--ignore-certificate-errors', '--enable-unsafe-swiftshader'],
  })
  const page = await (
    await browser.newContext({ viewport: { width: 1280, height: 860 } })
  ).newPage()
  const consoleMsgs = []
  const pageErrors = []
  page.on('console', (msg) => {
    if (msg.type() === 'error' || msg.type() === 'warning')
      consoleMsgs.push(msg.text().slice(0, 200))
  })
  page.on('pageerror', (e) => pageErrors.push(String((e && e.message) || e).slice(0, 200)))
  await page.goto(URL_, { waitUntil: 'domcontentloaded', timeout: 60000 })
  await page.waitForTimeout(6000)

  const readZoom = () =>
    page.evaluate(() => {
      const st = document
        .querySelector('#app')
        .__vue_app__.config.globalProperties.$pinia._s.get('map')
      const r = st && st.currentRenderer
      const map = r && (r.map || r._map || r.olMap)
      return map && map.getView ? map.getView().getZoom() : null
    })

  const initial = await readZoom()
  await page.evaluate(() => {
    const st = document
      .querySelector('#app')
      .__vue_app__.config.globalProperties.$pinia._s.get('map')
    const r = st.currentRenderer
    const map = r.map || r._map || r.olMap
    map.getView().setZoom(6) // z6 是 OL minZoom；关键是与 REGION 不同
    map.renderSync?.()
  })
  await page.waitForTimeout(500)
  const moved = await readZoom()
  await page.evaluate(() =>
    document.querySelector('#app').__vue_app__.config.globalProperties.$router.push('/')
  )
  await page.waitForTimeout(4000)
  const after = await readZoom()

  const blmWarns = consoleMsgs.filter((t) => /businessLayerManager/i.test(t))
  console.log(`zoom: 初始=${initial} → 手动置 6 → push('/') 后=${after}（期望=${EXPECT_ZOOM}）`)
  console.log(
    `BLM 注入告警=${blmWarns.length} ｜ error/warning=${consoleMsgs.length} ｜ pageerror=${pageErrors.length}`
  )
  let bad = false
  if (after !== EXPECT_ZOOM) {
    console.error(`红：Home 复位后 zoom=${after} ≠ REGION.zoom=${EXPECT_ZOOM}（zoomToRegion 空转）`)
    bad = true
  }
  if (moved === EXPECT_ZOOM) {
    console.error('红：手动置 6 未生效（前置状态没造出来，本次读数无效）')
    bad = true
  }
  if (blmWarns.length > 0) {
    console.error('红：仍有 BLM 注入告警 —— ' + blmWarns.join(' ｜ '))
    bad = true
  }
  if (pageErrors.length > 0) {
    console.error('红：存在未捕获异常 —— ' + pageErrors.slice(0, 3).join(' ｜ '))
    bad = true
  }
  await browser.close()
  if (bad) process.exit(1)
  console.log('EXIT=0')
})().catch((e) => {
  console.error('PROBE-FAIL', e && e.message)
  process.exit(1)
})
