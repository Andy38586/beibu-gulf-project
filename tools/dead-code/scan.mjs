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
const SKIP_DIRS = new Set(['node_modules', 'dist', '.venv'])

/** 递归收集源文件；isDef 为 true 时排除测试文件（测试文件不贡献"待清理的导出"） */
export function listSources(roots = SCAN_ROOTS, { isDef = true } = {}) {
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
      else if (/\.(ts|vue)$/.test(e.name)) {
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
  const refFiles = listSources(roots, { isDef: false })

  const texts = new Map()
  const readCache = (f) => {
    if (!texts.has(f)) texts.set(f, fs.readFileSync(path.join(ROOT, f), 'utf8'))
    return texts.get(f)
  }

  const exports = []
  for (const f of defFiles) exports.push(...extractExports(f, readCache(f)))

  // 标识符索引：name -> 出现该名字的文件集合
  const where = new Map()
  for (const f of refFiles) {
    for (const id of identifiersOf(readCache(f))) {
      if (!where.has(id)) where.set(id, new Set())
      where.get(id).add(f)
    }
  }

  const dead = []
  const redundantExport = []
  for (const e of exports) {
    const files = where.get(e.name) ?? new Set()
    const external = [...files].filter((f) => f !== e.file)
    if (external.length > 0) continue
    // 零外部引用还要再分两类，否则报告会误导清理：
    //   同文件内除定义行外还出现过 ⇒ 它在自己文件里用着，只是 export 多余 → 去掉 export 即可
    //   同文件内也没再用           ⇒ 彻底没人用 → 可删
    const hits = (readCache(e.file).match(new RegExp(`\\b${e.name}\\b`, 'g')) ?? []).length
    ;(hits > 1 ? redundantExport : dead).push(e)
  }
  return { exports, dead, redundantExport }
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

  const { exports, dead, redundantExport } = scan()
  const groups = groupByModule(dead)

  console.log(`[dead-code] 扫描范围：${SCAN_ROOTS.join(' / ')}`)
  console.log(`[dead-code] 导出声明 ${exports.length} 个`)
  console.log(`[dead-code]   A 彻底没人用（可删）        ${dead.length}`)
  console.log(`[dead-code]   B 只在本文件用（去掉 export）${redundantExport.length}\n`)
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
          dead,
          redundantExport,
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
