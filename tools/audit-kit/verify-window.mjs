#!/usr/bin/env node
/**
 * audit-kit / verify-window.mjs — 复跑窗口件的 §0 判据，并核对它自报的期望。
 *
 * 这一件解决的是「窗口自述 = 交付凭据」这个结构性缺口：把「窗口说自己跑过」
 * 换成「接收方用同一条命令复算出同一结果」。
 *
 * 契约（写进 brief 的格式要求，由本工具强制）：
 *   §0 区段里每条命令后面紧跟一行 `# 期望: <stdout 原样摘录>`。
 *   本工具把 §0 的 bash 块整块实跑（保住 cd / 变量上下文），
 *   再断言每一条期望都是实际输出的子串。
 *
 * 四条硬口径（对应 AGENTS §5.4）：
 *   1. 抽不出块         ⇒ 该窗【未交付】，rc=1（不是「部分通过」）；
 *   2. 命令起不来/超时  ⇒ 该条记 SKIP 并计入报告（不判红也不判绿）；
 *   3. 期望对不上       ⇒ 该条 FAIL，rc=1；
 *   4. 命令没带期望行   ⇒ 该条 FAIL，rc=1（原实现把它判成 PASS，926q W1-06 实测出这个洞：
 *      一份只写命令、零条 `# 期望:`、命令自身 exit 1 的件会报 pass=2 fail=0 rc=0）；
 *      放宽只为一件事：`--lenient` 记 SKIP，用于回算历史件，不得当交件门槛。
 *
 * 为什么不逐条跑：块内命令常有 cd / 变量赋值，拆开跑会失真；整块跑 + 子串断言
 * 保住了上下文，代价是「期望归属哪条命令」变粗 —— 报告里按块粒度如实呈现。
 *
 * 用法：node tools/audit-kit/verify-window.mjs <window.md> [--section 0] [--cwd .] [--lenient]
 */
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { extractBashBlocks } from './extract-window.mjs'

/** 取 `## §N` 到下一个 `## §M` 之间的文本；找不到该节则退回全文 */
export function sectionOf(markdown, n) {
  const lines = markdown.split(/\r?\n/)
  const start = lines.findIndex((l) => new RegExp(`^##\\s*§${n}(\\D|$)`).test(l))
  if (start < 0) return markdown
  let end = lines.length
  for (let i = start + 1; i < lines.length; i++) {
    if (/^##\s*§/.test(lines[i])) {
      end = i
      break
    }
  }
  return lines.slice(start, end).join('\n')
}

/** 解析块内的「命令行 + 紧随的 # 期望:」；注释与空行不构成用例 */
export function parseCases(block) {
  const cases = []
  let cur = null
  for (const raw of block.split(/\r?\n/)) {
    const exp = raw.match(/^\s*#\s*(?:期望|expect)\s*[:：]\s*(.*)$/)
    if (exp) {
      if (cur) cur.expect.push(exp[1].trim())
      continue
    }
    if (raw.trim() === '' || /^\s*#/.test(raw)) continue
    cur = { cmd: raw.trim(), expect: [] }
    cases.push(cur)
  }
  return cases
}

/**
 * 整块实跑。输出重定向到文件描述符再读文件 —— 受限执行环境拒绝创建管道式子进程
 * （spawnSync 会 EBUSY、status=null），用管道会得到一片假红。
 */
export function runBlock(block, cwd, timeoutMs = 120000) {
  const outFile = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'audit-kit-')), 'out.log')
  const fd = fs.openSync(outFile, 'w')
  let status = null
  try {
    status = spawnSync('sh', ['-c', block], {
      cwd,
      stdio: ['ignore', fd, fd],
      timeout: timeoutMs,
    }).status
  } finally {
    fs.closeSync(fd)
  }
  return { status, output: fs.readFileSync(outFile, 'utf8') }
}

/** 复算一个件：{ delivered, results, reason } */
export function verifyWindow(markdown, opts = {}) {
  const section = opts.section ?? 0
  const cwd = opts.cwd ?? process.cwd()
  const blocks = extractBashBlocks(sectionOf(markdown, section))
  if (blocks.length === 0) {
    return { delivered: false, results: [], reason: `§${section} 内没有 bash 块` }
  }
  const results = []
  for (const block of blocks) {
    const { status, output } = runBlock(block, cwd, opts.timeoutMs)
    for (const c of parseCases(block)) {
      const missing = c.expect.filter((e) => !output.includes(e))
      if (status === null) {
        results.push({ ...c, verdict: 'SKIP', reason: '子进程未起来（环境限制，见 AGENTS §5.5）' })
      } else if (c.expect.length === 0) {
        // 缺期望绝不等于通过：否则「什么都不写」就是满分（926q W1-06 实测本函数原会报 pass rc=0）
        results.push({
          ...c,
          verdict: opts.lenient ? 'SKIP' : 'FAIL',
          reason: opts.lenient
            ? '命令未带 `# 期望:`（--lenient 豁免通道，只计数不判通过）'
            : '命令未带 `# 期望:` —— 契约要求每条命令紧跟一行期望（tools/audit-kit/README.md），缺期望不可判通过',
        })
      } else if (missing.length > 0) {
        results.push({ ...c, verdict: 'FAIL', reason: `期望未出现: ${missing.join(' | ')}` })
      } else {
        results.push({
          ...c,
          verdict: 'PASS',
          reason: status === 0 ? '' : `stdout 匹配（退出码 ${status}，口径以 stdout 为准）`,
        })
      }
    }
  }
  return { delivered: true, results }
}

/** 汇总口径：任一条 FAIL 即整体不通过；SKIP 只计数不判红绿 */
export function summarize(results) {
  const n = (v) => results.filter((r) => r.verdict === v).length
  return { total: results.length, pass: n('PASS'), fail: n('FAIL'), skip: n('SKIP') }
}

function main() {
  const args = process.argv.slice(2)
  const file = args.find((a) => !a.startsWith('--'))
  if (!file) {
    console.error(
      '用法: node tools/audit-kit/verify-window.mjs <window.md> [--section 0] [--cwd .] [--lenient]'
    )
    process.exit(2)
  }
  const secIdx = args.indexOf('--section')
  const section = secIdx >= 0 ? Number(args[secIdx + 1]) : 0
  const cwdIdx = args.indexOf('--cwd')
  const cwd = cwdIdx >= 0 ? args[cwdIdx + 1] : process.cwd()
  const lenient = args.includes('--lenient')
  if (lenient)
    console.log(
      '[audit-kit] --lenient：缺 `# 期望:` 的命令记 SKIP 不判 FAIL —— 回算历史件用，不得用于交件门槛'
    )

  const { delivered, results, reason } = verifyWindow(fs.readFileSync(file, 'utf8'), {
    section,
    cwd,
    lenient,
  })
  if (!delivered) {
    console.error(`[audit-kit] ${file} 判【未交付】：${reason}`)
    console.error('  窗口件必须把判据放进 bash 围栏，否则结论无法被独立复算。')
    process.exit(1)
  }
  const s = summarize(results)
  for (const r of results) {
    if (r.verdict !== 'PASS') console.log(`  ${r.verdict}  ${r.cmd}\n       ${r.reason}`)
  }
  console.log(
    `[audit-kit] ${file}  §${section}: total=${s.total} pass=${s.pass} fail=${s.fail} skip=${s.skip}`
  )
  process.exit(s.fail > 0 ? 1 : 0)
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
if (isMain) main()
