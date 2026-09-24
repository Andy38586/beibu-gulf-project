#!/usr/bin/env node
/**
 * guard-red-sample — 守卫红样自证（元守卫）。
 *
 * 治的是「判据型空转」：守卫在跑、也在绿，但它**从未被证明"在违例时会红"**。
 * 实测（2026-09-24）：17 个 v3 守卫里 4 个连 test 文件都没有；有 test 的那批里，
 * 靠 grep「红样本 / 违例 / 必红」这类**标签**去判断也靠不住 —— 本文件第一版就这么量过，
 * 把 constants-audit 明明已经有的逐档对账用例漏判成「无红样」（它用的词是「漂移」）。
 * ⇒ 红样必须是**结构化声明**，不能是形容词。
 *
 * 约定
 *   每个 `tools/v3-guard/<name>.mjs` 的测试 `tools/v3-guard/__tests__/<name>.test.mjs`
 *   里，至少要有一条标了 `@guard-red-sample` 的用例。该用例必须：
 *     · 喂一个**必定违例**的输入给守卫；
 *     · 断言它**报错**（problems 非空 / rc≠0 / 抛错）。
 *   有标记但断言只覆盖正常路径 = 假绿样，本守卫查不出（那要靠变异探针），
 *   但至少把「有没有人对红样负责」变成可执行的。
 *
 * 棘轮：BASELINE 登记当前尚无红样的守卫，只告警不判红；**不在 BASELINE 又缺红样 ⇒ 红**。
 * 存量随补随减，基线逐轮下调。新增守卫一律不得直接进 BASELINE。
 *
 * 用法：node tools/v3-guard/guard-red-sample.mjs
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const GUARD_DIR = path.join(ROOT, 'tools/v3-guard')
const TEST_DIR = path.join(GUARD_DIR, '__tests__')
export const MARKER = '@guard-red-sample'

/**
 * 棘轮基线：当前尚无红样的守卫（逐项登记，不许悄悄扩大）。
 * 每补一条红样就从这里删一项；新增守卫不得直接进本表。
 */
export const BASELINE = [
  // 真·空。每一次往里加名字，都必须同时补一条红样——否则就是给「红样被摘掉」开后门：
  // 本表里的守卫即使标记消失也只会被告警、不判红，于是它的红样可以静默消失。
  // （2026-09-25 实测过这个洞：数组里残留 8 项时，摘掉其中任一项的标记，守卫仍然绿。）
  // 新增守卫一律不得进本表 —— 缺红样即红。
]

/** 枚举守卫名（排除测试目录、lib、本守卫自身） */
export function listGuards(dir = GUARD_DIR) {
  if (!fs.existsSync(dir)) return []
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith('.mjs'))
    .map((f) => path.basename(f, '.mjs'))
    .filter((n) => n !== 'guard-red-sample')
    .sort()
}

/** 该守卫的红样状态：'ok' | 'no-test' | 'no-red-sample' */
export function redSampleState(name, { guardDir = GUARD_DIR, testDir = TEST_DIR } = {}) {
  if (!fs.existsSync(path.join(guardDir, `${name}.mjs`))) return 'missing-guard'
  const testFile = path.join(testDir, `${name}.test.mjs`)
  if (!fs.existsSync(testFile)) return 'no-test'
  // 标记必须落在某条用例上（与 `it(` 同行）：否则"文件里出现过这个词"就能过 —— 那是自欺，
  // 而本守卫存在的理由正是把「有没有人对红样负责」从形容词变成可执行判定。
  const lines = fs.readFileSync(testFile, 'utf8').split(/\r?\n/)
  return lines.some((l) => l.includes(MARKER) && /\bit\s*\(/.test(l)) ? 'ok' : 'no-red-sample'
}

/** 审计：返回问题列表（空 = 通过） */
export function auditRedSamples(names, opts = {}) {
  const baseline = opts.baseline ?? BASELINE
  const problems = []
  for (const n of names) {
    const st = redSampleState(n, opts)
    if (st === 'ok') continue
    const why = st === 'no-test' ? '没有 test 文件' : 'test 里没有 @guard-red-sample 用例'
    if (baseline.includes(n)) {
      // 棘轮存量：不判红，但每次都要被看见
      console.log(`  ⚠  [存量] ${n}：${why}`)
    } else {
      problems.push(`✗ ${n}：${why} —— 未交付红样等于该守卫未交付（04-F1）`)
    }
  }
  return problems
}

function main() {
  const names = listGuards()
  const problems = auditRedSamples(names)
  const total = names.length
  const missing = names.filter((n) => redSampleState(n) !== 'ok')
  if (problems.length === 0) {
    console.log(
      `[guard-red-sample] OK：${total} 个守卫中 ${total - missing.length} 个已交付红样，` +
        `${missing.length} 个在棘轮基线上（不得新增）`
    )
    return
  }
  console.error(`[guard-red-sample] FAIL：${problems.length} 个守卫缺红样且不在基线`)
  for (const p of problems) console.error(`  ${p}`)
  process.exit(1)
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
if (isMain) main()
