#!/usr/bin/env node
/**
 * probe-port-close-ab.cjs — 港区「用户视角」近距离像素 A/B（只读）。
 *
 * 为什么：coverage-3dtiles.cjs 的机位由图层包围球推出（港区 h≈18 km），只能证
 * 「有像素」；用户投诉发生在 400~900 m 的近机位（路不平/有间隙、枢纽主体没有）。
 * 本探针在港区核心 (108.6473, 21.6745) 取两个近机位，逐层隐藏/单开做像素差，
 * 量「交付包 / 道路 / 城区桥」各自的画面贡献。
 *
 * 2026-10-05 实测（HEAD c429eb33，dev server 5174）：
 *   420 m 俯视：交付 px=6419（selected=3 / tris=183842）｜道路 px=1035（1 / 1508）
 *   900 m 斜视：交付 px=224816（6 / 454393）｜道路 px=17358（1 / 1508）
 *   ⇒ 用户「LOD 主体没有 / 道路整层没有」在近机位未复现；B4 的覆盖区埋没
 *   （作业区窗口内 100% 顶点 Δ<−0.05、中位 −1.63 m）仍有效——可见像素来自
 *   未被交付面覆盖的路段。
 *
 * 前提：全局 playwright-core + msedge（同 coverage-3dtiles.cjs）；应用 dev server 已起。
 * 用法：node tools/diag/probe-port-close-ab.cjs [--url http://127.0.0.1:5174/route-analysis]
 * 产物：.local/coverage/port-port-core-*.png（全层可见截图，供人眼复核）
 */
'use strict'
const fs = require('fs')
const path = require('path')
const GROOT = require('child_process').execSync('npm root -g').toString().trim()
const { chromium } = require(path.join(GROOT, 'playwright-core'))

const ROOT = path.resolve(__dirname, '..', '..')
const OUT = path.join(ROOT, '.local', 'coverage')
fs.mkdirSync(OUT, { recursive: true })
const arg = (k, d) => {
  const i = process.argv.indexOf(k)
  return i > -1 && process.argv[i + 1] ? process.argv[i + 1] : d
}
const URL_ = arg('--url', 'http://127.0.0.1:5174/route-analysis')
const CAMS = [
  { name: 'port-core-420-down', lng: 108.6473, lat: 21.6745, h: 420, pitch: -90 },
  { name: 'port-core-900-oblique', lng: 108.6473, lat: 21.6745, h: 900, pitch: -55 },
]

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
    await browser.newContext({ viewport: { width: 900, height: 620 }, deviceScaleFactor: 1 })
  ).newPage()
  await page.goto(URL_, { waitUntil: 'domcontentloaded', timeout: 60000 })
  await page.waitForTimeout(24000)

  const onlyLayer = (layerId) =>
    page.evaluate((id) => {
      const r = document
        .querySelector('#app')
        .__vue_app__.config.globalProperties.$pinia._s.get('map').currentRenderer
      for (const [lid, rec] of r._layers) {
        const inst = rec && rec.instance
        if (!inst) continue
        const on = id != null && lid === id
        inst.show = on
        if (on && rec) rec.visible = true
      }
      r.viewer.scene.requestRender()
    }, layerId)
  const snapVis = () =>
    page.evaluate(() => {
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
    })
  const restoreVis = (snap) =>
    page.evaluate((rows) => {
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
    }, snap)
  const shotUrl = async () =>
    'data:image/png;base64,' + (await page.screenshot()).toString('base64')
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

  const layerIds = await page.evaluate(() => {
    const r = document
      .querySelector('#app')
      .__vue_app__.config.globalProperties.$pinia._s.get('map').currentRenderer
    return [...r._layers.keys()].filter((id) => /qinzhou|qz-/.test(id))
  })
  console.log('港区相关图层: ' + layerIds.join(', '))

  for (const cam of CAMS) {
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
    }, cam)
    await page.waitForTimeout(8000)
    const fullShot = path.join(OUT, `port-${cam.name}.png`)
    await page.screenshot({ path: fullShot })
    console.log(`--- ${cam.name}（全层可见截图 ${path.basename(fullShot)}）---`)
    for (const id of layerIds) {
      const st = await page.evaluate((lid) => {
        const r = document
          .querySelector('#app')
          .__vue_app__.config.globalProperties.$pinia._s.get('map').currentRenderer
        const rec = r._layers.get(lid)
        const inst = rec && rec.instance
        return inst && inst.statistics
          ? { sel: inst.statistics.selected, tri: inst.statistics.numberOfTrianglesSelected }
          : null
      }, id)
      const snap = await snapVis()
      await onlyLayer(null)
      await page.waitForTimeout(2500)
      const base = await shotUrl()
      await onlyLayer(id)
      await page.waitForTimeout(3500)
      const on = await shotUrl()
      const px = await page.evaluate(PXDIFF, [base, on])
      await restoreVis(snap)
      await page.waitForTimeout(800)
      console.log(
        `${id.padEnd(24)} selected=${st ? st.sel : '-'} tris=${st ? st.tri : '-'} px=${px}`
      )
    }
  }
  await browser.close()
})().catch((e) => {
  console.error('FAIL', e && e.message)
  process.exit(1)
})
