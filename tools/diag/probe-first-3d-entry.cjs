/**
 * probe-first-3d-entry.cjs — 首进 3D 路由的「空白窗口」回归探针（只读，不改仓库）。
 *
 * ## 测什么
 *
 * 用户场景：刚进站点、初始地图还没加载完时点击 3D 导航项（如「浸没分析」）。
 * 症状：路由很快切过去了，但地图区一片空白且没有任何反馈，直到 Cesium 引擎就绪
 * 才出现 3D 场景（限速真机 10~16s）。
 *
 * 探针用 CDP 限速复刻真机（默认 400KB/s，Cesium.js 5.97MB ≈ 10~15s），记录：
 *   - 路由 path 何时切换；
 *   - 地图区遮罩文案（`.map-loading`）何时显示/消失；
 *   - Cesium 何时真正就绪（window.Cesium / .cesium-widget）；
 *   - 三者之间的“空白窗口”长度。
 *
 * ## 判据（2026-10-05 实测口径）
 *
 * - 修前（初始渲染器未建时用 store 值判“同类型”而跳过切换）：
 *   0.35s 路由已切、0.62s 遮罩消失，Cesium 5.5s 才就绪 ⇒ 4.9s 空白无反馈。
 * - 修后：遮罩从点击一直显示「正在加载 3D 场景…」到 Cesium 就绪（同场景实测 10.7s），
 *   再到渲染器初始化完成才消失；空白窗口 = 0。
 *
 * ## 用法
 *
 * 前置：生产构建产物 + 静态服务（限速下必须用 build；dev 的数百个模块请求不可比）：
 *   cd frontend && npm run build && npx vite preview --host 127.0.0.1 --port 4174 --strictPort
 * 运行：
 *   node tools/diag/probe-first-3d-entry.cjs [baseUrl] [kBps] [waitMs]
 *   waitMs>0 = 先等 idle 再点首下（对照组）
 * 截图与 result.json 落 `.local/first-3d-entry/`（gitignored）。
 * 依赖：全局 npm 的 playwright-core + 本机 Edge（与 tools/diag 其它探针同款）。
 */
'use strict'
const fs = require('fs')
const path = require('path')
const { execSync } = require('child_process')

const GROOT = execSync('npm root -g').toString().trim()
const { chromium } = require(path.join(GROOT, 'playwright-core'))
const ROOT = path.resolve(__dirname, '..', '..')

const BASE = process.argv[2] || 'http://127.0.0.1:4174'
const KBPS = Number(process.argv[3] || 400)
const WAIT_MS = Number(process.argv[4] || 0)
const OUT = path.join(ROOT, '.local', 'first-3d-entry')
fs.mkdirSync(OUT, { recursive: true })

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const LOG = '[first-3d]'

async function sample(page) {
  return page.evaluate(() => {
    const q = (s) => document.querySelector(s)
    const loading = q('.map-loading')
    return {
      path: location.pathname,
      loadingText: loading && loading.offsetParent !== null ? loading.textContent.trim() : '',
      mapError: (q('.map-error')?.textContent || '').trim(),
      cesiumWidget: !!q('.cesium-widget'),
      hasCesiumGlobal: !!window.Cesium,
      contentText: (q('.app-content')?.textContent || '').slice(0, 60),
    }
  })
}

async function clickNav(page, label) {
  // 精确落在导航按钮本体（.nav-button-wrap 内的 GCSButton），不是文字节点
  const wrap = page.locator('.nav-button-wrap', { hasText: label }).first()
  await wrap.waitFor({ state: 'visible', timeout: 20000 })
  await wrap.locator('button').first().click()
}

async function scenario(page, label, seconds, tag) {
  const events = []
  let last = ''
  const t0 = Date.now()
  events.push({ t: 0, ev: `click ${label}`, ...(await sample(page)) })
  await clickNav(page, label)
  const shots = new Set([2000, 8000, 15000, seconds * 1000 - 500])
  while (Date.now() - t0 < seconds * 1000) {
    const s = await sample(page)
    const key = JSON.stringify(s)
    if (key !== last) {
      events.push({ t: Date.now() - t0, ev: 'state', ...s })
      last = key
    }
    const dt = Date.now() - t0
    for (const sh of [...shots]) {
      if (dt >= sh) {
        await page.screenshot({ path: path.join(OUT, `${tag}-${sh}.png`) })
        shots.delete(sh)
      }
    }
    await sleep(250)
  }
  return events
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
  const context = await browser.newContext({ viewport: { width: 1280, height: 860 } })
  const page = await context.newPage()
  const cdp = await context.newCDPSession(page)
  await cdp.send('Network.enable')
  await cdp.send('Network.emulateNetworkConditions', {
    offline: false,
    latency: 40,
    downloadThroughput: Math.round(KBPS * 1024),
    uploadThroughput: Math.round(KBPS * 1024),
  })

  const net = []
  page.on('response', (r) => {
    const u = r.url()
    if (/Cesium\.js|Page-[A-Za-z0-9_-]+\.js|\.glb|tileset/.test(u)) {
      net.push({ url: u.replace(BASE, ''), status: r.status() })
    }
  })
  const fails = []
  page.on('requestfailed', (r) =>
    fails.push({ url: r.url().replace(BASE, ''), err: r.failure()?.errorText })
  )
  const errors = []
  page.on('pageerror', (e) => errors.push(String(e).slice(0, 200)))
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text().slice(0, 200))
  })

  const t0 = Date.now()
  await page.goto(BASE + '/', { waitUntil: 'domcontentloaded', timeout: 60000 })
  await page
    .locator('.nav-button-wrap', { hasText: '浸没分析' })
    .first()
    .waitFor({ state: 'visible', timeout: 60000 })
  const ready = Date.now() - t0
  console.log(`${LOG} 首帧可见 ${ready}ms（限速 ${KBPS}KB/s，waitMs=${WAIT_MS}）`)
  if (WAIT_MS > 0) await sleep(WAIT_MS)

  const a = await scenario(page, '浸没分析', 40, 'A-flood-first')
  console.log(`${LOG} A 场景（首点浸没）事件流：`)
  for (const e of a) console.log('   ', JSON.stringify(e).slice(0, 220))

  const b = await scenario(page, '航线分析', 20, 'B-route')
  console.log(`${LOG} B 场景（点航线）最终：`, JSON.stringify(b[b.length - 1]).slice(0, 220))
  const c = await scenario(page, '浸没分析', 20, 'C-flood-again')
  console.log(`${LOG} C 场景（再点浸没）最终：`, JSON.stringify(c[c.length - 1]).slice(0, 220))

  console.log(`${LOG} 网络关键资源：`)
  for (const n of net.slice(-14)) console.log('   ', n.status, n.url)
  if (fails.length) console.log(`${LOG} 请求失败：`, JSON.stringify(fails.slice(-8)))
  if (errors.length) console.log(`${LOG} 错误：`, JSON.stringify(errors.slice(-10)))
  fs.writeFileSync(
    path.join(OUT, 'result.json'),
    JSON.stringify({ ready, a, b, c, net, fails, errors }, null, 2)
  )
  await browser.close()
})().catch((e) => {
  console.error(`${LOG} 探针失败：`, e)
  process.exit(1)
})
