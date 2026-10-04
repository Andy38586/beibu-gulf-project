#!/usr/bin/env node
/**
 * preview-roads-vertfollow.cjs — 「逐顶点跟随」方案的运行时实施前后预览（只读，.local 试验产物）。
 *
 * 做法：route 拦截 rebuilt/roads/roads.glb 与 rebuilt/ground/ground.glb，
 * MODE='c' 时替换为 .local/c-preview/*-c.glb（由 preview-roads-vertfollow.py 生成）；
 * 同机位对比 now/C 两种模式的「道路层像素贡献」并落盘截图 + 差异图。
 * 2026-10-05 实测（HEAD 14d10c97，dev server 5174）：900 m 斜视 roads px 4295→11939、
 * 1500 m 高位 6241→11749；420 m 俯视该机位路网少（93↔73）无信号。
 *
 * 用法：node tools/diag/preview-roads-vertfollow.cjs（先跑同名 .py 生成试验 GLB）
 */
'use strict'
const fs = require('fs')
const path = require('path')
const GROOT = require('child_process').execSync('npm root -g').toString().trim()
const { chromium } = require(path.join(GROOT, 'playwright-core'))

const ROOT = path.resolve(__dirname, '..', '..')
const OUT = path.join(ROOT, '.local', 'c-preview')
fs.mkdirSync(OUT, { recursive: true })
const ROADS_C = path.join(OUT, 'roads-c.glb')
const GROUND_C = path.join(OUT, 'ground-c.glb')
const CAMS = [
  { name: 'port-core-420-down', lng: 108.6473, lat: 21.6745, h: 420, pitch: -90 },
  { name: 'port-core-900-oblique', lng: 108.6473, lat: 21.6745, h: 900, pitch: -55 },
  { name: 'port-core-1500-high', lng: 108.6473, lat: 21.6745, h: 1500, pitch: -70 },
]
let MODE = 'now'

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
  const guard = async (route) => {
    const u = route.request().url()
    if (MODE === 'c' && u.endsWith('/rebuilt/roads/roads.glb'))
      return route.fulfill({ path: ROADS_C, contentType: 'model/gltf-binary' })
    if (MODE === 'c' && u.endsWith('/rebuilt/ground/ground.glb'))
      return route.fulfill({ path: GROUND_C, contentType: 'model/gltf-binary' })
    return route.continue()
  }
  await page.route('**/rebuilt/roads/roads.glb', guard)
  await page.route('**/rebuilt/ground/ground.glb', guard)

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
  const MKDIFF = ([a, b]) =>
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
        const da = g.getImageData(0, 0, c.width, c.height)
        g.clearRect(0, 0, c.width, c.height)
        g.drawImage(B, 0, 0)
        const db = g.getImageData(0, 0, c.width, c.height)
        for (let i = 0; i < da.data.length; i += 4) {
          const d =
            Math.abs(da.data[i] - db.data[i]) > 12 ||
            Math.abs(da.data[i + 1] - db.data[i + 1]) > 12 ||
            Math.abs(da.data[i + 2] - db.data[i + 2]) > 12
          da.data[i] = d ? 255 : 0
          da.data[i + 1] = 0
          da.data[i + 2] = 0
          da.data[i + 3] = d ? 255 : 0
        }
        g.putImageData(da, 0, 0)
        res(c.toDataURL('image/png'))
      }
      A.onload = go
      B.onload = go
      A.src = a
      B.src = b
    })

  const run = async (mode) => {
    MODE = mode
    await page.goto('http://127.0.0.1:5174/route-analysis', {
      waitUntil: 'domcontentloaded',
      timeout: 60000,
    })
    await page.waitForTimeout(24000)
    const layerKeys = await page.evaluate(() => {
      const r = document
        .querySelector('#app')
        .__vue_app__.config.globalProperties.$pinia._s.get('map').currentRenderer
      return [...r._layers.keys()]
    })
    console.log('layers: ' + layerKeys.join(', '))
    const okRoads = await setLayer('beibu-qz-roads', true)
    const okGround = await setLayer('beibu-qz-ground', false)
    if (!okRoads) console.log('WARN roads layer missing')
    if (!okGround)
      console.log(
        'NOTE ground layer not instantiated (defaultVisible=false) — ground scene skipped'
      )
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
      await setLayer('beibu-qz-ground', false)
      await setLayer('beibu-qz-roads', true)
      await page.waitForTimeout(2500)
      const withRoads = await shotUrl()
      await page.screenshot({ path: path.join(OUT, `c-preview-${mode}-${cam.name}.png`) })
      await setLayer('beibu-qz-roads', false)
      await page.waitForTimeout(2500)
      const noRoads = await shotUrl()
      const roadsPx = await page.evaluate(PXDIFF, [noRoads, withRoads])
      const diffPng = await page.evaluate(MKDIFF, [noRoads, withRoads])
      fs.writeFileSync(
        path.join(OUT, `diff-${mode}-${cam.name}.png`),
        Buffer.from(String(diffPng).split(',')[1], 'base64')
      )
      await setLayer('beibu-qz-roads', true)
      await page.waitForTimeout(2000)
      let groundPx = 'n/a'
      if (okGround) {
        await setLayer('beibu-qz-ground', true)
        await page.waitForTimeout(2500)
        const withGround = await shotUrl()
        groundPx = await page.evaluate(PXDIFF, [withRoads, withGround])
        await page.screenshot({
          path: path.join(OUT, `c-preview-${mode}-${cam.name}-groundon.png`),
        })
        await setLayer('beibu-qz-ground', false)
      }
      console.log(
        `[${mode}] ${cam.name}: roads px=${roadsPx} | ground(on top of roads) px=${groundPx}`
      )
    }
  }
  await run('now')
  await run('c')
  await browser.close()
})().catch((e) => {
  console.error('FAIL', e && e.message)
  process.exit(1)
})
