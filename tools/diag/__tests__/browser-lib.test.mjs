/* browser-lib.test.mjs — tools/diag/lib/browser.cjs 的判据（CMC01 P6 / C11）。
 *
 * 判据分三层：
 *   ① 形状：公共底座导出的就是各站点需要的那几个口子（launchPage / shotUrl /
 *      onlyLayer / setLayer / snapVis / restoreVis / PXDIFF / ROOT）；
 *   ② 行为：把公共启动块的**实际参数**与像素差函数的**实际算法**跑出来看——
 *      launch 参数用假的 playwright-core 注入 require.cache 后取实参；
 *      PXDIFF 放进 node:vm + 假 DOM 里真跑（阈值 12 的**严格大于**与返回形状 {n,w,h}
 *      正是四个旧副本里逐字相同的那两处，改一处就该红）；
 *   ③ 全称约束（扫描派生，不硬编码站点清单）：tools/** 下除公共底座外不得再有第二份
 *      手抄——npm root -g 取链、playwright-core 解析、--use-angle 启动参数族、
 *      五个辅助函数定义；每个浏览器探针（出现 page.goto( 的 .cjs）必须接线到公共底座。
 *
 * 近失对照（有意不判，避免误伤）：lod-bytes-join.cjs 与 probe-flood-earcut.cjs 也各自
 * 写 path.resolve(__dirname, '..', '..')——它们不驱动浏览器，ROOT 是它们自己的两行
 * 常量；把它们也拉进公共底座只会让不装全局 playwright 的环境无法运行，故不判。
 */
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import vm from 'node:vm'

import { describe, expect, it } from 'vitest'

const require = createRequire(import.meta.url)
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..')
const LIB_REL = 'tools/diag/lib/browser.cjs'
const LIB = path.join(ROOT, LIB_REL)

/** 公共底座的取链：全局 playwright-core；测试用假实现注入同一缓存槽位。
 *  显式调 cmd（Windows）/ sh，不经 PATH 解析——本判据在任何宿主下都要能取到。 */
const GROOT = execFileSync(
  process.platform === 'win32' ? 'cmd' : 'sh',
  process.platform === 'win32' ? ['/c', 'npm root -g'] : ['-c', 'npm root -g'],
  { encoding: 'utf8' }
).trim()

function loadLibWith(fakeChromium) {
  const pwEntry = require.resolve(path.join(GROOT, 'playwright-core'))
  delete require.cache[LIB]
  require.cache[pwEntry] = {
    id: pwEntry,
    filename: pwEntry,
    loaded: true,
    exports: { chromium: fakeChromium },
    children: [],
    paths: [],
  }
  return require(LIB)
}

describe('tools/diag/lib/browser.cjs 形状', () => {
  it('导出各站点消费的口子；ROOT 指向仓库根', () => {
    const lib = loadLibWith({ launch: async () => ({ newPage: async () => ({}) }) })
    for (const k of [
      'launchPage',
      'shotUrl',
      'onlyLayer',
      'setLayer',
      'snapVis',
      'restoreVis',
      'PXDIFF',
    ])
      expect(typeof lib[k], k).toBe('function')
    expect(lib.ROOT.replace(/\\/g, '/')).toBe(ROOT.replace(/\\/g, '/'))
  })
})

describe('launchPage 行为（参数取自实参，不看源码文本）', () => {
  const makeFake = () => {
    const calls = { launch: [], newPage: [] }
    return {
      calls,
      chromium: {
        launch: async (opts) => {
          calls.launch.push(opts)
          return {
            newPage: async (o) => {
              calls.newPage.push(o)
              return { tag: 'page' }
            },
          }
        },
      },
    }
  }

  it('默认：msedge + headless + 四项启动参数（与旧副本逐字相同的基线）', async () => {
    const fake = makeFake()
    const { launchPage } = loadLibWith(fake.chromium)
    const { browser, page } = await launchPage({ viewport: { width: 900, height: 620 } })
    expect(fake.calls.launch[0]).toEqual({
      channel: 'msedge',
      headless: true,
      args: [
        '--use-angle=default',
        '--enable-webgl',
        '--ignore-certificate-errors',
        '--enable-unsafe-swiftshader',
      ],
    })
    expect(await page).toEqual({ tag: 'page' })
    expect(typeof browser.newPage).toBe('function')
  })

  it('透传 viewport；deviceScaleFactor 未给就不写（旧站点两版写法都覆盖）', async () => {
    const fake = makeFake()
    const { launchPage } = loadLibWith(fake.chromium)
    await launchPage({ viewport: { width: 1280, height: 860 } })
    expect(fake.calls.newPage[0]).toEqual({ viewport: { width: 1280, height: 860 } })
    await launchPage({ viewport: { width: 900, height: 620 }, deviceScaleFactor: 1 })
    expect(fake.calls.newPage[1]).toEqual({
      viewport: { width: 900, height: 620 },
      deviceScaleFactor: 1,
    })
  })

  it('显式 args 覆盖公共参数（probe-app-selfprovide 只查注入链、不渲 3D）', async () => {
    const fake = makeFake()
    const { launchPage } = loadLibWith(fake.chromium)
    await launchPage({
      viewport: { width: 1280, height: 860 },
      args: ['--ignore-certificate-errors', '--enable-unsafe-swiftshader'],
    })
    expect(fake.calls.launch[0].args).toEqual([
      '--ignore-certificate-errors',
      '--enable-unsafe-swiftshader',
    ])
  })
})

describe('页面侧函数行为', () => {
  it('PXDIFF：严格大于 12 的通道才算差异，返回 { n, w, h }', async () => {
    const { PXDIFF } = loadLibWith({ launch: async () => ({}) })
    // 假 canvas：按 src 取到预置像素，drawImage 记录当前图，getImageData 吐 RGBA
    const PIXELS = {
      a: [0, 0, 0, 255, 200, 100, 50, 255],
      same: [0, 0, 0, 255, 200, 100, 50, 255],
      over: [0, 0, 0, 255, 213, 100, 50, 255], // 蓝项差 13 > 12
      edge: [0, 0, 0, 255, 212, 100, 50, 255], // 差 12，不算
    }
    class FakeImage {
      constructor() {
        this.width = 2
        this.height = 1
        this._src = null
      }
      set src(v) {
        this._src = v
        setTimeout(() => this.onload && this.onload(), 0)
      }
      get src() {
        return this._src
      }
    }
    const ctxState = { drawn: null }
    const document = {
      createElement: () => ({
        width: 0,
        height: 0,
        getContext: () => ({
          drawImage: (_img, ..._rest) => {
            ctxState.drawn = _img.src
          },
          getImageData: () => ({ data: PIXELS[ctxState.drawn] }),
          clearRect: () => {},
        }),
      }),
    }
    const sandbox = { Image: FakeImage, document, Promise, setTimeout }
    const fn = vm.runInNewContext('(' + PXDIFF.toString() + ')', sandbox)
    expect(await fn(['a', 'same'])).toEqual({ n: 0, w: 2, h: 1 })
    expect(await fn(['a', 'over'])).toEqual({ n: 1, w: 2, h: 1 })
    expect(await fn(['a', 'edge'])).toEqual({ n: 0, w: 2, h: 1 })
  })

  it('宿主侧封装把参数原样交给 page.evaluate；shotUrl 带 data URL 前缀', async () => {
    const lib = loadLibWith({ launch: async () => ({}) })
    const seen = []
    const page = {
      evaluate: async (fn, arg) => {
        seen.push(arg)
        return { arg }
      },
      screenshot: async () => Buffer.from('png'),
    }
    await lib.onlyLayer(page, 'beibu-qz-roads')
    expect(seen[0]).toBe('beibu-qz-roads')
    await lib.setLayer(page, 'beibu-qz-roads', true)
    expect(seen[1]).toEqual(['beibu-qz-roads', true])
    await lib.snapVis(page)
    expect(seen[2]).toBeUndefined()
    const snap = [['beibu-qz-roads', true, true]]
    await lib.restoreVis(page, snap)
    expect(seen[3]).toBe(snap)
    expect(await lib.shotUrl(page)).toMatch(/^data:image\/png;base64,/)
  })
})

describe('全称约束：tools/** 不得再有第二份手抄（扫描派生）', () => {
  const SKIP_DIRS = new Set(['node_modules', '.local', '.git'])
  const listSources = (dir) => {
    const out = []
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      if (SKIP_DIRS.has(e.name)) continue
      const p = path.join(dir, e.name)
      if (e.isDirectory()) out.push(...listSources(p))
      // 排除测试件自身：上面那组判据字面量必须写在测试里（否则无从判「别处有没有」），
      // 这与判据只认 definitions 一个道理——测试文件不是生产站点。
      else if (/\.(cjs|mjs|js)$/.test(e.name) && !/\.test\.(mjs|js|cjs)$/.test(e.name)) out.push(p)
    }
    return out
  }

  /** 逐字副本判据：这些字面在 tools/ 下只允许出现在公共底座里。
   *  写法留白（空白 / 单双引号 / 定义式 const|let|var|function）都要咬住——
   *  「同义改写违约」不能因为换个记法就溜过去（AGENTS §5.3 第 4 式）。 */
  const DEF = (name, why) => ({
    pat: new RegExp('\\b(?:const|let|var|function)\\s+' + name + '\\b\\s*[(=]'),
    why,
  })
  const HAND_COPIES = [
    { pat: /npm root -g/, why: '全局 node_modules 取链' },
    {
      pat: /require\(\s*path\.join\(\s*GROOT\s*,\s*['"]playwright-core['"]\s*\)\s*\)/,
      why: 'playwright-core 解析',
    },
    { pat: /['"]--use-angle=default['"]/, why: 'Edge 启动参数族' },
    DEF('PXDIFF', '像素差函数定义'),
    DEF('shotUrl', '截图函数定义'),
    DEF('snapVis', '可见性快照定义'),
    DEF('restoreVis', '可见性还原定义'),
    DEF('setLayer', '单层开关定义'),
    DEF('onlyLayer', '单层隔离定义'),
  ]

  it('扫描面非空，且判据在公共底座上确实命中（阳性对照）', () => {
    const files = listSources(path.join(ROOT, 'tools'))
    expect(files.length).toBeGreaterThan(100)
    const owner = fs.readFileSync(LIB, 'utf8')
    const ownerHits = HAND_COPIES.filter((h) => h.pat.test(owner))
    expect(ownerHits.length).toBeGreaterThanOrEqual(6)
    expect(ownerHits.map((h) => h.why)).toContain('全局 node_modules 取链')
  })

  it('除公共底座外零命中', () => {
    const offenders = []
    for (const f of listSources(path.join(ROOT, 'tools'))) {
      if (path.relative(ROOT, f).replace(/\\/g, '/') === LIB_REL) continue
      const text = fs.readFileSync(f, 'utf8')
      for (const h of HAND_COPIES)
        if (h.pat.test(text)) offenders.push(path.relative(ROOT, f) + ' → ' + h.why)
    }
    expect(offenders).toEqual([])
  })

  it('每个浏览器探针都接线到公共底座', () => {
    const dir = path.join(ROOT, 'tools/diag')
    const probes = fs
      .readdirSync(dir)
      .filter((f) => f.endsWith('.cjs'))
      .filter((f) => fs.readFileSync(path.join(dir, f), 'utf8').includes('page.goto('))
    // 阳性对照：有 15 个探针；空集合会让下面这条断言恒真
    expect(probes.length).toBeGreaterThanOrEqual(15)
    const unlinked = probes.filter(
      (f) => !fs.readFileSync(path.join(dir, f), 'utf8').includes("require('./lib/browser.cjs')")
    )
    expect(unlinked).toEqual([])
  })
})
