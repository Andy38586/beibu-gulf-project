#!/usr/bin/env node
/**
 * mutation-probe —— 变异测试（故障注入）自证器（EP-DYN，2026-09-15）
 *
 * 回答「测试写得很松、形不成约束」：覆盖率只说明代码被执行过，不说明断言能抓住错误。
 * 本器对关键源码做一次【可逆的小破坏】（变异），再跑对应测试：
 *   · killed  ＝测试变红（断言真的咬人，约束成立）；
 *   · survived＝测试仍绿（破坏没被发现＝这条测试是松的，需补强或登记已知缺口）。
 *
 * 安全保证：每个变异用例跑完【必定还原】目标文件（try/finally + 还原后逐字节比对），
 * 中途异常/被杀也不留脏；变异点要求在文件中【唯一匹配】，匹配 0 次或多次都判 error，绝不误改。
 *
 * 用法：
 *   node tools/mutation-probe/run.mjs            # 跑全部用例
 *   node tools/mutation-probe/run.mjs --id M1    # 只跑某条
 *   node tools/mutation-probe/run.mjs --json out # 额外写 JSON 报告
 *
 * 退出码：全部 killed（或仅余已登记的 known-survivor）→ 0；出现未登记 survived/用例错误 → 1。
 * 用例清单见同目录 cases.mjs，新增关键模块时按样例补变异——这是「给后续发展留的扩展位」。
 */
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { CASES, KNOWN_SURVIVORS } from './cases.mjs'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(HERE, '../..')
const IS_WIN = process.platform === 'win32'
const NPX = IS_WIN ? 'npx.cmd' : 'npx'

function parseArgs(argv) {
  const out = { ids: [], json: null }
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--id') out.ids.push(argv[++i])
    else if (argv[i] === '--json') out.json = argv[++i]
  }
  return out
}

/**
 * 执行单条变异：注入 → 跑测试 → 必定还原。
 * @returns {{id:string,status:'killed'|'survived'|'error',code:number|null,detail:string,durationMs:number}}
 */
function probeOne(c) {
  const file = path.join(ROOT, c.target)
  const started = Date.now()
  let orig
  try {
    orig = fs.readFileSync(file, 'utf8')
  } catch (e) {
    return {
      id: c.id,
      status: 'error',
      code: null,
      detail: `读不到目标 ${c.target}: ${e.message}`,
      durationMs: 0,
    }
  }
  const occurrences = orig.split(c.find).length - 1
  if (occurrences !== 1) {
    return {
      id: c.id,
      status: 'error',
      code: null,
      detail: `变异锚点在 ${c.target} 中应唯一，实际匹配 ${occurrences} 次（find=${JSON.stringify(c.find).slice(0, 80)}）`,
      durationMs: 0,
    }
  }

  const mutated = orig.replace(c.find, c.replace)
  fs.writeFileSync(file, mutated)
  let code = null
  let tail = ''
  let runError = null
  let restoreIssue = null
  try {
    const cwd = c.test.cwd ? path.join(ROOT, c.test.cwd) : ROOT
    const [bin, ...args] =
      c.test.command[0] === 'npx' ? [NPX, ...c.test.command.slice(1)] : c.test.command
    const r = spawnSync(bin, args, {
      cwd,
      encoding: 'utf8',
      shell: IS_WIN,
      env: { ...process.env, NODE_OPTIONS: '' },
      maxBuffer: 64 * 1024 * 1024,
    })
    code = r.status
    tail = `${r.stdout || ''}\n${r.stderr || ''}`.trim().split('\n').slice(-12).join('\n')
  } catch (e) {
    runError = `执行测试异常: ${e.message}`
  } finally {
    // 无论如何还原，并逐字节核对（不在 finally 里 return——那会吞掉正常/异常结果）
    fs.writeFileSync(file, orig)
    const restored = fs.readFileSync(file, 'utf8')
    if (restored !== orig) restoreIssue = '还原后与原文件不一致（!!），请手动 git checkout 该文件'
  }
  if (restoreIssue) {
    return {
      id: c.id,
      status: 'error',
      code: null,
      detail: restoreIssue,
      durationMs: Date.now() - started,
    }
  }
  if (runError) {
    return {
      id: c.id,
      status: 'error',
      code: null,
      detail: runError,
      durationMs: Date.now() - started,
    }
  }

  const killed = code !== 0
  return {
    id: c.id,
    status: killed ? 'killed' : 'survived',
    code,
    detail: killed ? `测试以 exit ${code} 变红，抓住变异 ✓` : '测试仍 exit 0 全绿——破坏没被发现 ✗',
    durationMs: Date.now() - started,
    tail,
    desc: c.desc,
    target: c.target,
  }
}

function main() {
  const args = parseArgs(process.argv.slice(2))
  const selected = args.ids.length ? CASES.filter((c) => args.ids.includes(c.id)) : CASES
  if (selected.length === 0) {
    console.error('没有匹配的变异用例：' + args.ids.join(', '))
    process.exit(1)
  }
  const results = []
  console.log(`[mutation-probe] 共 ${selected.length} 条变异用例（每条注入→跑测试→必定还原）\n`)
  for (const c of selected) {
    process.stdout.write(`• ${c.id}  ${c.desc}\n    目标 ${c.target}\n    → 运行中...`)
    const r = probeOne(c)
    results.push(r)
    const icon = r.status === 'killed' ? 'KILLED' : r.status === 'survived' ? 'SURVIVED' : 'ERROR'
    process.stdout.write(`\r    → ${icon}（${r.durationMs}ms） ${r.detail}\n`)
    if (r.status === 'survived' && r.tail)
      console.log('      末段输出: ' + r.tail.replace(/\n/g, '\n      '))
  }

  const killed = results.filter((r) => r.status === 'killed')
  const survived = results.filter((r) => r.status === 'survived')
  const errors = results.filter((r) => r.status === 'error')
  const unregistered = survived.filter((r) => !KNOWN_SURVIVORS.includes(r.id))

  console.log('\n[mutation-probe] 汇总')
  console.log(`  KILLED ${killed.length} · SURVIVED ${survived.length} · ERROR ${errors.length}`)
  for (const r of results) {
    const tag =
      r.status === 'killed'
        ? '✓ killed'
        : KNOWN_SURVIVORS.includes(r.id)
          ? '△ survived(已登记)'
          : '✗ survived'
    console.log(`  ${tag}  ${r.id}  ${r.desc ?? ''}`)
  }
  if (errors.length) {
    console.error('\n存在用例执行错误（锚点失配/IO 异常），请先修复用例定义：')
    errors.forEach((r) => console.error(`  ${r.id}: ${r.detail}`))
  }
  if (unregistered.length) {
    console.error(
      '\n✗ 以下变异存活：对应测试太松、没抓住被注入的破坏。请补强断言（参照 backend/test/invariants-contract.spec.ts），' +
        '或确属暂不处理时在 cases.mjs 的 KNOWN_SURVIVORS 显式登记并写明原因。'
    )
    unregistered.forEach((r) => console.error(`  ${r.id}: ${r.target}`))
  }

  if (args.json) {
    fs.writeFileSync(
      path.resolve(ROOT, args.json),
      JSON.stringify({ at: new Date().toISOString(), results }, null, 2)
    )
  }

  process.exit(errors.length || unregistered.length ? 1 : 0)
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
if (isMain) main()

export { probeOne }
