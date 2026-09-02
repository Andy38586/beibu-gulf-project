#!/usr/bin/env node
/**
 * structure-check.mjs — 后端模块分层契约（防结构漂移/一次性平铺）。
 *
 * 每个 backend/nest/src/modules/<name> 必须满足：
 *   1. 存在 <name>.module.ts（模块总装）；
 *   2. 存在控制器：controllers/ 子目录内，或平铺 <name>.controller.ts（两者取一，迁移会收敛到前者）；
 *   3. 模块目录内不容许散落的临时/一次性文件（.tmp / .bak / *.py 等）。
 *
 * 用法：node tools/v3-guard/structure-check.mjs
 */
import { existsSync, readdirSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const MODULES = path.join(ROOT, 'backend/nest/src/modules')

const LAYER_DIRS = ['controllers', 'services', 'repositories', 'dto']
const FORBIDDEN_FILENAMES = /\.(tmp|bak|orig|swp)(\.\w+)?$/i

const problems = []

for (const name of readdirSync(MODULES, { withFileTypes: true })
  .filter((d) => d.isDirectory())
  .map((d) => d.name)) {
  if (name === '__tests__' || name.startsWith('.')) continue
  const dir = path.join(MODULES, name)

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

if (problems.length > 0) {
  console.log('[structure-check] 模块分层契约违规：')
  for (const p of problems) console.log(`  - ${p}`)
  process.exit(1)
}
console.log(`[structure-check] OK：${readdirSync(MODULES).length} 个模块均满足分层契约`)
