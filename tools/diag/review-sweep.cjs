/* review-sweep.cjs — 一次页面加载，扫一排机位出图（用于定位"浮空物"到底在哪个视角出现）。
 * 用法: node tools/diag/review-sweep.cjs --name sweep --cams "port3k:108.6473,21.6745,3000,0,-20;..."
 */
'use strict'
const fs = require('fs'),
  path = require('path')
const GROOT = require('child_process').execSync('npm root -g').toString().trim()
const { chromium } = require(path.join(GROOT, 'playwright-core'))
const ROOT = path.resolve(__dirname, '..', '..')
const arg = (n, d) => {
  const i = process.argv.indexOf('--' + n)
  return i > -1 ? process.argv[i + 1] : d
}
const OUTDIR = path.join(ROOT, '.local', '3d-review')
fs.mkdirSync(OUTDIR, { recursive: true })
const NAME = arg('name', 'sweep')
const DEFAULT = [
  'port3k:108.6473,21.6745,3000,0,-20',
  'port8k:108.6473,21.6745,8000,0,-30',
  'port20k:108.6473,21.6745,20000,0,-45',
  'portlow:108.6473,21.6300,800,0,-4',
  'portsea:108.6600,21.6100,600,330,-3',
  'madao:108.8340,22.2546,3000,0,-20',
  'canal_22.2:108.9000,22.2000,8000,0,-30',
  'canal_n22.45:108.9370,22.4492,20000,0,-30',
  'bridges:108.6350,21.9689,3000,0,-20',
  'qinzhou_city:108.6300,21.9500,6000,0,-30',
  'gulf:108.6000,21.5000,150000,0,-70',
  'region:108.7000,22.0000,50000,0,-60',
].join(';')
const CAMS = arg('cams', DEFAULT).split(';').filter(Boolean)
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
    await browser.newContext({ viewport: { width: 1100, height: 800 }, deviceScaleFactor: 1 })
  ).newPage()
  await page.goto(arg('url', 'http://localhost:5174/route-analysis'), {
    waitUntil: 'domcontentloaded',
    timeout: 60000,
  })
  await page.waitForTimeout(28000)
  const shots = []
  for (const c of CAMS) {
    const [nm, nums] = c.split(':')
    const a = nums.split(',').map(Number)
    await page.evaluate((p) => {
      const C = window.Cesium
      const v = document
        .querySelector('#app')
        .__vue_app__.config.globalProperties.$pinia._s.get('map').currentRenderer.viewer
      v.camera.flyTo({
        destination: C.Cartesian3.fromDegrees(p[0], p[1], p[2]),
        orientation: {
          heading: ((p[3] || 0) * Math.PI) / 180,
          pitch: ((p[4] || -45) * Math.PI) / 180,
          roll: 0,
        },
        duration: 0,
      })
    }, a)
    await page.waitForTimeout(7000)
    const p = path.join(OUTDIR, NAME + '--' + nm + '.png')
    await page.screenshot({ path: p })
    shots.push({ name: nm, cam: a, shot: p })
    console.log('shot ' + nm)
  }
  fs.writeFileSync(path.join(OUTDIR, NAME + '.json'), JSON.stringify(shots, null, 2))
  await browser.close()
})().catch((e) => {
  console.error('SWEEP-FAIL', e && e.message)
  process.exit(1)
})
