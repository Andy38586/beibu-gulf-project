/* lod-probe.cjs — 运行时 LOD 取证：同一机位逐高度记录各 3D Tiles 图层的选中瓦片与三角面数。
 *
 * 目的：用户报「lod 加载导致枢纽主体没有」。离线读 GLB 只能看到资产里有什么，
 * 看不到 Cesium 在某个相机高度实际选中了哪一级 LOD。本脚本走真实浏览器 + 真实 Cesium，
 * 在既定机位（默认马道枢纽正上方）逐高度 setView，记录：
 *   - 每个图层的 _selectedTiles → content url 尾名（哪一级 LOD 被选中）
 *   - statistics.numberOfTrianglesSelected（细/粗模的三角面数量级差）
 *   - 截图（目视对照）
 * 只读，不改仓库源码、不改 tileset。
 *
 * 用法：
 *   node tools/diag/lod-probe.cjs [url] [lng] [lat] [heightsComma]
 *   node tools/diag/lod-probe.cjs http://localhost:5174/route-analysis 108.93922 22.44632 20000,8000,4000,2000,1000,500,250
 */
'use strict'
const fs = require('fs')
const path = require('path')
const GROOT = require('child_process').execSync('npm root -g').toString().trim()
const { chromium } = require(path.join(GROOT, 'playwright-core'))

const ROOT = path.resolve(__dirname, '..', '..')
const OUT = path.join(ROOT, '.local', '3d-review', 'lod-probe')
fs.mkdirSync(OUT, { recursive: true })

const URL_ = process.argv[2] || 'http://localhost:5174/route-analysis'
const LNG = Number(process.argv[3] || 108.93922)
const LAT = Number(process.argv[4] || 22.44632)
const HEIGHTS = (process.argv[5] || '20000,8000,4000,2000,1000,500,250').split(',').map(Number)

const WATCH = [
  'pinglu-madao',
  'pinglu-qishi',
  'pinglu-qingnian',
  'beibu-pinglu-canal',
  'beibu-qinzhou-port',
  'beibu-qz-roads',
  'beibu-qz-ground',
]

function snapshot(watch) {
  const el = document.querySelector('#app')
  const pinia = el && el.__vue_app__ && el.__vue_app__.config.globalProperties.$pinia
  const st = pinia && pinia._s && pinia._s.get('map')
  const r = st && st.currentRenderer
  if (!r || !r.viewer) return { err: 'renderer/viewer 不可达' }
  const C = window.Cesium
  const c = r.viewer.camera.positionCartographic
  const out = {
    camera: {
      lng: (c.longitude * 180) / Math.PI,
      lat: (c.latitude * 180) / Math.PI,
      height: c.height,
      pitch: (r.viewer.camera.pitch * 180) / Math.PI,
    },
  }
  const layers = {}
  for (const id of watch) {
    const rec = r._layers.get(id)
    const inst = rec && rec.instance
    if (!inst) {
      layers[id] = null
      continue
    }
    const tiles = []
    for (const t of inst._selectedTiles || []) {
      let u = ''
      try {
        u =
          (t._contentResource && (t._contentResource.url || t._contentResource._url)) ||
          (t.content && (t.content.url || t.content._url)) ||
          (t._header && t._header.content && (t._header.content.uri || t._header.content.url)) ||
          ''
      } catch (e) {
        u = 'ERR:' + String(e).slice(0, 40)
      }
      const tail = String(u).split('/').pop().split('?')[0]
      tiles.push({ tail, ge: t.geometricError, refine: t.refine })
    }
    layers[id] = {
      show: inst.show,
      visible: !!rec.visible,
      rootGE: inst.root && inst.root.geometricError,
      maxSSE: inst.maximumScreenSpaceError,
      selected: tiles.length,
      tiles,
      tri: inst.statistics ? inst.statistics.numberOfTrianglesSelected : null,
      visited: inst.statistics ? inst.statistics.numberOfTilesVisited : null,
      attempts: inst.statistics ? inst.statistics.numberOfAttemptedRequests : null,
      loaded: !!inst.tilesLoaded,
    }
  }
  out.layers = layers
  // 诊断：pinglu-madao 的树内 SSE/距离/就绪状态（只读内部字段，用于解释为何停在某一级 LOD）
  try {
    const inst = r._layers.get('pinglu-madao') && r._layers.get('pinglu-madao').instance
    if (inst) {
      const walk = (t, d) => {
        const node = {
          ge: t.geometricError,
          sse: t._screenSpaceError,
          dist: t._distanceToCamera,
          hasContent: !!t._content,
          contentReady: t._content ? !!t._content.ready : null,
          selected: !!t._selected,
          refine: t.refine,
        }
        if (d > 0 && t.children && t.children.length)
          node.children = t.children.map((c) => walk(c, d - 1))
        return node
      }
      out.madaoTree = walk(inst.root, 2)
    }
  } catch (e) {
    out.madaoTreeErr = String(e).slice(0, 120)
  }
  return out
}

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
  const page = await (
    await browser.newContext({ viewport: { width: 1280, height: 860 }, deviceScaleFactor: 1 })
  ).newPage()
  const consoleMsgs = []
  const failedReq = []
  page.on('console', (m) => {
    const t = m.text()
    if (/error|warn|失败|跳过|3D Tiles|tiles|裁剪|lod/i.test(t))
      consoleMsgs.push(m.type() + ': ' + t.slice(0, 240))
  })
  page.on('requestfailed', (r) =>
    failedReq.push(
      r.method() + ' ' + r.url().slice(0, 130) + ' :: ' + (r.failure() || {}).errorText
    )
  )

  await page.goto(URL_, { waitUntil: 'domcontentloaded', timeout: 60000 })
  // 等图层注册（挂载是异步的：先取 tileset 模板再 register）
  const deadline = Date.now() + 60000
  let ready = false
  while (Date.now() < deadline) {
    await page.waitForTimeout(3000)
    ready = await page.evaluate(() => {
      const el = document.querySelector('#app')
      const pinia = el && el.__vue_app__ && el.__vue_app__.config.globalProperties.$pinia
      const st = pinia && pinia._s && pinia._s.get('map')
      const r = st && st.currentRenderer
      if (!r || !r._layers) return false
      return !!r._layers.get('pinglu-madao')
    })
    if (ready) break
  }
  console.log('layers ready:', ready)

  const runs = []
  for (const h of HEIGHTS) {
    // 页面可能有延迟到达的 homing/flyTo 动画会覆盖 setView ⇒ 每轮先 cancelFlight，
    // setView 后校验相机高度，漂了再设一次（最多 4 次）。
    for (let attempt = 0; attempt < 4; attempt++) {
      await page.evaluate(
        (a) => {
          const C = window.Cesium
          const el = document.querySelector('#app')
          const v =
            el.__vue_app__.config.globalProperties.$pinia._s.get('map').currentRenderer.viewer
          v.camera.cancelFlight()
          v.camera.setView({
            destination: C.Cartesian3.fromDegrees(a[0], a[1], a[2]),
            orientation: { heading: 0, pitch: -Math.PI / 2, roll: 0 },
          })
        },
        [LNG, LAT, h]
      )
      await page.waitForTimeout(2000)
      const got = await page.evaluate(() => {
        const el = document.querySelector('#app')
        const c =
          el.__vue_app__.config.globalProperties.$pinia._s.get('map').currentRenderer.viewer.camera
            .positionCartographic
        return c.height
      })
      if (Math.abs(got - h) < Math.max(50, h * 0.02)) break
      console.log(`  height drift: want=${h} got=${Math.round(got)} retry`)
    }
    // 等瓦片请求/替换完成：先等 12s，再轮询 tilesLoaded（最多再等 20s）
    await page.waitForTimeout(12000)
    const t0 = Date.now()
    while (Date.now() - t0 < 20000) {
      const loaded = await page.evaluate(() => {
        const el = document.querySelector('#app')
        const r = el.__vue_app__.config.globalProperties.$pinia._s.get('map').currentRenderer
        const inst = r._layers.get('pinglu-madao') && r._layers.get('pinglu-madao').instance
        return !!inst && !!inst.tilesLoaded
      })
      if (loaded) break
      await page.waitForTimeout(2000)
    }
    const snap = await page.evaluate(snapshot, WATCH)
    const shot = path.join(OUT, `h${h}.png`)
    await page.screenshot({ path: shot })
    runs.push({ height: h, shot, snap })
    const m = snap.layers && snap.layers['pinglu-madao']
    console.log(
      `h=${h} madao sel=${m ? m.selected : 'n/a'} tri=${m ? m.tri : 'n/a'} ` +
        `tiles=${m ? JSON.stringify((m.tiles || []).map((x) => x.tail)) : 'n/a'}`
    )
  }

  const report = {
    url: URL_,
    lng: LNG,
    lat: LAT,
    heights: HEIGHTS,
    runs,
    consoleMsgs: consoleMsgs.slice(0, 80),
    failedReq: failedReq.slice(0, 40),
  }
  fs.writeFileSync(path.join(OUT, 'lod-probe.json'), JSON.stringify(report, null, 2))
  console.log('written', path.join(OUT, 'lod-probe.json'))
  await browser.close()
})().catch((e) => {
  console.error('PROBE-FAIL', e && e.message)
  process.exit(1)
})
