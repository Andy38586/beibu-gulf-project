// 深路径穿透扫描（W59 A3）：找出「越过目标目录入口、直插内部」的 import。
//
// ## 为什么单独做一条棘轮，而不是并进 dependency-cruiser
//
// `.dependency-cruiser.cjs` 的规则是布尔判据（命中即红），表达不了「存量 177 条照跑，
// 但一条都不许再涨」。白名单式豁免要把 177 条路径逐条抄进配置 —— 那是 §七-7 要治的
// 第二份手抄名单。棘轮（tools/dup/ratchet.mjs、tools/dead-code/ratchet.mjs 同构）
// 用「基线只许降」表达同一件事，且每次下调必须带 --note 区分真清理与口径调整。
//
// ## 口径（三条，缺一条就会量错东西）
//
//   1. **只算生产面**：排除 `__tests__/`、`*.test.*`、`*.spec.*`（与 .dependency-cruiser.cjs
//      的 `exclude.path` 一致）。测试里的深路径是夹具写法，不是耦合。
//   2. **入口文件只在「目标有入口」时才当源**：`index.ts` 的职责是 re-export 内部符号，
//      `core/index.ts` 31 条、`shared/index.ts` 49 条、`visualization/index.ts` 11 条都是
//      这个形态，且这些目标模块组**没有**自己的入口——模块公开面就等于内部路径，计入
//      等于把「无法收敛的存量」算成债。但目标组**已有**入口时例外：`business/index.ts`
//      写 `export * from './forecast/composables/useForecastRequest'` 而
//      `business/forecast/index.ts` 就在那儿，这是该走入口而不走，必须计入——否则
//      A2 的修法本身没有判据看护，business/index.ts 随时能悄悄退回穿透而棘轮全绿。
//   3. **越界才算**：目标 ≥3 段（`@/core/map/renderers/MapRenderer`）且目标的**模块组** ≠ 源的
//      模块组。模块组 = 路径前两段（`core/map`、`shared/utils`、`business/forecast`），与
//      `tools/v3-guard/cruise-coverage.mjs` 的 `listBusinessModules()` 同口径。组内的子目录
//      互引（`core/map/renderers/X` → `core/map/composables/Y`）是模块内部结构，不是穿透 ——
//      311 条深路径里 286 条属这类，全算上会让基线虚高且治不到真耦合。
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
export const SRC = path.join(ROOT, 'frontend/src')

/** 与本项目 cruise 配置同一套排除口径（`.dependency-cruiser.cjs` options.exclude.path） */
const EXCLUDE_RE = /(__tests__|\.test\.|\.spec\.)/

/**
 * 递归收集 .ts/.vue 文件。
 * `readdir` 可注入（测试用）：不可读目录**不崩**——记入 `skipped` 后继续，
 * 与 `entryGroups()` 的容错口径对齐（Q28）。不能纯静默：调用方必须打印 skipped。
 */
export function walkTree(dir, { out = [], readdir = readdirSync, skipped = [] } = {}) {
  let entries
  try {
    entries = readdir(dir, { withFileTypes: true })
  } catch (err) {
    skipped.push({ dir, code: err?.code ?? 'UNKNOWN', message: err?.message ?? String(err) })
    return out
  }
  for (const e of entries) {
    const p = path.join(dir, e.name)
    if (e.isDirectory()) {
      if (EXCLUDE_RE.test(e.name)) continue
      walkTree(p, { out, readdir, skipped })
    } else if (/\.(ts|vue)$/.test(e.name) && !EXCLUDE_RE.test(e.name)) out.push(p)
  }
  return out
}

/** 去掉行/块注释再找 import 源——否则文档示例里的 `@/xxx/yyy` 会被当成真依赖 */
const stripComments = (src) =>
  src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')

const SPEC_RE = /\b(?:from|import)\s*\(?\s*['"]([^'"]+)['"]/g

/** 把 import 说明符解析成 `srcRoot` 下的相对路径；解析不了（裸包名等）返回 null */
const resolveSpec = (spec, fromFile, srcRoot) => {
  let rel
  if (spec.startsWith('@/')) rel = spec.slice(2)
  else if (spec.startsWith('.')) {
    rel = path
      .relative(srcRoot, path.resolve(path.dirname(fromFile), spec))
      .split(path.sep)
      .join('/')
  } else return null
  if (!rel || rel.startsWith('..')) return null
  return rel
}

/** 模块组 = 路径前两段；根级文件（App.vue / main.ts / business/preload.ts）归 '（根）' */
export const groupOf = (rel) => {
  const segs = rel.split('/')
  return segs.length >= 3 ? `${segs[0]}/${segs[1]}` : '（根）'
}

/** 有入口文件的模块组集合（`<组>/index.ts` 存在）——口径 2 的例外判据 */
const entryGroups = (srcRoot) => {
  const set = new Set()
  const stack = [srcRoot]
  while (stack.length) {
    const dir = stack.pop()
    let entries
    try {
      entries = readdirSync(dir, { withFileTypes: true })
    } catch {
      continue
    }
    for (const e of entries) {
      if (!e.isDirectory()) continue
      if (EXCLUDE_RE.test(e.name)) continue
      const p = path.join(dir, e.name)
      stack.push(p)
      if (e.name === 'index.ts') continue
      const idx = path.join(p, 'index.ts')
      if (existsSync(idx)) set.add(path.relative(srcRoot, p).split(path.sep).join('/'))
    }
  }
  return set
}

/**
 * 扫描深路径穿透。返回 `{ file, target, group }` 列表：
 * `file` = 源文件（src 相对）、`target` = 目标路径（src 相对）、`group` = 目标模块组。
 * 纯函数（读盘在 walk 内），便于测试传假文件树。
 */
export function scanDeepImports(srcRoot = SRC) {
  const entries = entryGroups(srcRoot)
  const rows = []
  const skipped = []
  const files = walkTree(srcRoot, { skipped })
  if (skipped.length) {
    console.warn(
      `[deep-import] 跳过 ${skipped.length} 个不可读目录（不静默）：` +
        skipped.map((s) => `${s.dir}${s.code ? `(${s.code})` : ''}`).join(', ')
    )
  }
  for (const file of files) {
    const rel = path.relative(srcRoot, file).split(path.sep).join('/')
    // 口径 2：入口文件是公开面的定义处；但目标组已有入口时必须走入口，不能穿透
    const isEntry = path.basename(rel) === 'index.ts'
    const srcGroup = groupOf(rel)
    const src = stripComments(readFileSync(file, 'utf8'))
    let m
    SPEC_RE.lastIndex = 0
    while ((m = SPEC_RE.exec(src))) {
      const target = resolveSpec(m[1], file, srcRoot)
      if (!target) continue
      // 口径 3：≥3 段且目标模块组 ≠ 源模块组
      const tgtGroup = groupOf(target)
      if (target.split('/').length < 3) continue
      if (tgtGroup === srcGroup) continue
      if (isEntry && !entries.has(tgtGroup)) continue
      rows.push({ file: rel, target, group: tgtGroup })
    }
  }
  return rows.sort((a, b) => a.file.localeCompare(b.file) || a.target.localeCompare(b.target))
}
