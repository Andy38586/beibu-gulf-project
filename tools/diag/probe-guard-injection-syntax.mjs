#!/usr/bin/env node
/**
 * 只读诊断：guard-red-mutation 的注入器对每个守卫产出的文件是否语法合法。
 *
 * 为什么：`probeGuard` 只按子进程退出码判红（killed），不区分「断言咬住违规」与
 * 「注入把文件改到语法非法、子进程 parse error」。后者是**假杀**——红样承重性
 * 并未被验证。本探针把每个注入点写到临时文件跑 `node --check`，列出语法非法项。
 *
 * 2026-10-05 实测：22 个守卫里 4 个**首注入点**语法非法（guard-red-sample /
 * layer-keys / owned-layers / tmp-hygiene），另 tiles3d-check 的第 2 注入点非法
 * ⇒ `guard:mutation` 报的 22/22 里这 4 格不承重。根因：`injectEarlyReturn` 取
 * 函数名后第一个 `{`，遇 `f(a, {…} = {})` / `f({…} = {})` 这类参数解构会插进参数表。
 *
 * 用法：node tools/diag/probe-guard-injection-syntax.mjs   （只读；退出码恒 0）
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { pathToFileURL } from 'node:url'

const ROOT = process.cwd()
const G = path.join(ROOT, 'tools/v3-guard')
const mod = await import(pathToFileURL(path.join(G, 'guard-red-mutation.mjs')).href)
const guards = mod.guardsToProbe()
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'inj-audit-'))
const rows = []

for (const name of guards) {
  const guardPath = path.join(G, `${name}.mjs`)
  const testPath = path.join(G, '__tests__', `${name}.test.mjs`)
  if (!fs.existsSync(guardPath) || !fs.existsSync(testPath)) {
    rows.push({ name, statuses: null })
    continue
  }
  const src = fs.readFileSync(guardPath, 'utf8')
  const fns = mod.pickInjectables(src, mod.importedNames(fs.readFileSync(testPath, 'utf8')))
  const statuses = []
  for (const fn of fns) {
    const mut = mod.injectEarlyReturn(src, fn)
    if (mut === null) {
      statuses.push(`${fn}:null`)
      continue
    }
    const f = path.join(tmpDir, `${name}-${fn}.mjs`)
    fs.writeFileSync(f, mut)
    const r = spawnSync(process.execPath, ['--check', f], { encoding: 'utf8' })
    statuses.push(`${fn}:${r.status === 0 ? 'ok' : 'SYNTAX-BROKEN'}`)
  }
  rows.push({ name, statuses })
}

console.log('guards total = ' + guards.length)
for (const r of rows) {
  console.log(
    r.statuses
      ? `${r.name.padEnd(26)} fns=${r.statuses.length} :: ${r.statuses.join(' | ')}`
      : `${r.name.padEnd(26)} SKIP（缺守卫或测试文件）`
  )
}
const brokenFirst = rows.filter(
  (r) => r.statuses && r.statuses[0] && r.statuses[0].includes('SYNTAX-BROKEN')
)
const anyBroken = rows.filter(
  (r) => r.statuses && r.statuses.some((s) => s.includes('SYNTAX-BROKEN'))
)
console.log('')
console.log('首注入点语法非法（= 直接假杀）的守卫数 = ' + brokenFirst.length)
console.log('名单：' + brokenFirst.map((b) => b.name).join(', '))
console.log('任一注入点语法非法的守卫数 = ' + anyBroken.length)
