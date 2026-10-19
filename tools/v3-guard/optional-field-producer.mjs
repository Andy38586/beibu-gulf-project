#!/usr/bin/env node
/**
 * optional-field-producer.mjs — 「可选能力字段必须有生产者」守卫（根因 B / W47 的机制修复）。
 *
 * ## 治什么
 *
 * 接口上的可选字段是一个**承诺**：调用方可以传，实现方会读。承诺一旦没人履行，
 * 它就变成一段永远走不到的代码——`LayerOptions.cluster` 就是这样活了 68 天
 * （`7469b594` 一次性加 81 行，全仓 0 处赋值，零测试），最后靠人肉审查才被发现。
 *
 * 事后删一次不够：下一个「预留能力」还会这么长出来。本守卫把这条承诺变成判据——
 * **接口里每个可选字段，要么有生产点，要么在豁免清单里写明为什么可以没有。**
 *
 * ## 口径（三层证据，任一成立即算「有生产者」）
 *
 * L1 类型层：用 TypeScript 编译器问「这个对象字面量的上下文类型是不是该接口」
 *    （最准，但 `.vue` 不在普通 `ts.createProgram` 的解析面里）
 * L2 块层：`options: { … }` / `: X = { … }` / `(…): X { … }` / `as X` / `satisfies X`
 *    起的**配平块**内出现该键名（覆盖 `.vue`，与 L1 互补）
 * L3 读取层：`options.<field>` 形态的读取点（字段被读，证明它不是死字段——
 *    这类字段的生产者可能来自展开、默认值合并或运行时构造，静态看不见）
 *
 * 三层全 0 ⇒ 零生产者 ⇒ 红（除非在 ALLOWED 里登记）。
 *
 * ## 为什么不用「全仓 grep 字段名」
 *
 * 实测过，误面巨大：`visible` 在全仓作为键出现 19 次，但**全部属于 `LayerDescriptor`**
 * （`register()` 的入参形状）而不是 `LayerOptions`——同名不同义。同理 `opacity` 的
 * 12 处几乎都是 CSS。按名字 grep 会把 `visible` 判成「有生产者」而漏掉真债务。
 *
 * ## 豁免清单
 *
 * 每条必须写「为什么可以没有生产者」。空清单是目标，不是常态。
 */
import { execSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import ts from 'typescript'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')

/** 受管接口：声明文件 + 接口名。新增受管接口 = 改判据域（AGENTS §四-10）。 */
export const MANAGED = [
  { file: 'frontend/src/types/renderer.ts', name: 'LayerOptions' },
  { file: 'frontend/src/types/renderer.ts', name: 'FlyToOptions' },
  { file: 'frontend/src/types/renderer.ts', name: 'WaterSurfaceOptions' },
]

/**
 * 豁免清单：字段**确实**允许没有生产点。
 * 每条必须写明理由与「什么情况下该删除本豁免」。
 */
export const ALLOWED = [
  {
    iface: 'FlyToOptions',
    field: 'roll',
    why:
      'Cesium 相机朝向三件套（heading/pitch/roll）中 roll 由 CameraState 侧构造' +
      '（`core/config/map.ts:98` 的 `roll: 0` 与 CesiumRenderer 三处），' +
      '不经 FlyToOptions 传；保留字段是为与 CameraState 形状对齐，避免调用方拼半个朝向。',
  },
]

/** 扫描面：非测试生产代码 */
function listSources() {
  const out = execSync(
    'git ls-files "frontend/src/*.ts" "frontend/src/*.tsx" "frontend/src/*.vue"',
    {
      encoding: 'utf8',
    }
  )
    .trim()
    .split('\n')
    .filter((f) => f && !/\.(test|spec)\./.test(f) && !/__tests__/.test(f) && !/\.d\.ts$/.test(f))
  return out
}

/** 从 `{` 配平到对应 `}` */
function blockOf(text, braceIdx) {
  let depth = 0
  for (let j = braceIdx; j < text.length; j++) {
    if (text[j] === '{') depth++
    else if (text[j] === '}') {
      depth--
      if (depth === 0) return text.slice(braceIdx, j + 1)
    }
  }
  return null
}

/** 该文件里所有「疑似该接口的对象字面量」块 */
export function candidateBlocks(text, iface) {
  const out = []
  const pushFrom = (idx) => {
    const b = blockOf(text, text.indexOf('{', idx))
    if (b) out.push(b)
  }
  for (const m of text.matchAll(new RegExp(`:\\s*${iface}\\s*=\\s*\\{`, 'g'))) pushFrom(m.index)
  // 函数返回类型标注：`(): X { … }` / `(): X => ({ … })`
  for (const m of text.matchAll(new RegExp(`\\)\\s*:\\s*${iface}\\s*(?:=>\\s*\\(?)?\\{`, 'g')))
    pushFrom(m.index)
  for (const m of text.matchAll(/\boptions:\s*\{/g)) pushFrom(m.index)
  for (const re of [
    new RegExp(`\\bas\\s+${iface}\\b`, 'g'),
    new RegExp(`\\bsatisfies\\s+${iface}\\b`, 'g'),
  ]) {
    for (const m of text.matchAll(re)) {
      const before = text.lastIndexOf('{', m.index)
      if (before >= 0) {
        const b = blockOf(text, before)
        if (b) out.push(b)
      }
    }
  }
  return out
}

/** 接口的可选字段（AST） */
export function optionalFieldsOf(declText, ifaceName) {
  const sf = ts.createSourceFile('x.ts', declText, ts.ScriptTarget.Latest, true)
  for (const st of sf.statements) {
    if (!ts.isInterfaceDeclaration(st) || st.name.text !== ifaceName) continue
    const out = []
    for (const m of st.members) {
      if (ts.isPropertySignature(m) && m.questionToken && m.name) out.push(m.name.getText(sf))
    }
    return out
  }
  return []
}

/**
 * 主判定。
 * @param {object} o
 * @param {(f:string)=>string} o.read     读文件
 * @param {string[]} o.sources            扫描面
 * @param {Map<string,string>} o.decls    接口名 → 声明文件文本
 * @returns {{ problems: string[], report: object }}
 */
export function auditOptionalProducers({
  read,
  sources,
  decls,
  managed = MANAGED,
  allowed = ALLOWED,
}) {
  const problems = []
  const report = {}
  const allowedSet = new Set(allowed.map((a) => `${a.iface}.${a.field}`))

  for (const { name } of managed) {
    const declText = decls.get(name)
    if (!declText) {
      problems.push(`受管接口 ${name} 的声明文件读不到（改名/搬家后须同步 MANAGED）`)
      continue
    }
    const fields = optionalFieldsOf(declText, name)
    if (!fields.length) {
      problems.push(
        `受管接口 ${name} 解析到 0 个可选字段（AST 口径失效或接口已删，不能空集报通过）`
      )
      continue
    }
    const rows = {}
    for (const k of fields) rows[k] = { L2: 0, L3: 0 }
    for (const f of sources) {
      const text = read(f)
      const blocks = candidateBlocks(text, name)
      for (const k of fields) {
        if (blocks.some((b) => new RegExp(`(^|[{\\s,])${k}\\s*:`, 'm').test(b))) rows[k].L2++
        if (new RegExp(`(options|opts|o)\\??\\.${k}\\b`).test(text)) rows[k].L3++
      }
    }
    report[name] = rows
    for (const [k, v] of Object.entries(rows)) {
      if (v.L2 > 0 || v.L3 > 0) continue
      if (allowedSet.has(`${name}.${k}`)) continue
      problems.push(
        `${name}.${k}：零生产者（块内 0、读取点 0）——` +
          `接口承诺了可传，但全仓没有任何地方传它。` +
          `处置：删字段，或在 ALLOWED 里登记理由与删除条件。`
      )
    }
  }
  return { problems, report }
}

function main() {
  const sources = listSources()
  const texts = new Map(sources.map((f) => [f, fs.readFileSync(path.join(ROOT, f), 'utf8')]))
  const decls = new Map()
  for (const { file, name } of MANAGED) {
    const p = path.join(ROOT, file)
    if (fs.existsSync(p)) decls.set(name, fs.readFileSync(p, 'utf8'))
  }
  const { problems, report } = auditOptionalProducers({
    read: (f) => texts.get(f) ?? fs.readFileSync(path.join(ROOT, f), 'utf8'),
    sources,
    decls,
  })

  console.log(`[optional-field-producer] 扫描 ${sources.length} 个非测试源文件`)
  for (const [iface, rows] of Object.entries(report)) {
    const zero = Object.entries(rows).filter(([, v]) => v.L2 === 0 && v.L3 === 0)
    console.log(
      `  ${iface}: ${Object.keys(rows).length} 个可选字段，零生产者 ${zero.length} 个` +
        (zero.length ? `（${zero.map(([k]) => k).join(', ')}）` : '')
    )
  }
  if (problems.length) {
    console.error(`\n[optional-field-producer] FAIL：${problems.length} 处零生产者字段`)
    problems.forEach((p) => console.error('  ✗ ' + p))
    process.exit(1)
  }
  console.log('[optional-field-producer] OK：受管接口的可选字段全部有生产者或在豁免清单内')
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
if (isMain) main()
