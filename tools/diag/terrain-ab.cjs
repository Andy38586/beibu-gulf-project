/* terrain-ab.cjs — 「真地形 ON/OFF × 三枢纽 + 钦州港」同机位 A/B 取证。
 *
 * 背景（2026-10-04 运行时取证）：
 *   - BLM 有互斥组 [terrain, 3dtiles]：注册任一 3D Tiles 图层会把 real-terrain 关掉；
 *   - UnifiedMap 又把 real-terrain 注册为 visible:false ⇒ 3D Tiles 场景恒为椭球面。
 * 本脚本在真实 Cesium 里对每个机位分别 setTerrainEnabled(false/true)，记录
 * globe 高程、选中瓦片、世界包围球高度，并落截图供像素差计算。
 *
 * 用法：node tools/diag/terrain-ab.cjs [url]
 */
'use strict'
const fs = require('fs')
const path = require('path')
const GROOT = require('child_process').execSync('npm root -g').toString().trim()
const { chromium } = require(path.join(GROOT, 'playwright-core'))

const ROOT0 = path.resolve(__dirname, '..', '..')
const OUT = path.join(ROOT0, '.local', '3d-review', 'terrain-ab')
fs.mkdirSync(OUT, { recursive: true })

const SITES = [
  {
    id: 'madao',
    lng: 108.93922,
    lat: 22.44632,
    h: 1800,
    pitch: -45,
    layers: ['pinglu-madao', 'beibu-pinglu-canal'],
  },
  { id: 'qishi', lng: 108.94146, lat: 22.32265, h: 1800, pitch: -45, layers: ['pinglu-qishi'] },
  { id: 'qingnian', lng: 108.655, lat: 22.0102, h: 1800, pitch: -45, layers: ['pinglu-qingnian'] },
  {
    id: 'port',
    lng: 108.6473,
    lat: 21.6745,
    h: 2500,
    pitch: -45,
    layers: ['beibu-qinzhou-port', 'beibu-qz-roads'],
  },
]

const SNAP = (site) => {
  const C = window.Cesium
  const el = document.querySelector('#app')
  const r = el.__vue_app__.config.globalProperties.$pinia._s.get('map').currentRenderer
  const v = r.viewer
  const carto = (c) => {
    const cc = C.Ellipsoid.WGS84.cartesianToCartographic(c)
    return [(cc.longitude * 180) / Math.PI, (cc.latitude * 180) / Math.PI, cc.height]
  }
  const out = {
    terrain: {
      isCesiumTerrain: v.terrainProvider instanceof C.CesiumTerrainProvider,
      isEllipsoid: v.terrainProvider instanceof C.EllipsoidTerrainProvider,
    },
    heights: [
      [site.lng, site.lat],
      [site.lng + 0.01, site.lat],
      [site.lng - 0.01, site.lat],
      [site.lng, site.lat + 0.01],
      [site.lng, site.lat - 0.01],
    ].map((p) => {
      const h = v.scene.globe.getHeight(C.Cartographic.fromDegrees(p[0], p[1]))
      return { lng: p[0], lat: p[1], h: Number.isFinite(h) ? Math.round(h * 100) / 100 : h }
    }),
    layers: {},
  }
  for (const id of site.layers) {
    const rec = r._layers.get(id)
    const inst = rec && rec.instance
    if (!inst) {
      out.layers[id] = null
      continue
    }
    const tiles = (inst._selectedTiles || []).map((t) => {
      let tail = ''
      try {
        const u =
          (t._contentResource && (t._contentResource.url || t._contentResource._url)) ||
          (t.content && (t.content.url || t.content._url)) ||
          ''
        tail = String(u).split('/').pop().split('?')[0]
      } catch (e) {
        tail = 'ERR'
      }
      let bs = null
      try {
        const b = t.content && t.content.boundingSphere
        if (b && b.center) {
          const [lng, lat, h] = carto(b.center)
          bs = {
            lng: +lng.toFixed(6),
            lat: +lat.toFixed(6),
            h: Math.round(h * 10) / 10,
            r: Math.round(b.radius * 10) / 10,
          }
        }
      } catch (e) {
        bs = { err: String(e).slice(0, 40) }
      }
      return { tail, ge: t.geometricError, bs }
    })
    out.layers[id] = {
      show: inst.show,
      selected: tiles.length,
      tri: inst.statistics ? inst.statistics.numberOfTrianglesSelected : null,
      tiles,
    }
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
    await browser.newContext({ viewport: { width: 1280, height: 860 } })
  ).newPage()
  const badResp = []
  page.on('response', (r) => {
    if (r.status() >= 400 && r.url().includes('/static/'))
      badResp.push(r.status() + ' ' + r.url().replace(/^https?:\/\/[^/]+/, ''))
  })
  await page.goto(process.argv[2] || 'http://localhost:5174/route-analysis', {
    waitUntil: 'domcontentloaded',
    timeout: 60000,
  })
  await page.waitForTimeout(45000)

  const runs = []
  for (const site of SITES) {
    for (const mode of ['off', 'on']) {
      await page.evaluate(
        (a) => {
          const C = window.Cesium
          const el = document.querySelector('#app')
          const r = el.__vue_app__.config.globalProperties.$pinia._s.get('map').currentRenderer
          r.setTerrainEnabled(a.mode === 'on')
          r.viewer.camera.cancelFlight()
          r.viewer.camera.setView({
            destination: C.Cartesian3.fromDegrees(a.lng, a.lat, a.h),
            orientation: { heading: 0, pitch: (a.pitch * Math.PI) / 180, roll: 0 },
          })
        },
        { ...site, mode }
      )
      await page.waitForTimeout(mode === 'on' ? 18000 : 10000)
      const snap = await page.evaluate(SNAP, site)
      const shot = path.join(OUT, `${site.id}-${mode}.png`)
      await page.screenshot({ path: shot })
      runs.push({ site: site.id, mode, shot, snap })
      const l0 = snap.layers[site.layers[0]]
      console.log(
        `${site.id}/${mode}: terrain=${snap.terrain.isCesiumTerrain ? 'CTB' : 'ellipsoid'} h=${snap.heights[0].h} ` +
          `sel=${l0 ? l0.selected : 'n/a'} tri=${l0 ? l0.tri : 'n/a'} tiles=${l0 ? l0.tiles.map((x) => x.tail).join(',') : ''}`
      )
    }
  }
  fs.writeFileSync(
    path.join(OUT, 'terrain-ab.json'),
    JSON.stringify({ runs, badResp: badResp.slice(0, 40) }, null, 2)
  )
  console.log('written', path.join(OUT, 'terrain-ab.json'))
  await browser.close()
})().catch((e) => {
  console.error('AB-FAIL', e && e.message)
  process.exit(1)
})
