/* probe-3dtiles-runtime.cjs — 只读：3D Tiles 图层在运行时的加载/渲染状态 + 背面剔除 A/B。
 * 回答：sel>0 却 0 像素贡献，是"内容没就绪"还是"被剔除/被遮挡/几何退化"。
 * 用法: node tools/diag/probe-3dtiles-runtime.cjs --url http://127.0.0.1:5174/route-analysis \
 *        --fly 108.6473,21.6745,1200,0,-35 --wait 30000 --re "qz-roads|qinzhou-port" --backface
 * --backface 追加三张截图（none / 默认剔除 / 关剔除）到 .local/3d-review/，配 tools/diag/diff-images.py 出百分比：
 *   差异(none, on)=该层可见贡献；差异(on, off)=背面被剔除的像素（修好绕序后应≈0）。
 * 前置：前端 dev server 起着；交付包/重建层在盘（缺则图层不注册，sel=0 不是"渲染问题"）。
 */
'use strict'
const fs = require('fs')
const path = require('path')
const GROOT = require('child_process').execSync('npm root -g').toString().trim()
const { chromium } = require(path.join(GROOT, 'playwright-core'))

const ROOT = path.resolve(__dirname, '..', '..')
const OUT = path.join(ROOT, '.local', '3d-review')
fs.mkdirSync(OUT, { recursive: true })

const arg = (n, d) => {
  const i = process.argv.indexOf('--' + n)
  return i > -1 ? process.argv[i + 1] : d
}
const URL_ = arg('url', 'http://127.0.0.1:5174/route-analysis')
const FLY = arg('fly', '108.6473,21.6745,1200,0,-35')
const WAIT = Number(arg('wait', 30000))
const RE = arg('re', 'qz-roads|qinzhou-port')
// --netlog：记录 /static 请求，并在 fly 前（goto 后 12 s = 默认全域视角首屏）结算一次
// "请求了哪些文件 + 合计字节"。字节取盘上文件大小（dev server 原样分发，无 gzip）。
const NETLOG = process.argv.includes('--netlog')

const Q = (reSrc) => {
  const re = new RegExp(reSrc)
  const el = document.querySelector('#app')
  const pinia = el && el.__vue_app__ && el.__vue_app__.config.globalProperties.$pinia
  const r = pinia && pinia._s && pinia._s.get('map')
  const R = r && r.currentRenderer
  const C = window.Cesium
  const carto = (c) => {
    const g = C.Ellipsoid.WGS84.cartesianToCartographic(c)
    return [
      Math.round(g.longitude * 1e5 * 180) / Math.PI / 1e5,
      Math.round(g.latitude * 1e5 * 180) / Math.PI / 1e5,
      Math.round(g.height * 10) / 10,
    ]
  }
  const out = []
  for (const [id, rec] of R._layers) {
    if (!re.test(id)) continue
    const inst = rec && rec.instance
    if (!inst || !inst.root) continue
    const sel = (inst._selectedTiles || []).map((t) => {
      const c = t.content
      const m = c && c._model
      return {
        uri: String((c && (c.url || (c._resource && c._resource.url))) || '')
          .split('/')
          .pop(),
        state: t._contentState,
        hasContent: !!c,
        hasModel: !!m,
        modelReady: m ? m.ready : null,
        modelShow: m ? m.show : null,
        contentBox:
          t._contentBoundingVolume && t._contentBoundingVolume.boundingSphere
            ? carto(t._contentBoundingVolume.boundingSphere.center)
            : null,
      }
    })
    out.push({
      id,
      show: inst.show,
      visible: rec.visible,
      tilesLoaded: !!inst.tilesLoaded,
      selCount: (inst._selectedTiles || []).length,
      stat: inst.statistics
        ? {
            sel: inst.statistics.numberOfTilesSelected,
            loading: inst.statistics.numberOfTilesLoading,
            loaded: inst.statistics.numberOfTilesLoaded,
            total: inst.statistics.numberOfTilesTotal,
            attempted: inst.statistics.numberOfAttemptedRequests,
          }
        : null,
      rootGE: inst.root.geometricError,
      bs: inst.boundingSphere
        ? carto(inst.boundingSphere.center).concat([Math.round(inst.boundingSphere.radius)])
        : null,
      sel,
    })
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
  const page = await browser.newPage({ viewport: { width: 900, height: 620 } })
  const seenStatic = new Map()
  page.on('response', (r) => {
    if (!NETLOG) return
    const m = r.url().match(/\/static\/(.+)$/)
    if (m) seenStatic.set(decodeURIComponent(m[1].split('?')[0]), true)
  })
  page.on('console', (m) => {
    const t = m.text()
    if (/404|Failed to load|error/i.test(t)) console.log('[page]', t.slice(0, 160))
  })
  await page.goto(URL_, { waitUntil: 'domcontentloaded', timeout: 60000 })
  await page.waitForTimeout(12000)
  const firstScreen = NETLOG ? [...seenStatic.keys()] : []
  const p = FLY.split(',').map(Number)
  await page.evaluate((a) => {
    const C = window.Cesium
    const v = document
      .querySelector('#app')
      .__vue_app__.config.globalProperties.$pinia._s.get('map').currentRenderer.viewer
    v.camera.flyTo({
      destination: C.Cartesian3.fromDegrees(a[0], a[1], a[2]),
      orientation: {
        heading: ((a[3] || 0) * Math.PI) / 180,
        pitch: ((a[4] || -45) * Math.PI) / 180,
        roll: 0,
      },
      duration: 0,
    })
  }, p)
  await page.waitForTimeout(WAIT)
  console.log(JSON.stringify(await page.evaluate(Q, RE), null, 1))
  // 背面剔除对照：只开道路层 → 截图；再关 backFaceCulling → 截图。两张图有差即"绕序反了"。
  if (process.argv.includes('--backface')) {
    const shot = async (name, patch) => {
      await page.evaluate(
        ([reSrc, mode]) => {
          const re = new RegExp(reSrc)
          const r = document
            .querySelector('#app')
            .__vue_app__.config.globalProperties.$pinia._s.get('map').currentRenderer
          for (const [id, rec] of r._layers) {
            const i = rec && rec.instance
            if (!i || !i.root) continue
            const on = mode === 'none' ? false : re.test(id)
            i.show = on
            // 默认关闭的图层：图层记录里的 visible 也要置位，否则应用侧会把 show 再压回 false
            if (on && rec) rec.visible = true
            if (mode === 'on') i.backFaceCulling = true
            if (mode === 'nobackface') i.backFaceCulling = false
          }
          r.viewer.scene.requestRender()
        },
        [RE, patch]
      )
      await page.waitForTimeout(9000)
      await page.screenshot({ path: path.join(OUT, name + '.png') })
    }
    await shot('roads-bf-none', 'none')
    await shot('roads-bf-on', 'on')
    await shot('roads-bf-off', 'nobackface')
    console.log('WROTE ' + OUT + '\\roads-bf-{none,on,off}.png')
  }
  if (NETLOG) {
    const rows = []
    let total = 0
    for (const rel of firstScreen) {
      const f = path.join(ROOT, 'backend', 'static', rel)
      try {
        const s = fs.statSync(f).size
        total += s
        rows.push([s, f])
      } catch {
        rows.push([0, f])
      }
    }
    rows.sort((a, b) => b[0] - a[0])
    console.log(
      `NETLOG 首屏（goto 后 12 s，fly 前）：/static 请求 ${firstScreen.length} 个，合计 ${(total / 1048576).toFixed(2)} MB`
    )
    for (const [s, f] of rows.slice(0, 10)) {
      console.log(`  ${(s / 1048576).toFixed(2)} MB  ${path.relative(ROOT, f)}`)
    }
    fs.writeFileSync(
      path.join(OUT, 'netlog-firstscreen.json'),
      JSON.stringify({ urls: firstScreen, totalBytes: total }, null, 1)
    )
    console.log('WROTE ' + path.join(OUT, 'netlog-firstscreen.json'))
  }
  await browser.close()
})().catch((e) => {
  console.error('FAILED', e && e.message)
  process.exit(1)
})
