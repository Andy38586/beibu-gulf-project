#!/usr/bin/env node
/**
 * cruise-coverage.mjs — 04-E2 承接体：守护规则的模块集合 == 实际目录集合。
 *
 * 背景（z055）：04-防复发清单 E2 明文要求"规则里的模块集合 == 实际目录集合，
 * 缺一个即 fail"，但全仓无承接体。实证：business 互引规则曾只枚举 3 个模块，
 * route-analysis 自落地起无守护（z051/z053）；且"逐个枚举"式规则每加一个模块
 * 要静默少一格保护。
 *
 * 本守卫断言（business 域，双向）：
 *   ① business/ 下每个模块目录都有对应的 business-cross-import-<name> 规则；
 *   ② 规则里出现的每个模块名都对应真实存在的目录（防规则指向已删模块）。
 * 新增业务目录未建规则 ⇒ 红；规则引用幽灵模块 ⇒ 红。
 *
 * 用法：node tools/v3-guard/cruise-coverage.mjs   # 集合不一致 exit 1
 */
import { readFileSync, readdirSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')

const CRUISE_CONFIG = '.dependency-cruiser.cjs'
const BUSINESS_DIR = 'frontend/src/business'
const RULE_PREFIX = 'business-cross-import-'

/** business/ 下的模块目录（排除 index.ts / manifest.ts 等文件与 __tests__） */
export function listBusinessModules(root = ROOT) {
  const dir = path.join(root, BUSINESS_DIR)
  return readdirSync(dir, { withFileTypes: true })
    .filter((e) => e.isDirectory() && e.name !== '__tests__')
    .map((e) => e.name)
    .sort()
}

/** 从 cruise 配置提取 business-cross-import-* 规则覆盖的模块名（from 路径第二段） */
export function parseRuleModules(cruiseText) {
  const modules = []
  const re = new RegExp(
    `name: '${RULE_PREFIX}([^']+)'[\\s\\S]*?from: \\{ path: '\\^frontend/src/business/([^/]+)/'`,
    'g'
  )
  for (const m of cruiseText.matchAll(re)) {
    if (m[1] !== m[2]) {
      throw new Error(
        `规则名与 from 路径不一致：name=${m[1]} from=${m[2]}（命名约定 business-cross-import-<目录名>）`
      )
    }
    modules.push(m[2])
  }
  return modules.sort()
}

/**
 * E2 对账。
 * @returns {{ problems: string[], rules: string[], dirs: string[] }}
 */
export function auditCoverage(cruiseText, dirs) {
  const problems = []
  const rules = parseRuleModules(cruiseText)

  for (const dir of dirs) {
    if (!rules.includes(dir)) {
      problems.push(
        `✗ business/${dir} 无互引守护规则：需在 .dependency-cruiser.cjs 增加 business-cross-import-${dir}（04-E2：规则集合 == 目录集合）`
      )
    }
  }
  for (const rule of rules) {
    if (!dirs.includes(rule)) {
      problems.push(
        `✗ 规则 business-cross-import-${rule} 指向不存在的目录 business/${rule}（幽灵规则）`
      )
    }
  }
  return { problems, rules, dirs }
}

// ---------- main ----------

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)

if (isMain) {
  const cruiseText = readFileSync(path.join(ROOT, CRUISE_CONFIG), 'utf8')
  const dirs = listBusinessModules()
  const { problems, rules } = auditCoverage(cruiseText, dirs)

  console.log(`[cruise-coverage] business 目录 ${dirs.length} 个：${dirs.join('、')}`)
  console.log(
    `[cruise-coverage] 互引规则 ${rules.length} 条：${rules.map((r) => RULE_PREFIX + r).join('、')}`
  )
  if (problems.length) {
    console.error('\n' + problems.join('\n'))
    console.error(`\n[cruise-coverage] 04-E2 对账未通过（${problems.length} 处）`)
    process.exit(1)
  }
  console.log('[cruise-coverage] 规则集合 == 目录集合 ✓')
}
