/* diag-stats.cjs — 只读：逐图层读 tileset.statistics（selected / visited / commands / 三角面）。
 * 按内容与相机列出"选了多少瓦片、多少三角面"，用于说明"加载了但看不见/看得见多少"。
 * 用法: node tools/diag/diag-stats.cjs [url]
 */
'use strict'
const path = require('path')
const GROOT = require('child_process').execSync('npm root -g').toString().trim()
const { chromium } = require(path.join(GROOT, 'playwright-core'))
;(async () => {
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
  const page = await (await browser.newContext({ viewport: { width: 900, height: 620 } })).newPage()
  const reqs = []
  page.on('response', (r) => {
    const u = r.url()
    if (/clean\/|cell_|roads\.glb|canal\.glb|bridges-city\/.*glb/.test(u))
      reqs.push(r.status() + ' ' + u.slice(-46))
  })
  await page.goto(process.argv[2] || 'http://localhost:5174/route-analysis', {
    waitUntil: 'domcontentloaded',
    timeout: 60000,
  })
  await page.waitForTimeout(24000)
  for (const cam of [
    [108.6473, 21.6745, 3000, -20],
    [108.6473, 21.6745, 600, -60],
  ]) {
    await page.evaluate((p) => {
      const C = window.Cesium
      const v = document
        .querySelector('#app')
        .__vue_app__.config.globalProperties.$pinia._s.get('map').currentRenderer.viewer
      v.camera.flyTo({
        destination: C.Cartesian3.fromDegrees(p[0], p[1], p[2]),
        orientation: { heading: 0, pitch: (p[3] * Math.PI) / 180, roll: 0 },
        duration: 0,
      })
    }, cam)
    await page.waitForTimeout(15000)
    const stats = await page.evaluate(() => {
      const r = document
        .querySelector('#app')
        .__vue_app__.config.globalProperties.$pinia._s.get('map').currentRenderer
      const o = []
      for (const [id, rec] of r._layers) {
        const t = rec && rec.instance
        if (!t || !t.root || !t.statistics) continue
        const s = t.statistics
        o.push(
          [
            id,
            s.selected,
            s.visited,
            s.numberOfCommands,
            s.numberOfTrianglesSelected,
            s.numberOfTilesWithContentReady,
            s.numberOfTilesTotal,
            s.numberOfTilesCulledWithChildrenUnion,
          ].join(' ')
        )
      }
      return o
    })
    console.log(
      '== cam h=' +
        cam[2] +
        ' (selected visited commands trisWithContentReady total culledWithChildrenUnion)'
    )
    for (const s of stats) console.log('   ' + s)
  }
  console.log('--- 内容请求(' + reqs.length + ') ---')
  for (const q of reqs.slice(0, 30)) console.log(q)
  await browser.close()
})().catch((e) => {
  console.error('FAIL', e && e.message)
  process.exit(1)
})
