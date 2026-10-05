#!/usr/bin/env node
/**
 * preview-ground-fade.cjs — B10 裁定③「边缘 alpha 渐变」的实施前后 A/B（只读，.local 试验产物）。
 *
 * 做法：route 拦截 rebuilt/ground/ground.glb——MODE='before' 换回旧无渐变件
 * （.local/ground-fade-ab/ground-before.glb，重烘前备份），MODE='after' 放行盘上新件
 * （VEC4 alpha + alphaMode:BLEND）。三类判据：
 *   C1 缝机位 before/after 像素差 > 0（渐变带可见，色差硬缝被淡化）；
 *   C2 港芯垂直下视（远离四缘）before/after 差 ≈ 0（内部不透明区不受影响）；
 *   C3 半透明 pass 回归：BLEND 地面之上道路层仍可见（路像素 > 阈值——
 *      若 Cesium 把 BLEND 地面画到路上面/路被深度测试吃掉，此项塌到 0）。
 * 用法：node tools/diag/preview-ground-fade.cjs（dev server 5174 必须在跑）
 */
'use strict'
const fs = require('fs')
const path = require('path')
// PW_GROOT 环境变量可覆盖全局 node_modules（spawn cmd.exe 被拦/锁的环境下用）；
// 未设时保持原路径：npm root -g 现场解析。
const GROOT =
  process.env.PW_GROOT || require('child_process').execSync('npm root -g').toString().trim()
const { chromium } = require(path.join(GROOT, 'playwright-core'))

const ROOT = path.resolve(__dirname, '..', '..')
const OUT = path.join(ROOT, '.local', 'ground-fade-ab')
fs.mkdirSync(OUT, { recursive: true })
const BEFORE = path.join(OUT, 'ground-before.glb')
// bbox=[108.63556,21.66509,108.65753,21.68551]：缝机位放在片外一点，视线跨缘入片内
const CAMS = [
  { name: 'west-seam', lng: 108.6326, lat: 21.6753, h: 700, pitch: -45, heading: 90 },
  { name: 'north-seam', lng: 108.6465, lat: 21.6875, h: 700, pitch: -45, heading: 180 },
  { name: 'port-core-down', lng: 108.6473, lat: 21.6745, h: 420, pitch: -90, heading: 0 },
  { name: 'port-core-oblique', lng: 108.6473, lat: 21.6745, h: 900, pitch: -55, heading: 0 },
]
let MODE = 'after'

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
  const ctx = await browser.newContext({
    viewport: { width: 900, height: 620 },
    deviceScaleFactor: 1,
  })
  const page = await ctx.newPage()
  await page.route('**/rebuilt/ground/ground.glb', (route) => {
    if (MODE === 'before') return route.fulfill({ path: BEFORE, contentType: 'model/gltf-binary' })
    return route.continue()
  })

  // qz-ground 是 defaultVisible:false 的备选层：注册只在 BLM registry、未建渲染器实例。
  // 修正（2026-10-05 续跑）：mapStore.setLayerVisible 只翻目录标志、不建实例（链路单向
  // BLM → store）；正确入口 = BLM.setVisible 的 b058 补建路径（adapter.create →
  // renderer.add3DTilesLayer → _layers 记录）。BLM 由 App.vue <script setup> 顶层创建，
  // 从根组件 setupState 直取。建好之后才能用裸 inst.show 做快速 A/B 切换。
  const ensureLayer = (id) =>
    page.evaluate(
      ([lid]) => {
        const app = document.querySelector('#app').__vue_app__
        const ss = app._instance && app._instance.setupState
        const blm = ss && ss.businessLayerManager
        if (!blm || typeof blm.setVisible !== 'function') return false
        blm.setVisible(lid, true)
        return true
      },
      [id]
    )
  const setLayer = (id, on) =>
    page.evaluate(
      ([lid, v]) => {
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
      },
      [id, on]
    )
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
        res(n)
      }
      A.onload = go
      B.onload = go
      A.src = a
      B.src = b
    })

  const shots = {} // shots[mode][cam] = dataURL
  const run = async (mode) => {
    MODE = mode
    await page.goto('http://127.0.0.1:5174/route-analysis', {
      waitUntil: 'domcontentloaded',
      timeout: 60000,
    })
    await page.waitForTimeout(24000)
    const inCatalog = await ensureLayer('beibu-qz-ground')
    if (!inCatalog)
      throw new Error(
        'BLM 不可达（App setupState 无 businessLayerManager），无法走 setVisible 补建'
      )
    await page.waitForTimeout(8000) // 等目录 watcher 建层 + 瓦片加载
    const okRoads = await setLayer('beibu-qz-roads', true)
    const okGround = await setLayer('beibu-qz-ground', true)
    if (!okRoads) throw new Error('roads 层未注册（交付包/服务异常）')
    if (!okGround) throw new Error('ground 层开关失败（ensureLayer 后仍未实例化）')
    shots[mode] = {}
    for (const cam of CAMS) {
      await page.evaluate((p) => {
        const C = window.Cesium
        const v = document
          .querySelector('#app')
          .__vue_app__.config.globalProperties.$pinia._s.get('map').currentRenderer.viewer
        v.camera.flyTo({
          destination: C.Cartesian3.fromDegrees(p.lng, p.lat, p.h),
          orientation: {
            heading: (p.heading * Math.PI) / 180,
            pitch: (p.pitch * Math.PI) / 180,
            roll: 0,
          },
          duration: 0,
        })
      }, cam)
      await page.waitForTimeout(9000)
      // 基线镜头（路+地面全开）
      await page.screenshot({ path: path.join(OUT, `fade-${mode}-${cam.name}.png`) })
      shots[mode][cam.name] =
        'data:image/png;base64,' + (await page.screenshot()).toString('base64')
    }
    // C3：after 模式下「地面开·路开」vs「地面开·路关」⇒ 半透明地面之上的路像素
    const c3cam = CAMS[3]
    await page.evaluate((p) => {
      const C = window.Cesium
      const v = document
        .querySelector('#app')
        .__vue_app__.config.globalProperties.$pinia._s.get('map').currentRenderer.viewer
      v.camera.flyTo({
        destination: C.Cartesian3.fromDegrees(p.lng, p.lat, p.h),
        orientation: { heading: 0, pitch: (p.pitch * Math.PI) / 180, roll: 0 },
        duration: 0,
      })
    }, c3cam)
    await page.waitForTimeout(6000)
    const withRoads = 'data:image/png;base64,' + (await page.screenshot()).toString('base64')
    await setLayer('beibu-qz-roads', false)
    await page.waitForTimeout(2500)
    const noRoads = 'data:image/png;base64,' + (await page.screenshot()).toString('base64')
    await setLayer('beibu-qz-roads', true)
    return await page.evaluate(PXDIFF, [noRoads, withRoads])
  }

  const roadsPxAfter = await run('after')
  const _roadsPxBefore = await run('before')
  await browser.close()

  // C1/C2：缝机位差应显著、港芯下视差应≈0
  const fail = []
  // PXDIFF 依赖浏览器 canvas——把 before/after 的差放到第二次打开的页面里算
  const browser2 = await chromium.launch({ channel: 'msedge', headless: true })
  const page2 = await (
    await browser2.newContext({ viewport: { width: 900, height: 620 } })
  ).newPage()
  await page2.goto('http://127.0.0.1:5174/', { waitUntil: 'domcontentloaded', timeout: 60000 })
  const results = {}
  for (const cam of CAMS) {
    results[cam.name] = await page2.evaluate(PXDIFF, [
      shots.before[cam.name],
      shots.after[cam.name],
    ])
  }
  await browser2.close()

  console.log('before/after 像素差（渐变带可见度）：')
  for (const cam of CAMS) console.log(`  ${cam.name}: ${results[cam.name]} px`)
  console.log(
    `C3 半透明回归：BLEND 地面之上的路像素 = ${roadsPxAfter} px（before 模式对照 ${_roadsPxBefore}）`
  )

  // C1：两个缝机位差都必须可见
  if (results['west-seam'] < 2000 || results['north-seam'] < 2000)
    fail.push('C1 缝机位 before/after 差 <2000px（渐变不可见）')
  // C2：港芯垂直下视（中心、远离四缘）差应远小于缝机位
  if (results['port-core-down'] > Math.min(results['west-seam'], results['north-seam']))
    fail.push('C2 港芯下视差 ≥ 缝机位差（内部不透明区被误改）')
  // C3：路必须仍可见（阈值取 C 预览时代最小观测 4295 的一半以下报警）
  if (roadsPxAfter < 2000) fail.push('C3 BLEND 地面之上路像素 <2000（半透明 pass 吃掉了道路层）')

  if (fail.length) {
    console.log('FAIL ❌ ' + fail.join('；'))
    process.exit(1)
  }
  console.log('PASS ✅ 缝淡入可见、内部不变、道路层不受半透明 pass 影响')
})().catch((e) => {
  console.error('FAIL', e && e.message)
  process.exit(1)
})
