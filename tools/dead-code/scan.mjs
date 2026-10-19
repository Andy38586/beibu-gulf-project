#!/usr/bin/env node
/**
 * dead-code / scan.mjs — 沉底代码扫描器（**只报告，不拦截**，退出码恒 0）。
 *
 * 治的是「有，但根本没用」这一族：**导出了没人 import**。这类东西不需要人工审查 ——
 * 纯静态统计就能列全，缺的只是有人把它列出来。四轮审查里它反复以症状形式出现
 * （死实现族、零消费 export），每轮靠人肉发现，所以永远发现不完。
 *
 * 判定口径（刻意保守，宁可少报不可误报）：
 *   · 候选  = 非测试源文件里的 `export (function|const|class|interface|type|enum) NAME`
 *   · 引用  = NAME 出现在**除定义文件之外**的任一源文件（含测试）里
 *   · 零引用 = 引用文件数 0
 *   · barrel（名为 index.ts 的文件）不参与定义提取，但参与引用统计 ——
 *     否则「只被 barrel 转发」的东西会被误判成有用。
 *
 * **已知不覆盖的一类（如实声明，不假装扫得到）**：纯注释形态的「预留 / 待用 / 暂未启用」。
 * 它不是代码实体，静态分析没有可判定的引用关系；把它算进死物需要读中文注释语义。
 * 三次实测（`layerAdapters.ts` 预留注释、`types/business/base.ts` gdp/population 注释、
 * `shared/README.md` 失实描述）都是**人读到才发现**的，本器一条都没报过。
 * 处置：这类只在人工审查面收敛，本器**不认账也不假装认账**——不计入任何栏位，
 * 也不设基线（设了基线就等于宣称「我们管着它」，那是第二种口径）。
 *
 * 基线由 dead-code-baseline.json 承载，供后续棘轮消费；本器只负责"看得见"。
 *
 * 用法：node tools/dead-code/scan.mjs [--json <out>] [--top <n>]
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
/**
 * 扫描范围。
 *
 * **测试目录必须在引用侧** —— `backend/test/` 与各处 `__tests__/` 里对导出的 import
 * 同样是「有人在用」的证据。此前 `SCAN_ROOTS` 只列了两个 `src` 且 `SKIP_DIRS` 含
 * `__tests__`，导致「只被测试使用」的导出被误判成死物（与本文档头顶「引用 = …含测试」
 * 的自述**相反**）。2026-09-25 实测踩到：按那份错误清单删掉 `clearStaticCache` /
 * `_resetPerfForTest` / `isPerfEnabled` / `getAvailableCities` 四项，`typecheck` 立刻红。
 *
 * 定义侧不受影响：`listSources(…, { isDef: true })` 仍会跳过 `.test.` / `.spec.`，
 * 测试文件不会贡献「待清理的导出」。
 */
const SCAN_ROOTS = ['frontend/src', 'backend/src', 'frontend/test', 'backend/test']
/**
 * **只参与引用统计**的根：工具链（守卫、脚本）里 import / 读某个导出，同样是「有人在用」。
 * 不列在这里时，`ROUTES_MANIFEST`（被 `tools/v3-guard/routes-audit.mjs` 引用）会被误判成死物。
 * 这些目录**不贡献**「待清理的导出」—— 守卫自己的导出不归本器管辖。
 * 另注意扩展名：工具链以 `.mjs/.cjs` 为主，只认 `.ts/.vue` 会整目录漏掉。
 */
const REF_ONLY = { roots: ['tools', 'scripts', '.github'], exts: /\.(ts|vue|mjs|cjs|js)$/ }
const SKIP_DIRS = new Set(['node_modules', 'dist', '.venv'])

/**
 * G 类（门禁载体）判别：契约源 `schemas.ts` 里的 `*Schema` 本体与其 `*Parsed` 配对类型。
 *
 * `scripts/gen-api-contract.cjs` 对 `schemas.ts` 用**动态拼名**的文本级 regex
 * （`^export const (\w+Schema)\s*=` 取本体、`\w*<base>Parsed` 配对类型，带 'i' 标志）
 * 消费这两个名字 —— 这种消费是静态引用分析看不见的，于是被误判成 A 类死物或
 * 「多余 export」（实测 2026-09-25：A 账 22 项全部此类，且**删不得**——types:check 会红）。
 *
 * 名单**从契约快照派生**（gen-api-contract 的产物、受版本控制、types:check 强制其
 * 与 schemas.ts 同步），不手抄 —— S3 的「死物账=0」前置（门禁载体单列）由本分类闭合。
 * 快照缺失/损坏时返回 null ⇒ 不分类（全部落回 A 类，宁可误报也不静默吞）。
 * 派生面是**快照里的名字**：不在快照内的 `*Schema` 不是载体（漏跑 types:gen 的假 schema
 * 照常落账），故「名字以 Schema 结尾」本身不构成豁免。
 */
const CONTRACT_SNAPSHOT = 'frontend/src/types/generated/api-contract.json'
/** 契约源唯一落点：`*Schema` 本体只在 `gen-api-contract.cjs` 解析的这一个文件里算载体 */
const SCHEMA_SOURCE = 'frontend/src/types/schemas.ts'

export function gateCarrierPredicate(snapshot = null) {
  if (!snapshot) return null
  const carriers = Object.keys(snapshot.schemas ?? {})
  const bases = carriers.map((n) => n.replace(/Schema$/, ''))
  return (name) =>
    carriers.includes(name) || bases.some((b) => new RegExp(`^\\w*${b}Parsed$`, 'i').test(name))
}

/**
 * G 类归属判定（scan 的分类分支与判据共用同一入口，避免判据复刻一份条件）。
 * 两道闸缺一不可：① 名字在契约快照内（`*Schema` 本体或 `*Parsed` 配对）；
 * ② 声明落在契约源文件 `schemas.ts` 内 —— 换个文件写同名导出不是载体（否则
 * 「以 Schema 结尾」就成了全仓豁免口）。谓词为 null（快照缺失）时一律不归 G 类。
 */
export function isGateCarrierExport(entry, isGateCarrier) {
  return !!isGateCarrier && entry.file === SCHEMA_SOURCE && isGateCarrier(entry.name)
}

export function gateCarrierPredicateFromRepo() {
  try {
    return gateCarrierPredicate(
      JSON.parse(fs.readFileSync(path.join(ROOT, CONTRACT_SNAPSHOT), 'utf8'))
    )
  } catch {
    return null
  }
}

/** 递归收集源文件；isDef 为 true 时排除测试文件（测试文件不贡献"待清理的导出"） */
export function listSources(roots = SCAN_ROOTS, { isDef = true, exts = /\.(ts|vue)$/ } = {}) {
  const out = []
  const walk = (abs) => {
    let entries
    try {
      entries = fs.readdirSync(abs, { withFileTypes: true })
    } catch {
      return
    }
    for (const e of entries) {
      if (SKIP_DIRS.has(e.name)) continue
      const p = path.join(abs, e.name)
      if (e.isDirectory()) walk(p)
      else if (exts.test(e.name)) {
        if (isDef && /\.(test|spec)\./.test(e.name)) continue
        out.push(path.relative(ROOT, p).replace(/\\/g, '/'))
      }
    }
  }
  for (const r of roots) walk(path.join(ROOT, r))
  return out.sort()
}

const DECL_RE =
  /^\s*export\s+(?:declare\s+)?(?:async\s+)?(function|const|let|var|class|interface|type|enum)\s+([A-Za-z_$][\w$]*)/gm

/**
 * 空模块：去掉注释与空白后**整份只剩 `export {}`**。
 *
 * 为什么单列一类：这类文件是「删剩一个壳」的产物——所有人 import 都被摘掉，
 * 只剩编译器不报错的 `export {}` 撑着。它既没有导出声明（`DECL_RE` 抓不到），
 * 也没有任何引用方（引用侧无从统计），于是在原有两栏里**一格都不占**，
 * 扫描器报 `totalDead 0` 时它依然躺在仓库里。`frontend/src/views/index.ts`
 * 就是这样活到最后（PZ-1，已删）；本类判据让「复建必红」。
 *
 * 豁免：生成件（`*.d.ts`，由 `unplugin-auto-import` / `unplugin-vue-components` 产出）
 * 不在定义侧，也不应被当作债——它们本来就可能只有 `export {}` 收尾。
 */
export function isEmptyModule(relPath, text) {
  if (/\.d\.ts$/.test(relPath)) return false
  if (path.basename(relPath) === 'index.ts') return false // barrel：转发文件，空转发不属本类
  const bare = text
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '')
    .trim()
  return /^export\s*\{\s*\}\s*;?$/.test(bare)
}

/** 从文件文本提取导出声明（barrel 除外） */
export function extractExports(relPath, text) {
  const base = path.basename(relPath)
  if (base === 'index.ts') return [] // barrel 只转发，不作为定义源
  const out = []
  for (const m of text.matchAll(DECL_RE)) {
    const line = text.slice(0, m.index).split('\n').length
    out.push({ name: m[2], kind: m[1], file: relPath, line })
  }
  return out
}

/** 每个文件出现过的全部标识符（一次扫描，供后续集合查询） */
export function identifiersOf(text) {
  const set = new Set()
  for (const m of text.matchAll(/[A-Za-z_$][\w$]*/g)) set.add(m[0])
  return set
}

/** 主扫描：返回 { exports, dead, redundantExport } */
export function scan({ roots = SCAN_ROOTS } = {}) {
  const defFiles = listSources(roots, { isDef: true })
  // 引用侧 = 源码树 + 测试目录 + **工具链**（守卫/脚本里 import 或读取同样是「有人在用」）
  const refFiles = [
    ...listSources(roots, { isDef: false }),
    ...listSources(REF_ONLY.roots, { isDef: false, exts: REF_ONLY.exts }),
  ]

  const texts = new Map()
  const readCache = (f) => {
    if (!texts.has(f)) texts.set(f, fs.readFileSync(path.join(ROOT, f), 'utf8'))
    return texts.get(f)
  }

  const exports = []
  const emptyModules = []
  for (const f of defFiles) {
    exports.push(...extractExports(f, readCache(f)))
    if (isEmptyModule(f, readCache(f))) emptyModules.push({ file: f })
  }

  // 标识符索引：name -> 出现该名字的文件集合
  const where = new Map()
  for (const f of refFiles) {
    for (const id of identifiersOf(readCache(f))) {
      if (!where.has(id)) where.set(id, new Set())
      where.get(id).add(f)
    }
  }

  const dead = []
  const gateCarrier = []
  const redundantExport = []
  const isGateCarrier = gateCarrierPredicateFromRepo()
  for (const e of exports) {
    const files = where.get(e.name) ?? new Set()
    const external = [...files].filter((f) => f !== e.file)
    if (external.length > 0) continue
    // 零外部引用还要再分三类，否则报告会误导清理：
    //   G 类门禁载体（契约源文件里、快照登记的名字）⇒ 被 gen-api-contract 动态拼名消费，
    //     静态引用看不见；**先判**，否则 `*Schema` 本体会被下面的 hits>1 归成"多余 export"
    //     而建议去掉 export —— 那会当场打红 types:check
    //   同文件内除定义行外还出现过 ⇒ 它在自己文件里用着，只是 export 多余 → 去掉 export 即可
    //   同文件内也没再用           ⇒ 彻底没人用 → 见下
    if (isGateCarrierExport(e, isGateCarrier)) {
      gateCarrier.push(e)
      continue
    }
    const hits = (readCache(e.file).match(new RegExp(`\\b${e.name}\\b`, 'g')) ?? []).length
    if (hits > 1) redundantExport.push(e)
    else dead.push(e)
  }
  return { exports, dead, redundantExport, gateCarrier, emptyModules }
}

/** 按模块分组（模块 = 路径前两段） */
export function groupByModule(dead) {
  const g = new Map()
  for (const d of dead) {
    const parts = d.file.split('/')
    const mod = parts.slice(0, 3).join('/')
    if (!g.has(mod)) g.set(mod, [])
    g.get(mod).push(d)
  }
  return [...g.entries()].sort((a, b) => b[1].length - a[1].length)
}

function main() {
  const args = process.argv.slice(2)
  const jsonIdx = args.indexOf('--json')
  const topIdx = args.indexOf('--top')
  const top = topIdx >= 0 ? Number(args[topIdx + 1]) : 30

  const { exports, dead, redundantExport, gateCarrier, emptyModules } = scan()
  const groups = groupByModule(dead)

  console.log(`[dead-code] 扫描范围：${SCAN_ROOTS.join(' / ')}`)
  console.log(`[dead-code] 导出声明 ${exports.length} 个`)
  console.log(`[dead-code]   A 彻底没人用（可删）        ${dead.length}`)
  console.log(`[dead-code]   B 只在本文件用（去掉 export）${redundantExport.length}`)
  console.log(`[dead-code]   E 空模块（只剩 export {}）  ${emptyModules.length}`)
  console.log(
    gateCarrier
      ? `[dead-code]   G 门禁载体（契约配对 *Parsed，删不得）${gateCarrier.length}`
      : `[dead-code]   G 门禁载体 —— 契约快照缺失，本轮不分类（全部计入 A）`
  )
  console.log('按模块（前 3 段路径）分组：')
  for (const [mod, items] of groups.slice(0, top)) {
    console.log(`  ${String(items.length).padStart(4)}  ${mod}`)
  }
  if (groups.length > top) console.log(`  …还有 ${groups.length - top} 个模块`)

  const big = groups.slice(0, 5)
  for (const [mod, items] of big) {
    console.log(`\n── ${mod}（${items.length}）`)
    for (const d of items.slice(0, 8)) {
      console.log(`   ${d.file}:${d.line}  ${d.kind} ${d.name}`)
    }
    if (items.length > 8) console.log(`   …另 ${items.length - 8} 个`)
  }

  if (jsonIdx >= 0) {
    const out = args[jsonIdx + 1]
    fs.writeFileSync(
      path.join(ROOT, out),
      JSON.stringify(
        {
          generatedFrom: 'tools/dead-code/scan.mjs',
          totalDead: dead.length,
          totalRedundantExport: redundantExport.length,
          totalEmptyModule: emptyModules.length,
          dead,
          redundantExport,
          emptyModules,
          gateCarrier,
        },
        null,
        2
      )
    )
    console.log(`\n[dead-code] JSON 已写入 ${out}`)
  }
  // 只报告，不拦截
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
if (isMain) main()
