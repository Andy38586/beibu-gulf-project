#!/usr/bin/env node
/**
 * source-registry.mjs — 数据来源登记的守卫（W9）。
 *
 * ## 它治什么
 *
 * 论文与开源的第一问是"这些数据哪来的、能不能用"。此前答案散在 README/脚本注释里，
 * 且**没有任何判据**保证新增数据资产会被登记——典型的"无权威源的多份副本"（AGENTS §七-7）。
 *
 * ## 它怎么做
 *
 * 1. `git ls-files backend/data backend/static` 取**受版本控制的数据资产全集**（派生，不手写清单）；
 * 2. 与 `source-registry.json` 的组逐一对齐：每个文件必须被至少一组覆盖；
 * 3. 有任何文件没被覆盖 ⇒ 非零退出（新增资产忘登记即红）；
 * 4. 同时输出 `provenanceStatus=pending` 的组数——**未确认的来源是要还的债**，不许静默。
 *
 * 用法：
 *   node tools/data-audit/source-registry.mjs            # 核对（缺登记即 exit 1）
 *   node tools/data-audit/source-registry.mjs --json     # 机器可读输出
 */
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(HERE, '..', '..')
const REGISTRY_PATH = path.join(HERE, 'source-registry.json')

export const SCAN_ROOTS = ['backend/data', 'backend/static']

/** 极简 glob：支持 ** 与 *（不引入依赖） */
export function matchesGlob(file, pattern) {
  const norm = file.replace(/\\/g, '/')
  if (!pattern.includes('*')) return norm === pattern
  const rx = pattern
    .replace(/[.+^$\{\}()|[\]\\]/g, '\\$&')
    .replace(/\*\*/g, '\u0000')
    .replace(/\*/g, '[^/]*')
    .replace(/\u0000/g, '.*')
  return new RegExp('^' + rx + '$').test(norm)
}

/** 某文件是否被该组覆盖 */
export function groupCovers(group, file) {
  const exact = group.paths ?? []
  const globs = group.globs ?? []
  return exact.includes(file) || globs.some((g) => matchesGlob(file, g))
}

/** 覆盖率计算（纯函数）：返回 { gaps, counts } */
export function computeCoverage(files, groups) {
  const gaps = []
  const counts = {}
  for (const g of groups) counts[g.id] = 0
  for (const f of files) {
    const hit = groups.find((g) => groupCovers(g, f))
    if (!hit) gaps.push(f)
    else counts[hit.id] += 1
  }
  return { gaps, counts }
}

/** 登记表自检：必填字段、id 唯一 */
export function validateRegistry(registry) {
  const problems = []
  const seen = new Set()
  for (const g of registry.groups ?? []) {
    if (!g.id) problems.push('组缺 id：' + JSON.stringify(g).slice(0, 60))
    else if (seen.has(g.id)) problems.push('id 重复：' + g.id)
    else seen.add(g.id)
    for (const field of ['source', 'license', 'fetchedAt', 'coverage', 'quality']) {
      if (!g[field]) problems.push((g.id ?? '?') + ' 缺字段 ' + field)
    }
    if (!(g.paths?.length || g.globs?.length))
      problems.push((g.id ?? '?') + ' 既无 paths 也无 globs')
  }
  return problems
}

function trackedDataFiles() {
  const r = spawnSync('git', ['ls-files', ...SCAN_ROOTS], { cwd: ROOT, encoding: 'utf8' })
  if (r.status !== 0) throw new Error('git ls-files 失败：' + (r.stderr || '').slice(0, 200))
  return r.stdout.split('\n').filter(Boolean)
}

function main() {
  const asJson = process.argv.includes('--json')
  const registry = JSON.parse(fs.readFileSync(REGISTRY_PATH, 'utf8'))
  const problems = validateRegistry(registry)
  const files = trackedDataFiles()
  const { gaps, counts } = computeCoverage(files, registry.groups)
  const pending = registry.groups.filter((g) => g.provenanceStatus === 'pending')

  if (asJson) {
    console.log(
      JSON.stringify(
        { files: files.length, gaps, counts, problems, pending: pending.map((g) => g.id) },
        null,
        2
      )
    )
  } else {
    console.log(
      '[source-registry] 数据资产 ' +
        files.length +
        ' 件 / 登记组 ' +
        registry.groups.length +
        ' 组'
    )
    for (const g of registry.groups) {
      const mark = g.provenanceStatus === 'pending' ? '⚠️ 来源未确认' : '✅'
      console.log('  ' + mark + ' ' + g.id + '：' + counts[g.id] + ' 件 — ' + g.title)
    }
    if (problems.length) {
      console.error('[source-registry] 登记表自检失败：')
      for (const p of problems) console.error('  - ' + p)
    }
    if (gaps.length) {
      console.error(
        '[source-registry] ✗ ' +
          gaps.length +
          ' 件数据资产未登记（新增资产必须进 source-registry.json）：'
      )
      for (const f of gaps.slice(0, 20)) console.error('  - ' + f)
      if (gaps.length > 20) console.error('  … 其余 ' + (gaps.length - 20) + ' 件见 --json')
    }
    const debt = pending.length
      ? '；待还债：' +
        pending.length +
        ' 组来源未确认（' +
        pending.map((g) => g.id).join('、') +
        '）'
      : ''
    console.log(
      '[source-registry] ' +
        (gaps.length === 0 && problems.length === 0 ? '✓ 全部数据资产已登记' : '✗ 未通过') +
        debt
    )
  }
  process.exit(gaps.length === 0 && problems.length === 0 ? 0 : 1)
}

const invokedDirectly =
  process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
if (invokedDirectly) main()
