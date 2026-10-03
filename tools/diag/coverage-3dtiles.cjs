/* coverage.cjs — 覆盖判据：每个图层到**它自己内容所在的位置**上看，能不能真被渲染出来。
 *
 * 判据（每层都要满足，否则 exit 1）：轮询期间出现过 selected>0 且 numberOfTrianglesSelected>0。
 * 轮询 4 次、每次重设机位——应用侧会重放相机状态，单次采样可能是"还没到位"。
 *
 * 机位怎么来（两轮踩坑后的口径）：
 *   · 北部湾那 5 层：root 包围球就是内容外包络 ⇒ 用运行时 boundingSphere（h = 2.5r 保证整球进画面）。
 *   · 平陆运河那 4 层：交付包 root 盒是 **17 个 child 的外包络**，每个 child 自带 transform
 *     （实测 17/17 都有），按 root 盒取机位会落到马道以外 25 km ⇒ 把"框不到"误读成"不渲染"。
 *     故这三枢纽的机位**离线**由 child 盒 × child transform 推出（见 hubCameras()），不手抄坐标。
 *
 * 诚实边界：三枢纽机位读的是 backend/static/pinglu/tiles/tileset.json（**.gitignore 排除**的交付包）。
 * 交付包不在盘上时脚本降级为运行时 root 球并打印 WARN——那时对枢纽的结论不成立，不得当通过。
 */
'use strict'
const fs = require('fs'),
  path = require('path')
const GROOT = require('child_process').execSync('npm root -g').toString().trim()
const { chromium } = require(path.join(GROOT, 'playwright-core'))
const ROOT = path.resolve(__dirname, '..', '..')
const OUT = path.join(ROOT, '.local', 'coverage')
fs.mkdirSync(OUT, { recursive: true })
const ONLY =
  process.argv.indexOf('--only') > -1 ? process.argv[process.argv.indexOf('--only') + 1] : null

/* ---------- 离线：三枢纽的真实位置（child 盒 × child transform） ---------- */
const A = 6378137.0,
  F = 1 / 298.257223563,
  E2 = F * (2 - F)
function geo(p) {
  const x = p[0],
    y = p[1],
    z = p[2]
  const lng = Math.atan2(y, x),
    p2 = Math.hypot(x, y)
  let lat = Math.atan2(z, p2 * (1 - E2)),
    h = 0
  for (let i = 0; i < 8; i++) {
    const N = A / Math.sqrt(1 - E2 * Math.sin(lat) ** 2)
    h = p2 / Math.cos(lat) - N
    lat = Math.atan2(z, p2 * (1 - (E2 * N) / (N + h)))
  }
  return [(lng * 180) / Math.PI, (lat * 180) / Math.PI, h]
}
const mul = (a, b) => {
  const o = new Array(16).fill(0)
  for (let i = 0; i < 4; i++)
    for (let j = 0; j < 4; j++) {
      let s = 0
      for (let k = 0; k < 4; k++) s += a[k * 4 + j] * b[i * 4 + k]
      o[i * 4 + j] = s
    }
  return o
}
const ap = (m, p) => [
  m[0] * p[0] + m[4] * p[1] + m[8] * p[2] + m[12],
  m[1] * p[0] + m[5] * p[1] + m[9] * p[2] + m[13],
  m[2] * p[0] + m[6] * p[1] + m[10] * p[2] + m[14],
]
const ID = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]
function hubCameras() {
  const tileFile = path.join(ROOT, 'backend/static/pinglu/tiles/tileset.json')
  if (!fs.existsSync(tileFile)) {
    console.log(
      'WARN 无 ' + tileFile + '（交付包未拉取）⇒ 枢纽机位降级为运行时 root 球，结论对枢纽不成立'
    )
    return {}
  }
  const ts = JSON.parse(fs.readFileSync(tileFile, 'utf8'))
  const groups = { madao: [], qishi: [], qingnian: [] }
  ;(function walk(n, M) {
    let W = M
    if (n.transform) W = mul(M, n.transform)
    const uri = n.content && n.content.uri
    if (uri)
      for (const k of Object.keys(groups)) if (uri.startsWith(k + '-')) groups[k].push({ n, W })
    ;(n.children || []).forEach((c) => walk(c, W))
  })(ts.root, ID)
  const out = {}
  for (const [k, list] of Object.entries(groups)) {
    let mn = [Infinity, Infinity, Infinity],
      mx = [-Infinity, -Infinity, -Infinity]
    for (const { n, W } of list) {
      const b = n.boundingVolume && n.boundingVolume.box
      if (!b) continue
      for (let i = 0; i < 8; i++) {
        const g = [
          i & 1 ? b[0] + b[3] : b[0] - b[3],
          i & 2 ? b[1] + b[7] : b[1] - b[7],
          i & 4 ? b[2] + b[11] : b[2] - b[11],
        ]
        const w = ap(W, g)
        for (let c = 0; c < 3; c++) {
          mn[c] = Math.min(mn[c], w[c])
          mx[c] = Math.max(mx[c], w[c])
        }
      }
    }
    const c = geo([(mn[0] + mx[0]) / 2, (mn[1] + mx[1]) / 2, (mn[2] + mx[2]) / 2])
    out['pinglu-' + k] = {
      lng: c[0],
      lat: c[1],
      r: 0.5 * Math.hypot(mx[0] - mn[0], mx[1] - mn[1], mx[2] - mn[2]),
    }
  }
  return out
}

;(async () => {
  const hubs = hubCameras()
  console.log(
    '离线推出的枢纽机位: ' +
      Object.entries(hubs)
        .map(
          ([k, v]) => k + '@' + v.lng.toFixed(4) + ',' + v.lat.toFixed(4) + ' r=' + Math.round(v.r)
        )
        .join('  ')
  )
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
    await browser.newContext({ viewport: { width: 900, height: 620 }, deviceScaleFactor: 1 })
  ).newPage()
  await page.goto('http://localhost:5173/route-analysis', {
    waitUntil: 'domcontentloaded',
    timeout: 60000,
  })
  await page.waitForTimeout(24000)

  const targets = await page.evaluate(() => {
    const C = window.Cesium
    const r = document
      .querySelector('#app')
      .__vue_app__.config.globalProperties.$pinia._s.get('map').currentRenderer
    const o = []
    for (const [id, rec] of r._layers) {
      const t = rec && rec.instance
      if (!t || !t.root || !t.boundingSphere) continue
      const c = C.Ellipsoid.WGS84.cartesianToCartographic(t.boundingSphere.center)
      o.push({
        id,
        lng: (c.longitude * 180) / Math.PI,
        lat: (c.latitude * 180) / Math.PI,
        r: t.boundingSphere.radius,
      })
    }
    return o
  })

  const rows = []
  for (const t of targets) {
    if (ONLY && !t.id.includes(ONLY)) continue
    const hb = hubs[t.id]
    const lng = hb ? hb.lng : t.lng
    const lat = hb ? hb.lat : t.lat
    const r = hb ? hb.r : t.r
    const h = Math.min(40000, Math.max(1200, r * 2.5))
    let best = { sel: 0, tri: 0, visited: 0 }
    for (let k = 0; k < 4; k++) {
      await page.evaluate(
        (p) => {
          const C = window.Cesium
          const v = document
            .querySelector('#app')
            .__vue_app__.config.globalProperties.$pinia._s.get('map').currentRenderer.viewer
          v.camera.flyTo({
            destination: C.Cartesian3.fromDegrees(p.lng, p.lat, p.h),
            orientation: { heading: 0, pitch: (-90 * Math.PI) / 180, roll: 0 },
            duration: 0,
          })
        },
        { lng, lat, h }
      )
      await page.waitForTimeout(2600)
      const s = await page.evaluate((id) => {
        const r2 = document
          .querySelector('#app')
          .__vue_app__.config.globalProperties.$pinia._s.get('map').currentRenderer
        const rec = r2._layers.get(id)
        const inst = rec && rec.instance
        if (!inst || !inst.statistics) return null
        return {
          sel: inst.statistics.selected,
          tri: inst.statistics.numberOfTrianglesSelected,
          visited: inst.statistics.visited,
        }
      }, t.id)
      if (s && s.sel > best.sel) best = s
      if (best.sel > 0 && best.tri > 0) break
    }
    const ok = best.sel > 0 && best.tri > 0
    rows.push({
      id: t.id,
      camLng: +lng.toFixed(5),
      camLat: +lat.toFixed(5),
      camH: Math.round(h),
      r: Math.round(r),
      from: hb ? 'offline-child-box' : 'runtime-root-sphere',
      sel: best.sel,
      tri: best.tri,
      visited: best.visited,
      ok,
    })
    console.log(
      (ok ? 'OK   ' : 'GAP  ') +
        t.id.padEnd(24) +
        ' cam=' +
        lng.toFixed(4) +
        ',' +
        lat.toFixed(4) +
        ' h=' +
        Math.round(h) +
        ' src=' +
        (hb ? 'child' : 'root') +
        ' selected=' +
        best.sel +
        ' tris=' +
        best.tri
    )
  }
  const gaps = rows.filter((x) => !x.ok)
  fs.writeFileSync(path.join(OUT, 'coverage.json'), JSON.stringify(rows, null, 2))
  console.log('---')
  console.log(
    '覆盖 ' +
      (rows.length - gaps.length) +
      '/' +
      rows.length +
      '；未覆盖: ' +
      (gaps.length ? gaps.map((g) => g.id).join(', ') : '无')
  )
  await browser.close()
  process.exit(gaps.length ? 1 : 0)
})().catch((e) => {
  console.error('COV-FAIL', e && e.message)
  process.exit(2)
})
