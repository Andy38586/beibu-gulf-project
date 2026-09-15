#!/usr/bin/env node
/**
 * 覆盖率棘轮（CI-CD 审查 C5）：以基线文件比较取代全局固定阈值——
 * 大版本迭代源码分母暴涨时，固定百分比阈值"第一次 CI 必红"的机制性追尾被根除；
 * 棘轮只拦"相对基线的实质回退"，覆盖率增长由 --update 写回基线（只升不降语义见下）。
 *
 * 用法:
 *   node scripts/coverage-ratchet.cjs <coverage-summary.json> <baseline.json>          # CI 检查模式
 *   node scripts/coverage-ratchet.cjs <coverage-summary.json> <baseline.json> --update # 本地写回模式
 *
 * coverage-summary.json 为 vitest --coverage (provider=v8, reporter 含 json-summary) 产物，
 * 形如 { total: { lines: {pct}, statements: {...}, functions: {...}, branches: {...} } }。
 *
 * 判定（TOLERANCE = 0.5pt，容差吸收平台/顺序差异）：
 *   检查模式：任一指标 < 基线 - 0.5 → exit 1（并列出回退项）；否则 exit 0
 *   写回模式：先按检查模式判定，通过后把基线更新为"逐项 max(基线, 本次)"——
 *            只接受增长，不接受"本次略高但彼项回退"的混合态整体覆写
 */
const fs = require('node:fs')
const path = require('node:path')

const TOLERANCE = 0.5
const METRICS = ['lines', 'functions', 'branches', 'statements']

const [, , summaryPath, baselinePath, flag] = process.argv
if (!summaryPath || !baselinePath) {
  console.error(
    '用法: node scripts/coverage-ratchet.cjs <coverage-summary.json> <baseline.json> [--update]'
  )
  process.exit(2)
}

const summary = JSON.parse(fs.readFileSync(summaryPath, 'utf8'))
const baselineFile = path.resolve(baselinePath)

// 读取基线：**只有 ENOENT（文件确实不存在）才算首跑**；不可读/JSON 语法错必须报错。
// 修复（EP-09/P1-06，2026-09-15）：原实现把「文件不存在」与「JSON 解析失败」放进同一个 catch，
// 二者都退化为 baseline=null → 重建并 exit 0 ⇒ 把基线改成坏 JSON 即可绕过覆盖率门禁。
let baseline = null
let baselineRaw = null
try {
  baselineRaw = fs.readFileSync(baselineFile, 'utf8')
} catch (e) {
  if (e && e.code === 'ENOENT') {
    baselineRaw = null // 真·首跑
  } else {
    console.error(
      `::error::基线文件不可读（${e?.code ?? e}）：${baselineFile}\n` +
        '  基线不可读必须报错，不得当作"首跑"重建（否则即可绕过覆盖率门禁）。'
    )
    process.exit(1)
  }
}
if (baselineRaw !== null) {
  try {
    baseline = JSON.parse(baselineRaw)
  } catch (e) {
    console.error(
      `::error::基线文件 JSON 解析失败（${baselinePath}）：${e.message}\n` +
        '  基线损坏必须报错，不得当作"首跑"重建（否则删/坏基线即可绕过覆盖率门禁）。'
    )
    process.exit(1)
  }
}

const current = {}
for (const m of METRICS) {
  const pct = summary.total?.[m]?.pct
  if (typeof pct !== 'number') {
    console.error(`::error::coverage-summary 缺少 total.${m}.pct（reporter 是否含 json-summary？）`)
    process.exit(2)
  }
  current[m] = pct
}

if (!baseline) {
  // 修复（EP-09/P1-06）：**CI 检查模式（未带 --update）禁止写盘**——否则删除基线文件即可让
  // 门禁静默重建并通过。首跑建档须由人显式 `--update` 执行并把基线文件提交入库。
  if (flag !== '--update') {
    console.error(
      `::error::基线文件不存在（${baselinePath}）且未带 --update：\n` +
        '  CI 检查模式禁止重建基线（否则删除基线即可绕过覆盖率门禁）。\n' +
        '  首次建档请本地执行：node scripts/coverage-ratchet.cjs <summary> <baseline> --update'
    )
    process.exit(1)
  }
  fs.writeFileSync(
    baselineFile,
    JSON.stringify({ ...current, updated: new Date().toISOString().slice(0, 10) }, null, 2) + '\n'
  )
  console.log(`[ratchet] 基线不存在，已按本次实测建档（--update）: ${baselinePath}`)
  console.log(JSON.stringify(current))
  process.exit(0)
}

// 基线 schema 校验：丢键/非数值会让 `baseline[m] - TOLERANCE` 得 NaN、
// 比较恒 false → 检查模式静默放行；--update 时 Math.max(undefined, x) 写出 null
// 静默损坏基线。故读入后显式校验，坏基线必须报错而不是装作通过。
const invalidMetrics = METRICS.filter(
  (m) => typeof baseline[m] !== 'number' || Number.isNaN(baseline[m])
)
if (invalidMetrics.length > 0) {
  console.error(
    `::error::基线文件损坏：指标 ${invalidMetrics.join('/')} 缺失或非数值（${baselinePath}）。` +
      `请修复该文件，或删除后以本次实测重建基线。`
  )
  process.exit(1)
}

const regressions = []
for (const m of METRICS) {
  const floor = baseline[m] - TOLERANCE
  if (current[m] < floor) {
    regressions.push(`  ${m}: 本次 ${current[m]}% < 基线 ${baseline[m]}% - ${TOLERANCE}pt 容差`)
  }
}

if (regressions.length > 0) {
  console.error('::error::覆盖率相对基线回退超容差（0.5pt）：')
  console.error(regressions.join('\n'))
  console.error('回退属实质信号，请补测试或确认删码范围；禁止调低基线规避。')
  process.exit(1)
}

if (flag === '--update') {
  const next = {}
  let changed = false
  for (const m of METRICS) {
    next[m] = Math.max(baseline[m], current[m])
    if (next[m] !== baseline[m]) changed = true
  }
  if (changed) {
    fs.writeFileSync(
      baselineFile,
      JSON.stringify({ ...next, updated: new Date().toISOString().slice(0, 10) }, null, 2) + '\n'
    )
    console.log(`[ratchet] 基线已写回（只升不降）: ${baselinePath}`)
  } else {
    console.log('[ratchet] 本次无增长，基线不变')
  }
}

console.log(
  `[ratchet] 通过: ` + METRICS.map((m) => `${m} ${current[m]}% (基线 ${baseline[m]}%)`).join(' · ')
)
