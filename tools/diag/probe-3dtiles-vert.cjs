/* probe-3dtiles-vert.cjs — 运行时竖直位置对照：真 Edge + 真 Cesium，读**已加载**内容的
 * content.boundingSphere（世界坐标）→ 经纬高，与 tools/diag/probe-hub-heights.py 的
 * 逐顶点世界椭球高程比。目的：验证「tileset 变换链 + GLB Y-up→Z-up」这套静态读法
 * 与 Cesium 实际摆位一致（静态工具看不见运行时的摆法差异）。
 *
 * 用法：
 *   node tools/diag/probe-3dtiles-vert.cjs --url http://127.0.0.1:5174/route-analysis \
 *        --fly 108.6711,22.0320,2000,0,-60 --filter "corridor-0[789]|corridor-10" --wait 45000
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
const URL_ = arg('url', 'http://127.0.0.1:5174/route-analysis')
const FLY = arg('fly', null)
const FILTER = arg('filter', 'corridor|madao|qishi|qingnian')
const WAIT = Number(arg('wait', 45000))
const NAME = arg('name', 'vert')
const DUMP = Number(arg('dump', 0))
const MCHECK = arg('mcheck', null)
const SEL = arg('sel', 'pinglu-madao|madao-low.glb')
const CHAIN = arg('chain', null)

/* tile.transform 链 × Cesium.Axis.Y_UP_TO_Z_UP 作用到 glTF 空间点：与 Python 复合矩阵对账 */
const CHAINFN = ([src, pt]) => {
  const [layerRe, uriRe] = src.split('|')
  const lre = new RegExp(layerRe)
  const ure = new RegExp(uriRe)
  const el = document.querySelector('#app')
  const pinia = el && el.__vue_app__ && el.__vue_app__.config.globalProperties.$pinia
  const st = pinia && pinia._s && pinia._s.get('map')
  const r = st && st.currentRenderer
  const C = window.Cesium
  const out = []
  for (const [id, rec] of r._layers) {
    if (!lre.test(id)) continue
    const inst = rec && rec.instance
    if (!inst || !inst.root) continue
    const walk = (tile, parentM) => {
      const M = tile.transform
        ? C.Matrix4.multiply(parentM, tile.transform, new C.Matrix4())
        : C.Matrix4.clone(parentM)
      const c = tile.content
      if (c) {
        const u = String(c.url || (c._resource && c._resource.url) || '')
        const tail = u.split('/').pop().split('?')[0]
        if (ure.test(tail)) {
          const p = new C.Cartesian3(pt[0], pt[1], pt[2])
          const w = C.Matrix4.multiplyByPoint(
            C.Matrix4.multiply(M, C.Axis.Y_UP_TO_Z_UP, new C.Matrix4()),
            p,
            new C.Cartesian3()
          )
          const g = C.Ellipsoid.WGS84.cartesianToCartographic(w)
          out.push({
            layer: id,
            uri: tail,
            worldPtHeight: Math.round(g.height * 10) / 10,
            worldPtLng: Math.round(g.longitude * 1e5 * 180) / Math.PI / 1e5,
            worldPtLat: Math.round(g.latitude * 1e5 * 180) / Math.PI / 1e5,
            chain: C.Matrix4.toArray(M),
          })
        }
      }
      for (const kid of tile.children || []) walk(kid, M)
    }
    walk(inst.root, C.Matrix4.clone(C.Matrix4.IDENTITY))
  }
  return out
}

/* 用 Cesium 自己的 model.modelMatrix 变换一个 glTF 空间点（顶点约定的对照判据） */
const MCHECKFN = ([src, pt]) => {
  const [layerRe, uriRe] = src.split('|')
  const lre = new RegExp(layerRe)
  const ure = new RegExp(uriRe)
  const el = document.querySelector('#app')
  const pinia = el && el.__vue_app__ && el.__vue_app__.config.globalProperties.$pinia
  const st = pinia && pinia._s && pinia._s.get('map')
  const r = st && st.currentRenderer
  const C = window.Cesium
  const out = []
  for (const [id, rec] of r._layers) {
    if (!lre.test(id)) continue
    const inst = rec && rec.instance
    if (!inst || !inst.root) continue
    const walk = (tile) => {
      const c = tile.content
      if (c) {
        const u = String(c.url || (c._resource && c._resource.url) || '')
        const tail = u.split('/').pop().split('?')[0]
        if (ure.test(tail)) {
          const m = c._model
          if (m) {
            const Mm = m.modelMatrix || m._modelMatrix
            const p = new C.Cartesian3(pt[0], pt[1], pt[2])
            const w = new C.Cartesian3()
            C.Matrix4.multiplyByPoint(Mm, p, w)
            const g = C.Ellipsoid.WGS84.cartesianToCartographic(w)
            out.push({
              layer: id,
              uri: tail,
              worldPtHeight: Math.round(g.height * 10) / 10,
              worldPtLng: Math.round(g.longitude * 1e7) / 1e5,
              worldPtLat: Math.round(g.latitude * 1e7) / 1e5,
              mmLen: Mm && Mm.length,
              mmIsArray: Array.isArray(Mm),
            })
          }
        }
      }
      for (const kid of tile.children || []) walk(kid)
    }
    walk(inst.root)
  }
  return out
}

const DUMPFN = (n) => {
  const el = document.querySelector('#app')
  const pinia = el && el.__vue_app__ && el.__vue_app__.config.globalProperties.$pinia
  const st = pinia && pinia._s && pinia._s.get('map')
  const r = st && st.currentRenderer
  const out = []
  for (const [id, rec] of r._layers) {
    const inst = rec && rec.instance
    if (!inst || !inst.root) continue
    let cnt = 0
    const walk = (tile, depth) => {
      if (out.length >= n) return
      const c = tile.content
      if (c || depth <= 1) {
        const keys = c ? Object.keys(c).slice(0, 22) : []
        out.push({
          id,
          depth,
          ge: tile.geometricError,
          hasContent: !!c,
          ctor: c && c.constructor && c.constructor.name,
          contentKeys: keys,
          url:
            c && (c.url || c._url || (c._resource && c._resource.url))
              ? String(c.url || c._url || (c._resource && c._resource.url))
                  .split('/')
                  .pop()
              : null,
          bs: c && !!c.boundingSphere,
          tileKeys: Object.keys(tile)
            .filter((k) => /content|bound|state/i.test(k))
            .slice(0, 12),
          tileState: tile._contentState,
        })
      }
      for (const kid of tile.children || []) walk(kid, depth + 1)
    }
    walk(inst.root, 0)
  }
  return out
}

const PROBE = (filterSrc) => {
  const re = new RegExp(filterSrc)
  const el = document.querySelector('#app')
  const pinia = el && el.__vue_app__ && el.__vue_app__.config.globalProperties.$pinia
  const st = pinia && pinia._s && pinia._s.get('map')
  const r = st && st.currentRenderer
  if (!r || !r.viewer) return { err: 'renderer/viewer 不可达' }
  const C = window.Cesium
  const carto = (c) => {
    const cc = C.Ellipsoid.WGS84.cartesianToCartographic(c)
    return [(cc.longitude * 180) / Math.PI, (cc.latitude * 180) / Math.PI, cc.height]
  }
  const shape = (v) => {
    try {
      if (!v) return null
      const s = v.boundingSphere || v
      if (!s || !s.center) return null
      const g = carto(s.center)
      return {
        lng: Math.round(g[0] * 1e5) / 1e5,
        lat: Math.round(g[1] * 1e5) / 1e5,
        h: Math.round(g[2] * 10) / 10,
        r: Math.round(s.radius * 10) / 10,
      }
    } catch (e) {
      return 'ERR ' + String(e).slice(0, 40)
    }
  }
  const out = []
  for (const [id, rec] of r._layers) {
    const inst = rec && rec.instance
    if (!inst || !inst.root || !inst.root.children) continue
    const walk = (tile) => {
      const c = tile.content
      if (c) {
        const u = String(c.url || c._url || (c._resource && c._resource.url) || '')
        const tail = u.split('/').pop().split('?')[0]
        if (re.test(tail)) {
          out.push({
            layer: id,
            uri: tail,
            declaredContent: shape(tile._contentBoundingVolume),
            tileBox: shape(tile._boundingVolume),
            modelBs: shape(c._model),
            modelKeys: c._model
              ? Object.keys(c._model)
                  .filter((k) => /bound|sphere|radius|center|matrix/i.test(k))
                  .slice(0, 8)
              : null,
          })
        }
      }
      for (const kid of tile.children || []) walk(kid)
    }
    walk(inst.root)
  }
  return { tiles: out, selected: [...r._layers].map(([id, rec]) => [id, rec.visible]) }
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
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } })
  page.on('console', (m) => {
    const t = m.text()
    if (/\[CesiumRenderer\]|error|Error/.test(t)) console.log('[page]', t.slice(0, 200))
  })
  await page.goto(URL_, { waitUntil: 'domcontentloaded', timeout: 60000 })
  await page.waitForTimeout(8000)
  if (FLY) {
    const [lng, lat, h, hd, pitch] = FLY.split(',').map(Number)
    await page.evaluate(
      ([lng, lat, h, hd, pitch]) => {
        const el = document.querySelector('#app')
        const pinia = el && el.__vue_app__ && el.__vue_app__.config.globalProperties.$pinia
        const st = pinia && pinia._s && pinia._s.get('map')
        const r = st && st.currentRenderer
        if (!r) return
        window.Cesium.Camera.prototype.setView.call(
          r.viewer.camera,
          window.Cesium.Cartesian3.fromDegrees(lng, lat, h),
          window.Cesium.Math.toRadians(hd || 0),
          window.Cesium.Math.toRadians(pitch == null ? -60 : pitch)
        )
      },
      [lng, lat, h, hd, pitch]
    )
  }
  await page.waitForTimeout(WAIT)
  let res
  if (CHAIN) res = await page.evaluate(CHAINFN, [SEL, CHAIN.split(',').map(Number)])
  else if (MCHECK) res = await page.evaluate(MCHECKFN, [SEL, MCHECK.split(',').map(Number)])
  else if (DUMP) res = await page.evaluate(DUMPFN, DUMP)
  else res = await page.evaluate(PROBE, FILTER)
  console.log(JSON.stringify(res, null, 1))
  await page.screenshot({ path: path.join(OUTDIR, NAME + '.png') })
  await browser.close()
})().catch((e) => {
  console.error('FAILED', e)
  process.exit(1)
})
