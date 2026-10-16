import fs from 'node:fs'

import ts from 'typescript'
import { describe, expect, it } from 'vitest'

import { DEG_M_LAT, DEG_M_LNG, WGS84_A, WGS84_F } from '../geo.mjs'

/**
 * 守 `tools/lib/geo.mjs` 是 tools 侧椭球底座**唯一**来源。
 *
 * 为什么必须有这份判据：把 A / 1/f 抄成第二份**不会报错**——只会让交付包与探针的落位
 * 悄悄错开（改一处不报错 = AGENTS §七-7）。断言的不是"有没有测试"，而是"第二份手抄还在不在"。
 *
 * 判据面 = 全仓 .mjs/.cjs/.js/.ts/.vue（.vue 只取其 <script>），两路：
 *   ① 常量路径：任何 NumericLiteral 命中 6378137 / 298.257223563 / 111320 / 110574 ⇒ 红。
 *   ② 公式路径（只在 tools/ 下判）：站内再抄一遍换算公式（常量换记法也拦得住）——
 *      `Math.sqrt(1 - …)` / `Math.atan2(z, …)` / `Math.atan2(y, x)`。
 *      2026-10-16 实测除 geo.mjs 自身外，这三式在 tools/ 内 0 命中。
 *
 * 失效条件（诚实边界）：
 *   - 判据只认这三种记法。站内把标识符全改名（`Math.atan2(px, py)`）后重抄公式，判据**不红**，
 *     那一层只能靠代码评审。
 *   - 常量路径的比对是相对容差 1e-12，改写为等价小数（如 `6378137.0000001`）仍红，但
 *     隐藏到其它算术里（`const A = 6378136 + 1`）不红。
 *   - Python 侧 12 个站点是另一族，不在本判据面内（P4-PY 单独一笔）。
 *   - 未跟踪目录（dist-* / tmp-* / .local 等）不扫——判据输入必须受版本控制（§5.4）。
 */
const ROOT = new URL('../../../', import.meta.url)
const GEO_REL = 'tools/lib/geo.mjs'
/** 判据自身：里面的 6378137 / 298.257223563 是**钉住权威值的断言**，不是第二份实现，故豁免 */
const GUARD_REL = 'tools/lib/__tests__/geo.test.mjs'
const SKIP = new Set(['node_modules', '.git', '.local', '.venv', '__pycache__', 'coverage', 'dist'])
const SCAN_EXT = /\.(mjs|cjs|js|ts|vue)$/
/** 常量禁表：WGS84 长半轴 / 扁率倒数 + 每度米（三者都只该住在 geo.mjs） */
const BANNED = [WGS84_A, 1 / WGS84_F, DEG_M_LNG, DEG_M_LAT]

/** 相对容差比对（禁表的等价小数形态也要咬住） */
function banned(text) {
  const v = Number(text)
  if (!Number.isFinite(v)) return false
  return BANNED.some((b) => Math.abs(v - b) <= 1e-12 * Math.abs(b))
}

/** .vue 只取其 <script> 段（模板里的数字不是代码） */
function sourceOf(file, text) {
  if (!file.endsWith('.vue')) return text
  return (text.match(/<script[^>]*>([\s\S]*?)<\/script>/g) || [])
    .map((b) => b.replace(/<script[^>]*>|<\/script>/g, ''))
    .join('\n')
}

function kindOf(file) {
  return /\.ts$/.test(file) ? ts.ScriptKind.TS : ts.ScriptKind.JS
}

/** 一个源码里有没有"第二份手抄"——返回命中说明数组（空数组 = 干净） */
function findCopies(source, file, { formulas = true } = {}) {
  const sf = ts.createSourceFile(file, source, ts.ScriptTarget.ES2022, true, kindOf(file))
  const hits = []
  const line = (n) => sf.getLineAndCharacterOfPosition(n.getStart()).line + 1
  const nameOf = (n) => (n && ts.isIdentifier(n) ? n.text : '')

  const visit = (n) => {
    if (ts.isNumericLiteral(n) && banned(n.text))
      hits.push(file + ':' + line(n) + ' 常量 ' + n.text)
    if (formulas && ts.isCallExpression(n) && ts.isPropertyAccessExpression(n.expression)) {
      const obj = nameOf(n.expression.expression)
      const fn = n.expression.name.text
      const a0 = n.arguments[0]
      // 必须是 `1 - …`：仓内 forecast 侧的 `Math.sqrt(1 + Math.floor(n))` 是无关同形，不得误红
      if (
        obj === 'Math' &&
        fn === 'sqrt' &&
        a0 &&
        ts.isBinaryExpression(a0) &&
        a0.operatorToken.kind === ts.SyntaxKind.MinusToken &&
        Number(a0.left.text) === 1
      )
        hits.push(file + ':' + line(n) + ' Math.sqrt(1 - …)')
      if (obj === 'Math' && fn === 'atan2' && a0 && nameOf(a0) === 'z')
        hits.push(file + ':' + line(n) + ' Math.atan2(z, …)')
      if (obj === 'Math' && fn === 'atan2' && nameOf(a0) === 'y' && nameOf(n.arguments[1]) === 'x')
        hits.push(file + ':' + line(n) + ' Math.atan2(y, x)')
    }
    ts.forEachChild(n, visit)
  }
  visit(sf)
  return hits
}

/** 递归扫全仓（唯一豁免 = 权威源自身） */
function scanRepo() {
  const hits = []
  let scanned = 0
  const walk = (url, relDir) => {
    for (const e of fs.readdirSync(url, { withFileTypes: true })) {
      const rel = relDir + e.name
      if (
        SKIP.has(e.name) ||
        e.name.startsWith('tmp-') ||
        e.name.startsWith('dist') ||
        e.name.startsWith('.')
      )
        continue
      if (e.isDirectory()) {
        walk(new URL(e.name + '/', url), rel + '/')
        continue
      }
      if (!SCAN_EXT.test(e.name) || rel === GEO_REL || rel === GUARD_REL) continue
      scanned++
      const src = sourceOf(rel, fs.readFileSync(new URL(e.name, url), 'utf8'))
      hits.push(...findCopies(src, rel, { formulas: rel.startsWith('tools/') }))
    }
  }
  walk(ROOT, '')
  return { hits, scanned }
}

describe('地理底座单源（P4·D24）', () => {
  it('权威源形状：WGS84 参数自洽，每度米为正', () => {
    expect(WGS84_A).toBe(6378137)
    expect(WGS84_F).toBe(1 / 298.257223563)
    // E2 必须由 F 派生，不得是第二个手抄数字
    expect(WGS84_F * (2 - WGS84_F)).toBeCloseTo(0.0066943799901413165, 15)
    expect(DEG_M_LNG).toBeGreaterThan(DEG_M_LAT) // 赤道处 1° 经度 > 1° 纬度
  })

  it('全仓无第二份手抄（阴性 0 命中 + 阳性对照）', () => {
    // 对照值一律从权威源派生，不得手写——否则改权威值会让判据自己误红
    const young = [
      `const A = ${WGS84_A}`, // 常量路径：裸抄
      `const F = 1 / ${(1 / WGS84_F).toPrecision(12)}`, // 常量路径：分数记法
      `const M = ${DEG_M_LNG}.0`, // 常量路径：等价小数
      'const N = Math.sqrt(1 - e2 * Math.sin(la) ** 2)', // 公式路径
      'const lon = Math.atan2(y, x)', // 公式路径
      'const lat = Math.atan2(z, p * (1 - e2))', // 公式路径
    ]
    for (const s of young) expect(findCopies(s, 'synth-positive.mjs'), s).not.toEqual([])

    // 近失样本：同形但不含禁值、公式也不成形 ⇒ 不许红
    const nearMiss = [
      `const A = ${WGS84_A + 1}`,
      `const M = ${DEG_M_LNG + 1}`,
      'const N = Math.sqrt(2 - e2 * Math.sin(la) ** 2)',
      'const lat = Math.atan2(zz, p)', // 仓内原有形态
      'const d = Math.hypot(dx, dy)', // 仓内 4 处合法用法
    ]
    for (const s of nearMiss) expect(findCopies(s, 'synth-negative.mjs'), s).toEqual([])

    const { hits, scanned } = scanRepo()
    expect(scanned, '扫描面为空 ⇒ 根路径写错，先红').toBeGreaterThan(50)
    expect(hits).toEqual([])
  })

  it('10 个站点仍从权威源取（不得只删 import 各自为政）', () => {
    const stations = [
      'tools/3dtiles-build/build-bridges.mjs',
      'tools/3dtiles-build/build-canal.mjs',
      'tools/3dtiles-build/build-ground.mjs',
      'tools/3dtiles-build/build-roads.mjs',
      'tools/3dtiles-build/reanchor-hubs.mjs',
      'tools/3dtiles-build/rebuild-containers.mjs',
      'tools/3dtiles-build/__tests__/reanchor.test.mjs',
      'tools/diag/probe-ground-boundary.mjs',
      'tools/diag/coverage-3dtiles.cjs',
      'tools/diag/lod-ladder.cjs',
    ]
    for (const rel of stations) {
      const text = fs.readFileSync(new URL(rel, ROOT), 'utf8')
      const sf = ts.createSourceFile(rel, text, ts.ScriptTarget.ES2022, true, kindOf(rel))
      let wired = false
      const visit = (n) => {
        if (
          ts.isImportDeclaration(n) &&
          ts.isStringLiteral(n.moduleSpecifier) &&
          n.moduleSpecifier.text.endsWith('lib/geo.mjs')
        )
          wired = true
        if (
          ts.isCallExpression(n) &&
          ts.isIdentifier(n.expression) &&
          n.expression.text === 'require' &&
          ts.isStringLiteral(n.arguments[0]) &&
          n.arguments[0].text.endsWith('lib/geo.mjs')
        )
          wired = true
        ts.forEachChild(n, visit)
      }
      visit(sf)
      expect(wired, rel + ' 未从 ' + GEO_REL + ' 取地理底座').toBe(true)
    }
  })
})
