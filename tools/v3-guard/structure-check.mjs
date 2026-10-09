#!/usr/bin/env node
/**
 * structure-check.mjs — 结构契约（后端的模块分层 + 前端渲染器的体量棘轮）。
 *
 * 每个 backend/src/modules/<name> 必须满足：
 *   1. 存在 <name>.module.ts（模块总装）；
 *   2. 存在控制器：controllers/ 子目录内，或平铺 <name>.controller.ts（两者取一，迁移会收敛到前者）；
 *   3. 模块目录内不容许散落的临时/一次性文件（.tmp / .bak / *.py 等）。
 *
 * 渲染器体量棘轮（z016 / 裁定 A-1，2026-10-06 冻结）：两引擎大文件**不拆分**，但冻结行数上限，
 * 新增内容一律另开文件。棘轮值 = 冻结时实测（CesiumRenderer 2121 / OLRenderer 1051）。
 * 为什么要有这条：不拆分是取舍（P8 拆分曾让缺陷翻倍），但"不拆分"必须配一条能红的判据，
 * 否则等于"随便长"。失效条件：任一文件确实需要超过上限且拆分不可行 ⇒ 走用户裁定重设上限。
 *
 * 用法：node tools/v3-guard/structure-check.mjs
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const MODULES = path.join(ROOT, 'backend/src/modules')

const LAYER_DIRS = ['controllers', 'services', 'repositories', 'dto']
const FORBIDDEN_FILENAMES = /\.(tmp|bak|orig|swp)(\.\w+)?$/i

/**
 * 前端渲染器体量棘轮（冻结值，只许下调；新增量另开文件）。
 * 计法 = 换行符数（`wc -l` 口径：`\n` 计数），与历史实测同尺；
 * 冻结值取 2026-10-06 实测（A-1 裁定的 2121/1051 是 10-05 实测值，其后合法改动增长 ⇒ 本日起重锚）。
 * 2026-10-09 随减重计划单元 6 收口，按「上限=实测」下修至 2358/1111。
 */
export const RENDERER_SIZE_CEILINGS = [
  { file: 'frontend/src/core/map/renderers/CesiumRenderer.ts', max: 2358 },
  { file: 'frontend/src/core/map/renderers/OLRenderer.ts', max: 1111 },
]

/**
 * 体量棘轮审计：行数超过冻结值即报（注入式：`files` 为 {path, lines} 列表）。
 * 只报超限，不报"变小"——变小是好事，不设下限（避免逼人补空行凑数）。
 */
export function auditFileSizes(files, ceilings = RENDERER_SIZE_CEILINGS) {
  const byPath = new Map(files.map((f) => [f.path, f.lines]))
  const problems = []
  for (const c of ceilings) {
    const lines = byPath.get(c.file)
    if (lines === undefined) {
      problems.push(`${c.file} — 体量棘轮登记的渲染器不存在（改名/搬家后须同步本表）`)
      continue
    }
    if (lines > c.max)
      problems.push(
        `${c.file} — ${lines} 行 > 冻结上限 ${c.max} 行（z016 裁定：不拆分 ⇒ 新增内容另开文件；` +
          `确需提额须用户裁定重设）`
      )
  }
  return problems
}

/**
 * 审计一个 modules 目录是否满足分层契约。目录可注入 —— 否则守卫只能整体跑真实仓库，
 * 红样无从写起（本仓几个守卫此前都因此没有 test，红样元守卫把它们记在棘轮基线上）。
 */
export function audit(modulesDir = MODULES) {
  const problems = []

  for (const name of readdirSync(modulesDir, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name)) {
    if (name === '__tests__' || name.startsWith('.')) continue
    const dir = path.join(modulesDir, name)

    if (!existsSync(path.join(dir, `${name}.module.ts`))) {
      problems.push(`${name}/ — 缺少 ${name}.module.ts 模块总装`)
    }

    const controllerInLayers = existsSync(path.join(dir, 'controllers'))
    const flatController = existsSync(path.join(dir, `${name}.controller.ts`))
    if (!controllerInLayers && !flatController) {
      problems.push(`${name}/ — 缺少控制器（controllers/ 子目录或 ${name}.controller.ts 均不可用）`)
    }

    const serviceInLayers = existsSync(path.join(dir, 'services'))
    const flatService = existsSync(path.join(dir, `${name}.service.ts`))
    if (!serviceInLayers && !flatService) {
      problems.push(`${name}/ — 缺少服务（services/ 子目录或 ${name}.service.ts 均不可用）`)
    }

    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.isFile() && FORBIDDEN_FILENAMES.test(entry.name)) {
        problems.push(`${name}/ — 残留临时文件 ${entry.name}`)
      }
      if (
        entry.isDirectory() &&
        LAYER_DIRS.includes(entry.name) &&
        readdirSync(path.join(dir, entry.name)).length === 0
      ) {
        problems.push(`${name}/${entry.name}/ — 空目录应删除`)
      }
    }
  }

  return problems
}

const problems = audit()

// 体量棘轮（z016）：读真文件行数；文件不在（被改名）也报（登记的棘轮必须指到真实文件）
const sizeProblems = auditFileSizes(
  RENDERER_SIZE_CEILINGS.map((c) => ({
    path: c.file,
    lines: (() => {
      try {
        const text = readFileSync(path.join(ROOT, c.file), 'utf8')
        return (text.match(/\n/g) || []).length // wc -l 口径（尾行无换行不计）
      } catch {
        return undefined
      }
    })(),
  })).filter((f) => f.lines !== undefined)
)
problems.push(...sizeProblems)

if (problems.length > 0) {
  console.log('[structure-check] 模块分层契约违规：')
  for (const p of problems) console.log(`  - ${p}`)
  process.exit(1)
}
console.log(
  `[structure-check] OK：${readdirSync(MODULES).length} 个模块满足分层契约；` +
    `渲染器体量棘轮 ${RENDERER_SIZE_CEILINGS.length} 项未超限`
)
