/* review.cjs — 运行时审查：真浏览器 + 真 Cesium + 真天地图底图（已入库；输出到 .local/3d-review/）。
 *
 * 上一窗口为什么漏了浮空物：.local/3d-diag/*.cjs 是**自己写的软件光栅器**，直接读 GLB
 * 画图，从没见过 Cesium 实际怎么摆这些瓦片。浮空/偏移只存在于运行时。
 *
 * 本脚本通过 Vue 应用句柄拿到真实 renderer：
 *   #app.__vue_app__.config.globalProperties.$pinia._s.get('map').currentRenderer
 * 于是能：逐个图层读世界包围球 → 经纬高；控制相机；按图层开关二分定位。
 * 全部只在本浏览器会话，不改仓库源码。
 *
 * 用法：
 *   node tools/diag/review.cjs --name base --wait 30000
 *   node tools/diag/review.cjs --name port --fly 108.6473,21.6745,1500,0,-45
 *   node tools/diag/review.cjs --name noroads --hide qz-roads
 *   node tools/diag/review.cjs --name roadsonly --only qz-roads
 */
'use strict'
const fs = require('fs')
const path = require('path')
const GROOT = require('child_process').execSync('npm root -g').toString().trim()
const { chromium } = require(path.join(GROOT, 'playwright-core'))

const ROOT = path.resolve(__dirname, '..', '..')
const arg = (n, d) => {
  const i = process.argv.indexOf('--' + n)
  return i > -1 ? process.argv[i + 1] : d
}
const OUTDIR = path.join(ROOT, '.local', '3d-review')
fs.mkdirSync(OUTDIR, { recursive: true })

const URL_ = arg('url', 'http://localhost:5174/route-analysis')
const NAME = arg('name', 'shot')
const WAIT = Number(arg('wait', 30000))
const FLY = arg('fly', null)
const HIDE = arg('hide', null)
const ONLY = arg('only', null)

const GET_LAYERS = () => {
  const el = document.querySelector('#app')
  const pinia = el && el.__vue_app__ && el.__vue_app__.config.globalProperties.$pinia
  const st = pinia && pinia._s && pinia._s.get('map')
  const r = st && st.currentRenderer
  if (!r || !r.viewer) return { err: 'renderer/viewer 不可达' }
  window.__rvRenderer = r
  const C = window.Cesium
  const carto = (c) => {
    const cc = C.Ellipsoid.WGS84.cartesianToCartographic(c)
    return [(cc.longitude * 180) / Math.PI, (cc.latitude * 180) / Math.PI, cc.height]
  }
  const layers = []
  for (const [id, rec] of r._layers) {
    const inst = rec && rec.instance
    const item = {
      id,
      visible: rec.visible,
      show: inst && inst.show,
      kind: inst && inst.constructor && inst.constructor.name,
    }
    if (inst && inst.root && inst.boundingSphere) {
      item.center = carto(inst.boundingSphere.center).map((x) => Math.round(x * 1e6) / 1e6)
      item.radius = Math.round(inst.boundingSphere.radius * 10) / 10
      item.rootGE = inst.root.geometricError
      item.sse = inst.maximumScreenSpaceError
      item.sel = (inst._selectedTiles || []).length
      item.loaded = !!inst.tilesLoaded
      item.tilesTotal = inst.statistics ? inst.statistics.numberOfTilesTotal : null
      item.attempted = inst.statistics ? inst.statistics.numberOfAttemptedRequests : null
      const u = String(inst._url || '')
      item.urlHead = u.slice(0, 50)
      if (u.startsWith('data:')) {
        try {
          const b64 = u.slice(u.indexOf('base64,') + 7)
          const j = JSON.parse(atob(b64))
          const uris = []
          ;(function w(n) {
            if (n.content && n.content.uri) uris.push(n.content.uri)
            ;(n.children || []).forEach(w)
          })(j.root)
          item.uris = uris.slice(0, 4)
          item.uriCount = uris.length
          item.hasTransform = Array.isArray(j.root.transform)
        } catch (e) {
          item.decodeErr = String(e).slice(0, 60)
        }
      }
    }
    layers.push(item)
  }
  const c = r.viewer.camera.positionCartographic
  return {
    layers,
    camera: {
      lng: (c.longitude * 180) / Math.PI,
      lat: (c.latitude * 180) / Math.PI,
      height: c.height,
      heading: (r.viewer.camera.heading * 180) / Math.PI,
      pitch: (r.viewer.camera.pitch * 180) / Math.PI,
    },
    scene: {
      prims: r.viewer.scene.primitives.length,
      imagery: r.viewer.scene.imageryLayers.length,
      globeShow: r.viewer.scene.globe.show,
      terrain: r.viewer.scene.terrainProvider && r.viewer.scene.terrainProvider.constructor.name,
      canvas: [r.viewer.canvas.width, r.viewer.canvas.height],
    },
  }
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
  const consoleMsgs = [],
    failedReq = [],
    badResp = []
  page.on('console', (m) => {
    const t = m.text()
    if (/error|warn|失败|跳过|3D Tiles|tiles|裁剪/i.test(t))
      consoleMsgs.push(m.type() + ': ' + t.slice(0, 240))
  })
  page.on('requestfailed', (r) =>
    failedReq.push(
      r.method() + ' ' + r.url().slice(0, 110) + ' :: ' + (r.failure() || {}).errorText
    )
  )
  page.on('response', (r) => {
    if (r.status() >= 400) badResp.push(r.status() + ' ' + r.url().slice(0, 110))
  })

  await page.goto(URL_, { waitUntil: 'domcontentloaded', timeout: 60000 })
  await page.waitForTimeout(WAIT)

  if (ONLY || HIDE) {
    const res = await page.evaluate(
      ({ only, hide }) => {
        const el = document.querySelector('#app')
        const r = el.__vue_app__.config.globalProperties.$pinia._s.get('map').currentRenderer
        const changed = []
        for (const [id, rec] of r._layers) {
          const inst = rec && rec.instance
          if (!inst || !inst.root) continue
          const want = only ? id.includes(only) : !id.includes(hide)
          if (inst.show !== want) {
            inst.show = want
            changed.push(id + '=' + want)
          }
        }
        r.viewer.scene.requestRender()
        return changed
      },
      { only: ONLY, hide: HIDE }
    )
    console.log('图层开关: ' + JSON.stringify(res))
    await page.waitForTimeout(10000)
  }

  if (FLY) {
    const p = FLY.split(',').map(Number)
    await page.evaluate((a) => {
      const C = window.Cesium
      const el = document.querySelector('#app')
      const v = el.__vue_app__.config.globalProperties.$pinia._s.get('map').currentRenderer.viewer
      const opt = { destination: C.Cartesian3.fromDegrees(a[0], a[1], a[2]), duration: 0 }
      if (a.length > 3)
        opt.orientation = {
          heading: ((a[3] || 0) * Math.PI) / 180,
          pitch: ((a[4] || -45) * Math.PI) / 180,
          roll: ((a[5] || 0) * Math.PI) / 180,
        }
      v.camera.flyTo(opt)
    }, p)
    await page.waitForTimeout(14000)
  }

  const report = await page.evaluate(GET_LAYERS)
  const png = path.join(OUTDIR, NAME + '.png')
  await page.screenshot({ path: png })
  fs.writeFileSync(
    path.join(OUTDIR, NAME + '.json'),
    JSON.stringify(
      {
        url: URL_,
        waitMs: WAIT,
        fly: FLY,
        hide: HIDE,
        only: ONLY,
        report,
        consoleMsgs: consoleMsgs.slice(0, 60),
        failedReq: failedReq.slice(0, 30),
        badResp: badResp.slice(0, 30),
        shot: png,
      },
      null,
      2
    )
  )
  console.log(
    JSON.stringify(
      {
        name: NAME,
        shot: png,
        layers: (report.layers || []).length,
        failed: failedReq.length,
        bad: badResp.length,
        reportErr: report.err || null,
      },
      null,
      2
    )
  )
  await browser.close()
})().catch((e) => {
  console.error('REVIEW-FAIL', e && e.message)
  process.exit(1)
})
