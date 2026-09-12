#!/usr/bin/env node
/**
 * guard:v3 串联执行器（审查 z163）
 *
 * 为什么不用 `&&`：`&&` 链在**第一个非 0 退出**处结束，其后的守卫既不执行也不报错。
 * 守卫自身崩在解析阶段（如读不到文档抛 ENOENT）时，只要它前面的守卫是绿的，断点之后的
 * 新违规就静默漏网——历史上 metrics-tally 断链就是这样把 anchor-check / tmp-hygiene 停掉的。
 *
 * 本器：顺序跑完全部守卫、逐项记录 {code, signal}、末尾统一判定——任一失败即整体 exit 1，
 * 且**跑完全部**（不短路），失败项在汇总表里一眼可见。
 *
 * 用法：node tools/v3-guard/run-all.mjs   （等价于原 `npm run guard:v3`）
 */
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(HERE, '../..')

/** 守卫执行顺序 = 失败反馈优先级（静态 → 契约 → 统计 → 守门） */
export const GUARDS = [
  'no-ephemeral',
  'structure-check',
  'routes-audit',
  'constants-audit',
  'metrics-tally',
  'csp-sync',
  'anchor-check',
  'tmp-hygiene',
]

/**
 * 顺序执行全部守卫，**不短路**。
 * @param {(name: string) => { code: number|null, signal: string|null }} exec 执行注入点（测试用）
 * @returns {{ results: Array<{name: string, code: number|null, signal: string|null}>, ok: boolean }}
 */
export function runAll(exec = defaultExec) {
  const results = GUARDS.map((name) => ({ name, ...exec(name) }))
  const ok = results.every((r) => r.code === 0 && !r.signal)
  return { results, ok }
}

function defaultExec(name) {
  const file = path.join(HERE, `${name}.mjs`)
  // 脚本缺失按失败处理（原 `&&` 链里缺文件是 node 报错非 0，语义等价）
  if (!fs.existsSync(file)) return { code: null, signal: 'MISSING' }
  const r = spawnSync(process.execPath, [file], { cwd: ROOT, stdio: 'inherit' })
  return { code: r.status, signal: r.signal }
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)

if (isMain) {
  const { results, ok } = runAll()
  const pad = Math.max(...results.map((r) => r.name.length))
  console.log('\n[guard:v3] 汇总（全部执行，不短路）')
  for (const r of results) {
    const good = r.code === 0 && !r.signal
    const tag = r.signal ? `被信号终止（${r.signal}）` : r.code === 0 ? 'OK' : `exit ${r.code}`
    console.log(`  ${good ? '✅' : '❌'} ${r.name.padEnd(pad)}  ${tag}`)
  }
  if (!ok) {
    const bad = results.filter((r) => r.code !== 0 || r.signal)
    console.error(
      `\n[guard:v3] ${bad.length}/${results.length} 项失败：${bad.map((r) => r.name).join('、')}`
    )
    process.exit(1)
  }
  console.log(`[guard:v3] 全部 ${results.length} 项通过`)
}
