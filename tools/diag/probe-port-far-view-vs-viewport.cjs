/* probe-port-far-view-vs-viewport.cjs — 只读：港区图层"远景壳"在不同视口宽度下是否都在场。
 *
 * 背景：§8.15 的结论「586 km 默认视角有壳（t0_0_0.glb，42547 tri）」是在 1280×860 画布上测得；
 * 2026-10-04 复测发现**该结论随视口宽度翻转**：1280 宽有壳、1024 宽（rootSSE 12.95）整层空白，
 * 而运行时把 maximumScreenSpaceError（配置值 32）改成 16 即出现壳、改成 8 出全细节
 * （7 块 / 458283 tri）、改回 32/64 又空白 ⇒ 远景观感是"参数敏感 + 视口敏感"的。
 *
 * 判据：同一机位（作业区锚点、586 km、pitch −90）下，**每个视口宽度都必须有内容**
 * （selected>0 且 tri>0），否则 exit 1。任何一格 tri=0 都是用户可见的"主体没有"。
 *
 * 用法：node tools/diag/probe-port-far-view-vs-viewport.cjs [url] [widths]
 *   默认 widths = 1440,1280,1180,1100,1024,900
 * 前置：前端 dev server 在跑；交付包在盘（缺包 ⇒ 图层不注册，按红记并给出原因）。
 */
'use strict'
const path = require('path')
const GROOT = require('child_process').execSync('npm root -g').toString().trim()
const { chromium } = require(path.join(GROOT, 'playwright-core'))

const URL_ = process.argv[2] || 'http://127.0.0.1:5174/route-analysis'
const WIDTHS = (process.argv[3] || '1440,1280,1180,1100,1024,900').split(',').map(Number)
const LAYER = 'beibu-qinzhou-port'
const ANCHOR = [108.6473, 21.6745] // 与 lod-ladder 同源（beibu3dTiles 的飞到作业区落点）
const HEIGHT = 586000

const read = () => {
  const R = document
    .querySelector('#app')
    .__vue_app__.config.globalProperties.$pinia._s.get('map').currentRenderer
  const rec = R._layers.get('beibu-qinzhou-port')
  const i = rec && rec.instance
  if (!i) return { missing: true }
  return {
    maxSSE: i.maximumScreenSpaceError,
    rootSSE:
      i.root && i.root._screenSpaceError != null ? +i.root._screenSpaceError.toFixed(2) : null,
    sel: (i._selectedTiles || []).length,
    tri: i.statistics ? i.statistics.numberOfTrianglesSelected : null,
    show: !!i.show,
  }
}

;(async () => {
  const rows = []
  let red = 0
  for (const w of WIDTHS) {
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
    const page = await browser.newPage({ viewport: { width: w, height: Math.round(w * 0.672) } })
    await page.goto(URL_, { waitUntil: 'domcontentloaded', timeout: 60000 })
    await page.waitForTimeout(12000)
    await page.evaluate(
      (v) => {
        const C = window.Cesium
        const viewer = document
          .querySelector('#app')
          .__vue_app__.config.globalProperties.$pinia._s.get('map').currentRenderer.viewer
        viewer.camera.cancelFlight()
        viewer.camera.setView({
          destination: C.Cartesian3.fromDegrees(v[0], v[1], v[2]),
          orientation: { heading: 0, pitch: -Math.PI / 2, roll: 0 },
        })
      },
      [ANCHOR[0], ANCHOR[1], HEIGHT]
    )
    await page.waitForTimeout(15000)
    const r = await page.evaluate(read)
    const ok = !r.missing && r.sel > 0 && r.tri > 0
    if (!ok) red++
    rows.push({ width: w, ok, ...r })
    console.log(
      `${String(w).padStart(5)} px  在场=${ok ? '是' : '否'}  sel=${r.sel ?? '-'}  tri=${r.tri ?? '-'}  ` +
        `rootSSE=${r.rootSSE ?? '-'}  maxSSE=${r.maxSSE ?? '-'}` +
        (r.missing ? '  （图层未注册：交付包缺件？）' : '')
    )
    await browser.close()
  }
  const out = path.join(
    path.resolve(__dirname, '..', '..'),
    '.local',
    '3d-review',
    'port-far-view-vs-viewport.json'
  )
  require('fs').mkdirSync(path.dirname(out), { recursive: true })
  require('fs').writeFileSync(out, JSON.stringify({ url: URL_, height: HEIGHT, rows }, null, 1))
  console.log(
    red === 0
      ? `⇒ ${rows.length}/${rows.length} 个宽度远景都有内容（EXIT=0）`
      : `❌ ${red}/${rows.length} 个宽度远景整层空白 ⇒ 用户在小窗口下看不到港区主体（EXIT=1）`
  )
  console.log('WROTE ' + out)
  process.exit(red === 0 ? 0 : 1)
})().catch((e) => {
  console.error('FAILED', e && e.message)
  process.exit(1)
})
