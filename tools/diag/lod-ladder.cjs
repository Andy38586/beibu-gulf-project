/* lod-ladder.cjs — LOD 一致性阶梯：三枢纽 + 钦州港作业区，同一机位高度序列逐一读选中瓦片。
 *
 * 用户 2026-10-04 要求「LOD 距离要保证统一性」；判据形态见
 * docs/3dtiles-改造任务表.md §8.14 / §8.15：
 * 同一高度档下，四个资产的「在场 / 粗精程度」必须同构，且任何一档都不许整层空白。
 * **2026-10-04 22:5x 落地 §8.14 判据形态 ②④（像素维）**：
 *   ② 每格除 selected/tri 外，还测**中心窗口像素贡献**——该资产层 ON/OFF 两张截图，
 *      窗口 = 选中瓦片包围球的投影中心/半径（下限 120 px、上限半屏），用 diff-images.py
 *      数差分像素；「选到」不等于「画得出」（绕序反了照样 sel>0 零像素）；
 *   ④ 阳性对照（红样）= 把任一资产的远景粗层占位摘掉 ⇒ 对应档必须红：
 *      `node tools/diag/lod-ladder.cjs <url> 586000`（配合临时变异 shouldDropPortContent
 *      连 depth 0 一起摘，跑完按 md5 还原）。
 *
 * **2026-10-04 23:5x 补「同粗同细」判据**：§8.14 判据③要的是"同一相机距离下四资产的
 * 粗精程度一致"。此前六档（…80 km / 586 km）恰好**跨过**了不一致区间：三枢纽在
 * ~138 km 就退到粗壳，港区到 ~297 km 才退——六档全绿却漏判。本探针现在每格额外判
 * 「形态」：粗 = 只选中 1 块带内容瓦片（各资产的远景壳），细 = 选中 ≥2 块；
 * 同一高度下四资产形态必须一致，否则 exit 1 并在「形态表」里点名。
 * 形态判据的失效条件：某资产精细层在某机位合法地只选中 1 块（或远景壳合法拆成 ≥2 块）时
 * 本判据会误报——届时按实测改判据并写明理由，禁止直接删。
 *
 * 退出码：**任一格 `在场=否`、`主体px<=0`，或同一高度形态不一致 ⇒ exit 1**（红样即
 * "哪几个资产 × 哪几个高度"，
 * 阳性对照 = 把 `collapseEmptyLevels` / `capRootGeometricError` / `shouldDropPortContent`
 * 任一条停用，见 §8.15 实测表——停用后 80 km 或 586 km 必红）。
 *
 * 只读：不改源码、不改 tileset，走真 Edge + 真 Cesium。
 * **2026-10-04 起兼作 §四 #15-10「页面控制台无报错」的代跑通道**：除按关键词收集外，
 * 全量收集 error/warning 型 console 消息与 `pageerror`（未捕获异常），运行结束打印汇总并
 * 落 JSON。环境性错误（后端 DB 未起 ⇒ API 500、天地图 key 配额 ⇒ 底图瓦片失败）**不判红**，
 * 只要求"逐条可归因"；pageerror 非零时须查清是否渲染链缺陷。
 * 前置：① 前端 dev server 起着（默认 http://localhost:5174）；② 交付包在盘（.gitignore 排除，
 * 缺失时三枢纽/港区图层压根不注册 ⇒ 同样按 exit 1 记，不得当通过）。
 * 用法：node tools/diag/lod-ladder.cjs [url] [heights]   # heights 逗号分隔，默认 6 档
 */
'use strict'
const fs = require('fs')
const path = require('path')
const { execFileSync } = require('child_process')
const GROOT = require('child_process').execSync('npm root -g').toString().trim()
const { chromium } = require(path.join(GROOT, 'playwright-core'))

const ROOT = path.resolve(__dirname, '..', '..')
const OUT = path.join(ROOT, '.local', '3d-review', 'lod-ladder')
fs.mkdirSync(OUT, { recursive: true })
/** 像素判据的取数依赖：自建 diff 工具 + 带 Pillow 的 venv（与 §8.20 的截图 A/B 同一通道） */
const PY = path.join(ROOT, 'backend', 'algorithm-service', '.venv', 'Scripts', 'python.exe')
const DIFF = path.join(ROOT, 'tools', 'diag', 'diff-images.py')
const HALF = 120 // 中心窗口半宽（px）

const URL_ = process.argv[2] || 'http://localhost:5174/route-analysis'
const HEIGHTS = (process.argv[3] || '300,1500,6000,20000,80000,586000').split(',').map(Number)
// 瓦片就绪等待上限（ms）：细瓦片单块可达 13 MB，默认 14s 对近景偏短，可用 LADDER_WAIT_MS 加长
const WAIT_MS = Number(process.env.LADDER_WAIT_MS || 14000)
// --hide <layerId>：自测/阳性对照——临时把某资产隐藏，对应格必须红（主体px=0）。
// 为什么不用"摘 root 内容"当红样：derive 的 capRootGeometricError 会把 root 自身算进被摘空
// 节点 ⇒ root GE 抬高、远距离反而细化到 7 块细瓦片（实测 1 px，仍 >0，判据不红）。
const HIDE = (() => {
  const i = process.argv.indexOf('--hide')
  return i > -1 ? process.argv[i + 1] : null
})()

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

/**
 * 取"资产中心 ± 小窗口"的截图窗口（§8.14 判据②）：
 *   中心 = 该层**当前选中瓦片**包围球的合心投影（失败退回画布中心）；
 *   半径 = 裁剪到 [HALF, 半屏] 的**包围球投影像素半径**（Cesium 自己的像素尺度公式）。
 *
 * 两处都是实测踩出来的：① 画布中心不等于资产中心——港区"飞到"落点在港池水面上，
 * 低机位（300/1500 m）中心窗口只有水 ⇒ 差分恒 0（ON/OFF 截图逐字节相同、705 B 纯色图）；
 * ② 固定 ±120 px 在低空只覆盖几十米地面 ⇒ 会再把"画得好好的"误判成零贡献
 * （港区 300 m 档），故半径随包围球投影像素尺度走、下限 120 px、上限半屏。
 */
async function bodyClip(page, id) {
  return page.evaluate(
    (v) => {
      const R = document
        .querySelector('#app')
        .__vue_app__.config.globalProperties.$pinia._s.get('map').currentRenderer
      const viewer = R.viewer
      const r = viewer.scene.canvas.getBoundingClientRect()
      let cx = r.left + r.width / 2
      let cy = r.top + r.height / 2
      let radiusPx = v.half
      try {
        const C = window.Cesium
        const inst = R._layers.get(v.id).instance
        const spheres = []
        const pushTile = (t) => {
          const bv = t && (t._boundingVolume || t.boundingVolume)
          const s = (t && t.boundingSphere) || (bv && bv.boundingSphere)
          if (s && s.center) spheres.push({ c: s.center, r: s.radius || 0 })
        }
        for (const t of inst._selectedTiles || []) pushTile(t)
        if (!spheres.length && inst.root) pushTile(inst.root)
        if (spheres.length) {
          let sx = 0,
            sy = 0,
            sz = 0
          for (const s of spheres) {
            sx += s.c.x
            sy += s.c.y
            sz += s.c.z
          }
          const center = new C.Cartesian3(
            sx / spheres.length,
            sy / spheres.length,
            sz / spheres.length
          )
          const win = C.SceneTransforms.worldToWindowCoordinates(viewer.scene, center)
          if (win && isFinite(win.x) && isFinite(win.y)) {
            cx = win.x
            cy = win.y
            // 窗口半径 = 选中瓦片包围球的投影像素半径（Cesium 自己的像素尺度公式）
            const dist = Math.max(C.Cartesian3.distance(viewer.scene.camera.positionWC, center), 1)
            const pxPerM =
              viewer.scene.drawingBufferHeight / (dist * viewer.scene.camera.frustum.sseDenominator)
            let rUnion = 0
            for (const s of spheres) {
              rUnion = Math.max(rUnion, C.Cartesian3.distance(s.c, center) + s.r)
            }
            radiusPx = Math.min(
              Math.max(rUnion * pxPerM, v.half),
              Math.floor(Math.min(r.width, r.height) / 2) - 2
            )
          }
        }
      } catch (e) {
        /* 退回画布中心 */
      }
      const half = Math.round(radiusPx)
      cx = Math.min(
        Math.max(Math.round(cx), Math.round(r.left + half)),
        Math.round(r.left + r.width - half)
      )
      cy = Math.min(
        Math.max(Math.round(cy), Math.round(r.top + half)),
        Math.round(r.top + r.height - half)
      )
      return { x: cx - half, y: cy - half, width: half * 2, height: half * 2, half }
    },
    { id, half: HALF }
  )
}

/** 该层 ON/OFF 两张中心窗口截图 → diff-images.py 的像素贡献（px）；失败按 -1 记（红） */
async function measureBody(page, id, clip, h) {
  const on = path.join(OUT, `${id}-h${h}-body-on.png`)
  const off = path.join(OUT, `${id}-h${h}-body-off.png`)
  const toggle = (show) =>
    page.evaluate(
      (v) => {
        const r = document
          .querySelector('#app')
          .__vue_app__.config.globalProperties.$pinia._s.get('map').currentRenderer
        r._layers.get(v.id).instance.show = v.show
        r.viewer.scene.requestRender()
      },
      { id, show }
    )
  await page.screenshot({ path: on, clip })
  await toggle(false)
  await page.waitForTimeout(900)
  await page.screenshot({ path: off, clip })
  if (id !== HIDE) await toggle(true) // 自测模式：隐藏的层不恢复，保证每格都测"零贡献"
  await page.waitForTimeout(600)
  let raw = ''
  let err = null
  try {
    raw = execFileSync(PY, [DIFF, on, off], { encoding: 'utf8' })
  } catch (e) {
    err = String((e && e.message) || e).slice(0, 200)
  }
  const m = /DIFF (\d+) \/ (\d+) px = ([\d.]+)%/.exec(raw)
  return { px: m ? Number(m[1]) : -1, pct: m ? Number(m[3]) : null, err }
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
  const consoleMsgs = []
  const pageErrors = []
  page.on('console', (m) => {
    const t = m.text()
    const type = m.type()
    // 全量 error/warning + 3D Tiles/LOD 相关日志（不判红，供逐条归因）
    if (type === 'error' || type === 'warning' || /失败|3D Tiles|lod/i.test(t)) {
      // 带出错资源 URL（error 型消息只给 "Failed to load resource"，不带 URL 无法归因）
      let url = ''
      try {
        const loc = typeof m.location === 'function' ? m.location() : null
        if (loc && loc.url) url = ' @' + loc.url
      } catch {
        /* 无 location 时省略 */
      }
      consoleMsgs.push(type + ': ' + t.slice(0, 180) + url)
    }
  })
  page.on('pageerror', (e) => pageErrors.push(String((e && e.message) || e).slice(0, 300)))
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

  // 内容锚点：该层保留内容（root.children）包围球的合心 —— 机位阶梯对着它取景。
  // 为什么不用"飞到落点"：港区的落点在港池水面上，低机位（300 m）视窗只 ±116 m，
  // 作业区内容全在视窗外 ⇒ 会把"机位没框住"误判成"画不出"（2026-10-04 实测）。
  const contentAnchors = await page.evaluate((ids) => {
    const R = document
      .querySelector('#app')
      .__vue_app__.config.globalProperties.$pinia._s.get('map').currentRenderer
    const C = window.Cesium
    const out = {}
    for (const id of ids) {
      try {
        const inst = R._layers.get(id).instance
        const spheres = []
        const push = (t) => {
          const bv = t && (t._boundingVolume || t.boundingVolume)
          const s = (t && t.boundingSphere) || (bv && bv.boundingSphere)
          if (s && s.center) spheres.push(s)
        }
        for (const c of inst.root.children || []) push(c)
        if (!spheres.length) push(inst.root)
        let sx = 0,
          sy = 0,
          sz = 0
        for (const s of spheres) {
          sx += s.center.x
          sy += s.center.y
          sz += s.center.z
        }
        const g = C.Ellipsoid.WGS84.cartesianToCartographic(
          new C.Cartesian3(sx / spheres.length, sy / spheres.length, sz / spheres.length)
        )
        out[id] = {
          lng: (g.longitude * 180) / Math.PI,
          lat: (g.latitude * 180) / Math.PI,
          n: spheres.length,
        }
      } catch (e) {
        out[id] = null
      }
    }
    return out
  }, ASSETS)

  const anchors = {}
  for (const id of ASSETS) {
    const c = contentAnchors[id]
    anchors[id] = c ? { lng: c.lng, lat: c.lat } : ANCHORS[id]
  }
  console.log('anchors(内容中心):', JSON.stringify(anchors))
  console.log('anchors(静态落点):', JSON.stringify(ANCHORS))
  if (HIDE) {
    await page.evaluate((id) => {
      const r = document
        .querySelector('#app')
        .__vue_app__.config.globalProperties.$pinia._s.get('map').currentRenderer
      const rec = r._layers.get(id)
      if (rec && rec.instance) rec.instance.show = false
      r.viewer.scene.requestRender()
    }, HIDE)
    console.log(`（自测模式）已隐藏图层 ${HIDE} —— 对应格应报"在场但中心窗口零贡献"`)
  }

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
      const clip = await bodyClip(page, id)
      const body = await measureBody(page, id, clip, h)
      const isBlank = !present(l)
      const noBody = !isBlank && body.px <= 0
      // 形态：远景粗壳 = 单块带内容瓦片；精细 = ≥2 块（判据与失效条件见文件头）
      const coarse = !isBlank && l.selected === 1 && l.withContent === 1
      rows.push({
        asset: id,
        height: h,
        ok: !isBlank && !noBody,
        blank: isBlank,
        noBody,
        coarse,
        body,
        layer: l,
      })
      console.log(
        `${id.padEnd(24)} h=${String(h).padStart(7)} 在场=${present(l) ? '是' : '否'} ` +
          `sel=${l ? l.selected : '-'} 有内容=${l ? l.withContent : '-'} tri=${l ? l.tri : '-'} ` +
          `形态=${isBlank ? '·' : coarse ? '粗' : '细'} ` +
          `主体px=${body.px}${body.err ? ' (diff 失败:' + body.err + ')' : ''}`
      )
    }
  }

  // 一致性表：行=资产，列=高度
  console.log('\n一致性表（Y=有主体像素 / !=在场但中心窗口零贡献 / ·=整层空白；列=相机高度 m）')
  console.log('asset'.padEnd(26) + HEIGHTS.map((h) => String(h).padStart(8)).join(''))
  for (const id of ASSETS) {
    const cells = HEIGHTS.map((h) => {
      const row = rows.find((r) => r.asset === id && r.height === h)
      const mark = !row || row.blank ? '·' : row.noBody ? '!' : 'Y'
      return mark.padStart(8)
    })
    console.log(id.padEnd(26) + cells.join(''))
  }

  // 形态表：同一高度下四资产必须同为「细」或同为「粗」（判据③；失效条件见文件头）
  console.log('\n形态表（细=选中≥2 块 / 粗=只选中 1 块远景壳 / ·=整层空白；列=相机高度 m）')
  console.log('asset'.padEnd(26) + HEIGHTS.map((h) => String(h).padStart(8)).join(''))
  for (const id of ASSETS) {
    const cells = HEIGHTS.map((h) => {
      const row = rows.find((r) => r.asset === id && r.height === h)
      const mark = !row || row.blank ? '·' : row.noBody ? '!' : row.coarse ? '粗' : '细'
      return mark.padStart(8)
    })
    console.log(id.padEnd(26) + cells.join(''))
  }

  fs.writeFileSync(
    path.join(OUT, 'lod-ladder.json'),
    JSON.stringify(
      {
        url: URL_,
        heights: HEIGHTS,
        anchors,
        rows,
        // 不按 120 条截断：实测 141+ 条时 404 类证据恰好落在截断线外（整类归因会消失）。
        // 上限 500 仅防失控增长；触顶时下面会打印"截断"标注。
        consoleMsgs: consoleMsgs.slice(0, 500),
        pageErrors,
      },
      null,
      2
    )
  )
  console.log(
    `\n控制台：error/warning ${consoleMsgs.length} 条 ｜ 未捕获异常(pageerror) ${pageErrors.length} 条` +
      (consoleMsgs.length > 500 ? '（JSON 只存前 500 条，已截断）' : '') +
      (pageErrors.length > 0 ? ' ← 非零须逐条归因（可能为渲染链缺陷）' : '')
  )
  console.log('written', path.join(OUT, 'lod-ladder.json'))
  // 判据：任一格整层空白 或 "在场但中心窗口零像素贡献" ⇒ 红
  // （含"交付包不在盘、图层没注册"这种行缺失）
  const blank = []
  const noBody = []
  for (const id of ASSETS) {
    for (const h of HEIGHTS) {
      const row = rows.find((r) => r.asset === id && r.height === h)
      if (!row || row.blank) blank.push(`${id}@${h}m`)
      else if (row.noBody) noBody.push(`${id}@${h}m`)
    }
  }
  if (blank.length > 0) {
    console.error(`LOD 阶梯红：${blank.length} 格整层空白 —— ${blank.join(', ')}`)
    process.exitCode = 1
  }
  if (noBody.length > 0) {
    console.error(
      `LOD 阶梯红：${noBody.length} 格「在场但中心窗口零像素贡献」（选到不等于画得出）—— ` +
        noBody.join(', ')
    )
    process.exitCode = 1
  }
  // 判据③：同一高度下形态（粗/细）必须一致——"各资产分叉"就是用户说的 LOD 距离不统一
  const mixed = []
  for (const h of HEIGHTS) {
    const cells = ASSETS.map((id) => ({
      id,
      row: rows.find((r) => r.asset === id && r.height === h),
    }))
      .filter((c) => c.row && !c.row.blank)
      .map((c) => ({ id: c.id, kind: c.row.coarse ? '粗' : '细' }))
    const kinds = new Set(cells.map((c) => c.kind))
    if (cells.length > 1 && kinds.size > 1) {
      mixed.push(`h=${h}: ` + cells.map((c) => `${c.id}=${c.kind}`).join(', '))
    }
  }
  if (mixed.length > 0) {
    console.error(`LOD 阶梯红：${mixed.length} 个高度「四资产粗精形态不一致」——` + mixed.join('；'))
    process.exitCode = 1
  }
  await browser.close()
})().catch((e) => {
  console.error('PROBE-FAIL', e && e.message)
  process.exit(1)
})
