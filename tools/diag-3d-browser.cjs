/* diag-3d.cjs — 接管系统 Edge 实测 3D 页：抓 console/失败请求/天地图与地形请求实况 */
const path = require('path')
const fs = require('fs')
const GROOT = require('child_process').execSync('npm root -g').toString().trim()
const { chromium } = require(path.join(GROOT, 'playwright-core'))

;(async () => {
  const browser = await chromium.launch({
    channel: 'msedge',
    headless: true,
    args: ['--use-angle=default', '--enable-webgl', '--ignore-certificate-errors'],
  })
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 } })
  const page = await ctx.newPage()

  const consoleLines = []
  const failedReq = []
  const tiandituReq = []
  const terrainReq = []

  page.on('console', (m) => {
    const t = m.text()
    if (/真地形|底图|Cesium|地形|跳过|失败|error|warn/i.test(t)) consoleLines.push(t.slice(0, 300))
  })
  page.on('requestfailed', (r) => {
    failedReq.push(`${r.method()} ${r.url().slice(0, 140)} :: ${r.failure()?.errorText}`)
  })
  page.on('response', (r) => {
    const u = r.url()
    if (/tianditu/i.test(u))
      tiandituReq.push(`${r.status()} ${u.slice(0, 160)} ${r.headers()['content-type'] || ''}`)
    if (/terrain/i.test(u)) terrainReq.push(`${r.status()} ${u.slice(0, 140)}`)
  })

  await page.goto('http://localhost:5173/flood-analysis', {
    waitUntil: 'domcontentloaded',
    timeout: 30000,
  })
  await page.waitForTimeout(18000) // 等 Cesium 动态加载 + 地形/影像请求

  const shot = 'C:/workspace/beibu-gulf-project/.tmp-3d-diag.png'
  await page.screenshot({ path: shot })

  const summary = {
    tiandituTotal: tiandituReq.length,
    tiandituSample: tiandituReq.slice(0, 6),
    tiandituNon200: tiandituReq.filter((l) => !l.startsWith('200')).length,
    terrainReq: terrainReq.slice(0, 8),
    terrainNon200: terrainReq.filter((l) => !l.startsWith('200')).length,
    failedReq: failedReq.slice(0, 10),
    consoleKey: consoleLines.slice(0, 25),
  }
  fs.writeFileSync(
    'C:/workspace/beibu-gulf-project/.tmp-3d-diag.json',
    JSON.stringify(summary, null, 2)
  )
  console.log(JSON.stringify(summary, null, 2))
  await browser.close()
})().catch((e) => {
  console.error('DIAG-FAIL', e.message)
  process.exit(1)
})
