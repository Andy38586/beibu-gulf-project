/* probe-terrain-runtime.cjs — 真地形运行时冒烟（只读，不改仓库/资产）。
 *
 * 用途：terrain 树（backend/static/terrain，gitignored 运行时资产）被 08/07b/07c 等
 * 重切/回填之后，证明"服务出来的瓦片真的能被真 Cesium 拉起来"——只做结构审计
 * （09-audit-terrain.py）不足以覆盖运行时。
 *
 * 做法：真 Edge + 真 Cesium 打开 route-analysis → 直接调渲染器 setTerrainEnabled(true)
 * → 统计 /static/terrain/* 的响应状态与去重 URL → 截图。
 *
 * 判据：terrain 200 > 0 且 错误(非 200) = 0 ⇒ TERRAIN-RUNTIME-OK (exit 0)。
 * 前置：① 前端 dev server 起着（默认 http://127.0.0.1:5174）且 /static 代理可达；
 *       ② 交付包/地形资产在盘（缺件时请求会 404 ⇒ 本探针如实判红，不静默跳过）。
 * 用法：node tools/diag/probe-terrain-runtime.cjs [baseUrl]
 * 产物：截图 .local/terrain-runtime/terrain-on.png（gitignored）。
 */
'use strict'
const fs = require('fs')
const path = require('path')
const GROOT = require('child_process').execSync('npm root -g').toString().trim()
const { chromium } = require(path.join(GROOT, 'playwright-core'))

const ROOT = path.resolve(__dirname, '..', '..')
const BASE = process.argv[2] || 'http://127.0.0.1:5174'
const OUT = path.join(ROOT, '.local', 'terrain-runtime')

;(async () => {
  fs.mkdirSync(OUT, { recursive: true })
  const browser = await chromium.launch({
    channel: 'msedge',
    headless: true,
    args: [
      '--use-angle=default',
      '--enable-webgl',
      '--ignore-certificate-errors',
      '--enable-unsafe-swiftshader',
    ],
  })
  const page = await (
    await browser.newContext({ viewport: { width: 1280, height: 860 } })
  ).newPage()
  let ok = 0
  const errs = []
  const urls = new Set()
  page.on('response', (res) => {
    const u = res.url()
    if (!u.includes('/static/terrain/')) return
    urls.add(u.split('/static/terrain/')[1])
    if (res.status() === 200) ok += 1
    else errs.push(res.status() + ' ' + u)
  })
  await page.goto(BASE + '/route-analysis', { waitUntil: 'domcontentloaded', timeout: 60000 })
  const deadline = Date.now() + 90000
  let ready = false
  while (Date.now() < deadline) {
    await page.waitForTimeout(2000)
    ready = await page.evaluate(() => {
      const el = document.querySelector('#app')
      const pinia = el && el.__vue_app__ && el.__vue_app__.config.globalProperties.$pinia
      const r = pinia && pinia._s.get('map') && pinia._s.get('map').currentRenderer
      return !!(r && r.viewer && window.Cesium && r.setTerrainEnabled)
    })
    if (ready) break
  }
  console.log('cesium-ready:', ready)
  if (!ready) {
    await browser.close()
    process.exit(2)
  }
  await page.evaluate(() => {
    const r = document
      .querySelector('#app')
      .__vue_app__.config.globalProperties.$pinia._s.get('map').currentRenderer
    r.setTerrainEnabled(true)
    r.viewer.scene.requestRender()
  })
  await page.waitForTimeout(15000)
  console.log('terrain 200 =', ok, '| errors =', errs.length, errs.slice(0, 5))
  console.log('unique terrain URLs =', urls.size, [...urls].slice(0, 10))
  await page.screenshot({ path: path.join(OUT, 'terrain-on.png') })
  await browser.close()
  const pass = ok > 0 && errs.length === 0
  console.log(pass ? 'TERRAIN-RUNTIME-OK' : 'TERRAIN-RUNTIME-FAIL')
  process.exit(pass ? 0 : 1)
})().catch((e) => {
  console.error('PROBE-FAIL', e && e.message)
  process.exit(1)
})
