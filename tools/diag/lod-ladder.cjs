/* lod-ladder.cjs — LOD 一致性阶梯：三枢纽 + 钦州港作业区，同一机位高度序列逐一读选中瓦片。
 *
 * 用户 2026-10-04 要求「LOD 距离要保证统一性」；判据形态见
 * docs/3dtiles-改造任务表.md §8.14 / §8.15：
 * 同一高度档下，四个资产的「在场 / 粗精程度」必须同构，且任何一档都不许整层空白。
 *
 * 退出码：**任一格 `在场=否` ⇒ exit 1**（红样即"哪几个资产 × 哪几个高度"，
 * 阳性对照 = 把 `collapseEmptyLevels` / `capRootGeometricError` / `shouldDropPortContent`
 * 任一条停用，见 §8.15 实测表——停用后 80 km 或 586 km 必红）。
 *
 * 只读：不改源码、不改 tileset，走真 Edge + 真 Cesium。
 * 前置：① 前端 dev server 起着（默认 http://localhost:5174）；② 交付包在盘（.gitignore 排除，
 * 缺失时三枢纽/港区图层压根不注册 ⇒ 同样按 exit 1 记，不得当通过）。
 * 用法：node tools/diag/lod-ladder.cjs [url] [heights]   # heights 逗号分隔，默认 6 档
 */
'use strict'
const fs = require('fs')
const path = require('path')
const GROOT = require('child_process').execSync('npm root -g').toString().trim()
const { chromium } = require(path.join(GROOT, 'playwright-core'))

const ROOT = path.resolve(__dirname, '..', '..')
const OUT = path.join(ROOT, '.local', '3d-review', 'lod-ladder')
fs.mkdirSync(OUT, { recursive: true })

const URL_ = process.argv[2] || 'http://localhost:5174/route-analysis'
const HEIGHTS = (process.argv[3] || '300,1500,6000,20000,80000,586000').split(',').map(Number)
// 瓦片就绪等待上限（ms）：细瓦片单块可达 13 MB，默认 14s 对近景偏短，可用 LADDER_WAIT_MS 加长
const WAIT_MS = Number(process.env.LADDER_WAIT_MS || 14000)

// 被测资产：三枢纽（07 交付版，同属一个 tileset 的三个分组）+ 钦州港作业区（交付包）。
// 锚点**全部从 tileset 自身几何推导**（不手抄坐标）：
//   三枢纽 = pinglu tileset：root.transform × child.transform × 该 child 盒中心 → 4326；
//   钦州港 = qinzhou-port tileset：root.transform 平移分量 → 4326（= catalog harbour 原点）。
// 为什么不能读图层 root.transform：三枢纽是同一个 tileset 的派生分组，共用 root 变换，
// 实测三者都读出 108.83/22.2（整包 ENU 原点），与真实枢纽差 ~25 km。
function mul(m, v) {
  return [
    m[0] * v[0] + m[4] * v[1] + m[8] * v[2] + m[12],
    m[1] * v[0] + m[5] * v[1] + m[9] * v[2] + m[13],
    m[2] * v[0] + m[6] * v[1] + m[10] * v[2] + m[14],
  ]
}
/** 列主序 4×4 相乘（a∘b：先 b 后 a） */
function matMul(a, b) {
  const o = new Array(16).fill(0)
  for (let c = 0; c < 4; c++) {
    for (let r = 0; r < 4; r++) {
      let s = 0
      for (let k = 0; k < 4; k++) s += a[k * 4 + r] * b[c * 4 + k]
      o[c * 4 + r] = s
    }
  }
  return o
}
function ecefToGeo([x, y, z]) {
  const a = 6378137.0
  const f = 1 / 298.257223563
  const e2 = f * (2 - f)
  const b = a * (1 - f)
  const ep2 = (a * a - b * b) / (b * b)
  const p = Math.hypot(x, y)
  const th = Math.atan2(z * a, p * b)
  const lon = Math.atan2(y, x)
  const lat = Math.atan2(z + ep2 * b * Math.sin(th) ** 3, p - e2 * a * Math.cos(th) ** 3)
  return { lng: (lon * 180) / Math.PI, lat: (lat * 180) / Math.PI }
}

function deriveAnchors() {
  const out = {}
  const pinglu = JSON.parse(
    fs.readFileSync(path.join(ROOT, 'backend/static/pinglu/tiles/tileset.json'), 'utf8')
  )
  const rootT = pinglu.root.transform
  const want = { 马道枢纽: 'pinglu-madao', 企石枢纽: 'pinglu-qishi', 青年枢纽: 'pinglu-qingnian' }
  for (const c of pinglu.root.children) {
    const name = (c.extras && c.extras.name) || ''
    const id = want[name]
    if (!id) continue
    const local = c.boundingVolume.box.slice(0, 3)
    const world = c.transform ? mul(rootT, mul(c.transform, local)) : mul(rootT, local)
    out[id] = ecefToGeo(world)
  }
  // 钦州港：交付包 root 原点是 anchor.json 的 108.6375/21.655（作业区中心在它东北 ~2.4 km，
  // 交付包 96 块里的那一簇），交付包没把 catalog 的 harbour 条目一并提取 ⇒ 不能从 tileset 现算。
  // 故读**前端自己的"飞到作业区"落点**（beibu3dTiles.ts 的 BEIBU_TILES_VIEWS['qinzhou-port']，
  // 其出处即交付包 catalog harbour）——从源码正则取，常数一改本探针自动跟随，不手抄。
  const tsSrc = fs.readFileSync(
    path.join(ROOT, 'frontend/src/business/route-analysis/constants/beibu3dTiles.ts'),
    'utf8'
  )
  const m = tsSrc.match(/'qinzhou-port':\s*\{\s*lng:\s*([\d.]+),\s*lat:\s*([\d.]+)/)
  if (!m) throw new Error('未能从 beibu3dTiles.ts 取到 qinzhou-port 落点')
  out['beibu-qinzhou-port'] = { lng: Number(m[1]), lat: Number(m[2]) }
  return out
}

const ANCHORS = deriveAnchors()
const ASSETS = Object.keys(ANCHORS)

function snapshot(arg) {
  const ids = arg.ids
  const treeLayer = arg.treeLayer
  const el = document.querySelector('#app')
  const r = el.__vue_app__.config.globalProperties.$pinia._s.get('map').currentRenderer
  const out = { layers: {} }
  for (const id of ids) {
    const rec = r._layers.get(id)
    const inst = rec && rec.instance
    if (!inst) {
      out.layers[id] = null
      continue
    }
    const tiles = []
    let withContent = 0
    for (const t of inst._selectedTiles || []) {
      let u = ''
      try {
        u =
          (t._contentResource && (t._contentResource.url || t._contentResource._url)) ||
          (t.content && (t.content.url || t.content._url)) ||
          ''
      } catch (e) {
        u = 'ERR'
      }
      const tail = String(u).split('/').pop().split('?')[0]
      if (tail) withContent += 1
      tiles.push(tail || '(无内容)')
    }
    out.layers[id] = {
      show: inst.show,
      visible: !!rec.visible,
      selected: (inst._selectedTiles || []).length,
      withContent,
      tri: inst.statistics ? inst.statistics.numberOfTrianglesSelected : null,
      visited: inst.statistics ? inst.statistics.numberOfTilesVisited : null,
      loaded: !!inst.tilesLoaded,
      tiles: tiles.slice(0, 12),
      // 远景归因用：根节点有没有内容、子树剩几块（内容被 derive 摘掉的形态就靠这两个字段分辨）
      rootHasContent: !!(inst.root && inst.root._content),
      rootUri: (() => {
        try {
          return ((inst.root._content && inst.root._content.url) || '').split('/').pop()
        } catch (e) {
          return 'ERR'
        }
      })(),
      childCount: inst.root && inst.root.children ? inst.root.children.length : 0,
    }
    if (treeLayer && id === treeLayer) {
      const walk = (t, depth) => {
        const C = window.Cesium
        let sph = null
        try {
          if (t.boundingSphere) {
            const c = C.Cartographic.fromCartesian(t.boundingSphere.center)
            sph = {
              lng: +C.Math.toDegrees(c.longitude).toFixed(4),
              lat: +C.Math.toDegrees(c.latitude).toFixed(4),
              r: Math.round(t.boundingSphere.radius),
            }
          }
        } catch (e) {
          sph = 'ERR'
        }
        const node = {
          depth: t.extras && t.extras.depth,
          ge: t.geometricError,
          sse: t._screenSpaceError != null ? +t._screenSpaceError.toFixed(2) : null,
          dist: t._distanceToCamera != null ? Math.round(t._distanceToCamera) : null,
          selected: !!t._selected,
          hasContent: !!t._content,
          ready: t._content ? !!t._content.ready : null,
          empty: t.hasEmptyContent,
          sph,
        }
        if (depth > 0 && t.children && t.children.length) {
          node.children = t.children.slice(0, 4).map((c) => walk(c, depth - 1))
        }
        return node
      }
      out.layers[id].portTree = walk(inst.root, 2)
    }
  }
  return out
}

const present = (l) => !!(l && l.withContent > 0 && l.tri > 0)

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
  const consoleMsgs = []
  page.on('console', (m) => {
    const t = m.text()
    if (/error|失败|3D Tiles|lod/i.test(t)) consoleMsgs.push(m.type() + ': ' + t.slice(0, 200))
  })
  await page.goto(URL_, { waitUntil: 'domcontentloaded', timeout: 60000 })

  const deadline = Date.now() + 90000
  let ready = false
  while (Date.now() < deadline) {
    await page.waitForTimeout(3000)
    ready = await page.evaluate((ids) => {
      const el = document.querySelector('#app')
      const pinia = el && el.__vue_app__ && el.__vue_app__.config.globalProperties.$pinia
      const st = pinia && pinia._s && pinia._s.get('map')
      const r = st && st.currentRenderer
      if (!r || !r._layers) return false
      return ids.every((id) => {
        const rec = r._layers.get(id)
        return rec && rec.instance
      })
    }, ASSETS)
    if (ready) break
  }
  console.log('layers ready:', ready)

  const anchors = {}
  for (const id of ASSETS) anchors[id] = ANCHORS[id]
  console.log('anchors:', JSON.stringify(anchors))

  const rows = []
  for (const id of ASSETS) {
    const a = anchors[id]
    if (!a) {
      console.log(`${id}: 无 root.transform，跳过`)
      continue
    }
    for (const h of HEIGHTS) {
      for (let attempt = 0; attempt < 4; attempt++) {
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
          [a.lng, a.lat, h]
        )
        await page.waitForTimeout(1200)
        const got = await page.evaluate(() => {
          const viewer = document
            .querySelector('#app')
            .__vue_app__.config.globalProperties.$pinia._s.get('map').currentRenderer.viewer
          return viewer.camera.positionCartographic.height
        })
        if (Math.abs(got - h) < Math.max(80, h * 0.03)) break
      }
      // 等本资产瓦片就绪（最多 14s）
      const t0 = Date.now()
      while (Date.now() - t0 < WAIT_MS) {
        const loaded = await page.evaluate((lid) => {
          const r = document
            .querySelector('#app')
            .__vue_app__.config.globalProperties.$pinia._s.get('map').currentRenderer
          const rec = r._layers.get(lid)
          return !!(rec && rec.instance && rec.instance.tilesLoaded)
        }, id)
        if (loaded) break
        await page.waitForTimeout(1500)
      }
      const snap = await page.evaluate(snapshot, {
        ids: ASSETS,
        treeLayer: process.env.PORT_TREE ? 'beibu-qinzhou-port' : null,
      })
      const l = snap.layers[id]
      rows.push({ asset: id, height: h, ok: present(l), layer: l })
      console.log(
        `${id.padEnd(24)} h=${String(h).padStart(7)} 在场=${present(l) ? '是' : '否'} ` +
          `sel=${l ? l.selected : '-'} 有内容=${l ? l.withContent : '-'} tri=${l ? l.tri : '-'}`
      )
    }
  }

  // 一致性表：行=资产，列=高度
  console.log('\n一致性表（Y=有主体 / ·=整层空白；列=相机高度 m）')
  console.log('asset'.padEnd(26) + HEIGHTS.map((h) => String(h).padStart(8)).join(''))
  for (const id of ASSETS) {
    const cells = HEIGHTS.map((h) => {
      const row = rows.find((r) => r.asset === id && r.height === h)
      return (row && row.ok ? 'Y' : '·').padStart(8)
    })
    console.log(id.padEnd(26) + cells.join(''))
  }

  fs.writeFileSync(
    path.join(OUT, 'lod-ladder.json'),
    JSON.stringify(
      { url: URL_, heights: HEIGHTS, anchors, rows, consoleMsgs: consoleMsgs.slice(0, 60) },
      null,
      2
    )
  )
  console.log('written', path.join(OUT, 'lod-ladder.json'))
  // 判据：任一格整层空白 ⇒ 红（含"交付包不在盘、图层没注册"这种行缺失）
  const blank = []
  for (const id of ASSETS) {
    for (const h of HEIGHTS) {
      const row = rows.find((r) => r.asset === id && r.height === h)
      if (!row || !row.ok) blank.push(`${id}@${h}m`)
    }
  }
  if (blank.length > 0) {
    console.error(`LOD 阶梯红：${blank.length} 格整层空白 —— ${blank.join(', ')}`)
    process.exitCode = 1
  }
  await browser.close()
})().catch((e) => {
  console.error('PROBE-FAIL', e && e.message)
  process.exit(1)
})
