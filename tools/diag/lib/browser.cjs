/* browser.cjs — tools/diag 浏览器探针的公共底座（CMC01 P6 / C11 收口）。
 *
 * 治什么：15 个 diag 探针各自手抄同一套取链与启动参数——
 *   · npm root -g → 全局 playwright-core 取链：15 份逐字相同；
 *   · Edge + swiftshader 启动参数块：14 份逐字相同（第十五个 diag-3d-browser.cjs 已漏一项）；
 *   · 仓库根 path.resolve(__dirname, '..', '..')：12 份，名字还有 ROOT / ROOT0 两版；
 *   · 像素差函数 PXDIFF：4 份（1 份返回对象、3 份返回标量）；
 *   · snapVis / restoreVis：各 2 份逐字节相同；setLayer / onlyLayer：各 2 份同形；
 *   · shotUrl：3 份逐字相同。
 * 取链与启动参数是"改一处要改 15 处"的东西：漏一处，探针会在不一致的浏览器配置下给出
 * 与别处不可比的读数（同一形态的先例就是上面那次漏项）。
 *
 * 为什么落 tools/diag/lib/：只服务 diag 探针，不进生产/构建/部署面；tools/lib/ 是地理与
 * 桥梁底座的落点，用途不同，不混在一处。
 *
 * 为什么是 .cjs：15 个站点都是 CommonJS 顶层 IIFE（无 module.exports、无人 import），
 * require 接入不牵动任何下游；仓库根 package.json 无 "type" 字段，.cjs 明确按 CJS 解析。
 *
 * 已知边界（如实写）：page.evaluate(fn) 会把函数序列化到浏览器执行，函数体必须自包含 ⇒
 * 本文件里的页面侧函数**不得引用模块作用域的其它标识符**（PXDIFF 的通道阈值 12 因此就地
 * 写死，不做常量抽取）；各探针业务 evaluate 内部的 renderer 取链仍是各写一次，不属本笔
 * 收口面（它们是各站不同的一次性读法，不是逐字副本）。
 */
'use strict'
const path = require('path')

/* playwright-core 取链：全局优先（GROOT 由 npm root -g 现场解析，PW_GROOT 可覆盖）；
 * 全局缺失时回落仓库 node_modules——CI 不装全局包（run 287/288 报 Cannot find module 的红样），
 * 而 @playwright/test 的传递依赖 playwright-core 就在仓库里，同版本。
 * 本机全局在位 ⇒ 首槽命中，行为与收口前逐位一致。 */
const GROOT =
  process.env.PW_GROOT || require('child_process').execSync('npm root -g').toString().trim()
const chromium = (() => {
  try {
    return require(path.join(GROOT, 'playwright-core')).chromium
  } catch {
    return require('playwright-core').chromium
  }
})()

/* 仓库根：本文件在 tools/diag/lib/ ⇒ 上溯三级 */
const ROOT = path.resolve(__dirname, '..', '..', '..')

/* Edge + swiftshader：无 GPU 环境靠 swiftshader 出图；--ignore-certificate-errors 走本机 https。 */
const LAUNCH_ARGS = [
  '--use-angle=default',
  '--enable-webgl',
  '--ignore-certificate-errors',
  '--enable-unsafe-swiftshader',
]

/** 起浏览器并开一页：等价于原先各站的 launch + newContext({viewport, deviceScaleFactor}) + newPage() */
const launchPage = async ({ viewport, deviceScaleFactor, ...overrides } = {}) => {
  const browser = await chromium.launch({
    channel: 'msedge',
    headless: true,
    args: LAUNCH_ARGS,
    ...overrides,
  })
  const page = await browser.newPage({
    viewport,
    ...(deviceScaleFactor === undefined ? {} : { deviceScaleFactor }),
  })
  return { browser, page }
}

/** 截图为 data URL：页面侧要拿它算像素差，故不落盘 */
const shotUrl = async (page) =>
  'data:image/png;base64,' + (await page.screenshot()).toString('base64')

/* ---------- 以下为页面侧函数（作 page.evaluate 的 fn 参数；须自包含） ---------- */

/** 只把 id 这一层打开、其余关闭（id=null 时全关）——A/B 的基线相位 */
const ONLY_LAYER = (id) => {
  const r = document
    .querySelector('#app')
    .__vue_app__.config.globalProperties.$pinia._s.get('map').currentRenderer
  for (const [lid, rec] of r._layers) {
    const inst = rec && rec.instance
    if (!inst) continue
    const on = id != null && lid === id
    inst.show = on
    // 默认关闭的图层：应用侧会把 show 再压回 false，故同时把 rec.visible 置位
    if (on && rec) rec.visible = true
  }
  r.viewer.scene.requestRender()
}

/** 按 id 开关单层（_layers.get 取链；与 ONLY_LAYER 的遍历取链是两种用途，不合并） */
const SET_LAYER = ([lid, v]) => {
  const r = document
    .querySelector('#app')
    .__vue_app__.config.globalProperties.$pinia._s.get('map').currentRenderer
  const rec = r._layers.get(lid)
  const inst = rec && rec.instance
  if (!inst) return false
  inst.show = v
  if (v && rec) rec.visible = true
  r.viewer.scene.requestRender()
  return true
}

/** 快照全部图层的 show/visible —— A/B 相位改过可见性后必须还原，否则污染下一个目标 */
const SNAP_VIS = () => {
  const r = document
    .querySelector('#app')
    .__vue_app__.config.globalProperties.$pinia._s.get('map').currentRenderer
  const out = []
  for (const [lid, rec] of r._layers) {
    const inst = rec && rec.instance
    if (!inst) continue
    out.push([lid, !!inst.show, rec ? !!rec.visible : null])
  }
  return out
}

/** 还原 SNAP_VIS 的快照 */
const RESTORE_VIS = (rows) => {
  const r = document
    .querySelector('#app')
    .__vue_app__.config.globalProperties.$pinia._s.get('map').currentRenderer
  for (const [lid, show, visible] of rows) {
    const rec = r._layers.get(lid)
    const inst = rec && rec.instance
    if (!inst) continue
    inst.show = show
    if (rec && visible != null) rec.visible = visible
  }
  r.viewer.scene.requestRender()
}

/**
 * 两张 data URL 的逐通道像素差，返回 { n, w, h }。阈值 12 就地写死：
 * 页面函数被序列化后在浏览器里执行，看不到模块作用域的常量。
 */
const PXDIFF = ([a, b]) =>
  new Promise((res) => {
    const A = new Image()
    const B = new Image()
    let got = 0
    const go = () => {
      if (++got < 2) return
      const c = document.createElement('canvas')
      c.width = A.width
      c.height = A.height
      const g = c.getContext('2d', { willReadFrequently: true })
      g.drawImage(A, 0, 0)
      const da = g.getImageData(0, 0, c.width, c.height).data
      g.clearRect(0, 0, c.width, c.height)
      g.drawImage(B, 0, 0)
      const db = g.getImageData(0, 0, c.width, c.height).data
      let n = 0
      for (let i = 0; i < da.length; i += 4) {
        if (
          Math.abs(da[i] - db[i]) > 12 ||
          Math.abs(da[i + 1] - db[i + 1]) > 12 ||
          Math.abs(da[i + 2] - db[i + 2]) > 12
        )
          n++
      }
      res({ n, w: c.width, h: c.height })
    }
    A.onload = go
    B.onload = go
    A.src = a
    B.src = b
  })

/** 宿主侧薄封装：把页面函数绑到某个 page 上，站点调用点少写一次 page.evaluate */
const onlyLayer = (page, id) => page.evaluate(ONLY_LAYER, id)
const setLayer = (page, id, on) => page.evaluate(SET_LAYER, [id, on])
const snapVis = (page) => page.evaluate(SNAP_VIS)
const restoreVis = (page, snap) => page.evaluate(RESTORE_VIS, snap)

module.exports = {
  ROOT,
  launchPage,
  shotUrl,
  onlyLayer,
  setLayer,
  snapVis,
  restoreVis,
  PXDIFF,
}
