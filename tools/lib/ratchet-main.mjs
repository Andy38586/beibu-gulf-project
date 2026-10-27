import fs from 'node:fs'

/**
 * ratchet-main — 三个棘轮（dead-code / dup / deep-import）共用的 CLI 骨架（F94 收口）。
 *
 * 治的失效：parseArgs 三份手抄两份逐字相同、第三份已多出 --baseline（漂移实证）；
 * main 的 --update 分支（拒绝上调 → 强制留痕 → 追加 history → 写基线 → 汇报下调）
 * 三段 ~85% 同构。差异面（指标名、基线透传字段、处置文案、tag）全部由调用方注入；
 * compare / currentCounts / newItems 等判据本体仍留在各自守卫文件，不搬家。
 */

/**
 * 基线自洽判据（Q26）：`metric` 必须与条目列表长度、分组求和一致。
 * - 列表/分组存在但不等 ⇒ errors（compare 会红）；
 * - 老格式缺列表/分组 ⇒ warnings（不红，但 main 必须打印，不能静默跳过）。
 * spec: { metric, items?, byGroup?, tokenMetric?, byModule? }
 */
export function baselineSelfConflict(
  baseline,
  { metric, items, byGroup, tokenMetric, byModule } = {}
) {
  const errors = []
  const warnings = []
  if (!baseline || typeof baseline !== 'object') return { errors: ['基线不是对象'], warnings }
  if (!Number.isFinite(baseline[metric])) return { errors: [`基线缺数值字段 ${metric}`], warnings }
  if (items) {
    if (!Array.isArray(baseline[items])) {
      warnings.push(`基线为老格式（缺 ${items}）：跳过 ${metric} 与条目数自洽校验`)
    } else if (baseline[items].length !== baseline[metric]) {
      errors.push(
        `基线自相矛盾：${metric}=${baseline[metric]}，但 ${items}.length=${baseline[items].length}`
      )
    }
  }
  if (byGroup) {
    if (!baseline[byGroup] || typeof baseline[byGroup] !== 'object') {
      warnings.push(`基线为老格式（缺 ${byGroup}）：跳过 ${metric} 与分组求和自洽校验`)
    } else {
      const sum = Object.values(baseline[byGroup]).reduce(
        (a, c) => a + (Number.isFinite(c) ? c : 0),
        0
      )
      if (sum !== baseline[metric]) {
        errors.push(`基线自相矛盾：${metric}=${baseline[metric]}，但 Σ${byGroup}=${sum}`)
      }
    }
  }
  if (tokenMetric && byModule) {
    if (!Number.isFinite(baseline[tokenMetric])) {
      errors.push(`基线缺数值字段 ${tokenMetric}`)
    } else if (!baseline[byModule] || typeof baseline[byModule] !== 'object') {
      warnings.push(`基线为老格式（缺 ${byModule}）：跳过 ${tokenMetric} 与分组求和自洽校验`)
    } else {
      const sum = Object.values(baseline[byModule]).reduce(
        (a, c) => a + (Number.isFinite(c) ? c : 0),
        0
      )
      if (sum !== baseline[tokenMetric]) {
        errors.push(`基线自相矛盾：${tokenMetric}=${baseline[tokenMetric]}，但 Σ${byModule}=${sum}`)
      }
    }
  }
  return { errors, warnings }
}

/** main 侧打印“老格式/缺字段”降级；compare 只吃 errors，不吃 warnings。 */
export function warnBaselineDegradation(tag, baseline, spec) {
  for (const w of baselineSelfConflict(baseline, spec).warnings) {
    console.warn(`${tag} 基线降级：${w}`)
  }
}

/**
 * 棘轮 CLI 参数：--update 开关 + --note/--kind 取值 + 额外取值旗标（如 --baseline）。
 * extraValueFlags 传旗标名（不带 --），解析结果放在同名键上，缺省 null。
 */
export function parseRatchetArgs(argv, extraValueFlags = []) {
  const out = { update: false, note: null, kind: null }
  for (const f of extraValueFlags) out[f] = null
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--update') out.update = true
    else if (argv[i] === '--note') out.note = argv[++i]
    else if (argv[i] === '--kind') out.kind = argv[++i]
    else {
      const hit = extraValueFlags.find((f) => argv[i] === `--${f}`)
      if (hit) out[hit] = argv[++i]
    }
  }
  return out
}

/**
 * --update 分支骨架。history 条目形状 = { at, ...historyMetrics, kind, note }
 * （三个棘轮的既有基线 history 均为此序，字段顺序不许变——棘轮测试按形状校验）。
 * nextBaseline 由调用方拼好（generatedFrom / 指标 / 透传字段），updatedAt 与 history 在此追加。
 */
export function applyRatchetUpdate({
  tag,
  baselinePath,
  baseline,
  bad,
  args,
  historyMetrics,
  nextBaseline,
  downMessage,
  rejectAdvice,
  noteAdvice,
}) {
  if (bad.length) {
    console.error(`${tag} 拒绝 --update：当前值高于基线。`)
    console.error(rejectAdvice)
    bad.forEach((b) => console.error('  - ' + b))
    process.exit(1)
  }
  // 强制留痕：数字下降有两种来源（真清理 / 口径调整），不区分就说不清「到底清了几个」
  if (!args.note) {
    console.error(`${tag} --update 必须带 --note="为什么下调"。`)
    console.error(noteAdvice)
    process.exit(1)
  }
  const history = [
    ...(baseline.history ?? []),
    {
      at: new Date().toISOString().slice(0, 10),
      ...historyMetrics,
      kind: args.kind ?? '未标注',
      note: args.note,
    },
  ]
  const next = { ...nextBaseline, updatedAt: new Date().toISOString().slice(0, 10), history }
  fs.writeFileSync(baselinePath, JSON.stringify(next, null, 2) + '\n')
  console.log(`${tag} 基线已下调：${downMessage}`)
  console.log(`  [${history.at(-1).kind}] ${args.note}`)
}

/**
 * 校验分支的红出口：FAIL 头 + 逐条 + （可选）新增点名行 + （可选）处置提示。
 * deep-import 的「同数替换点名」排在 extraLines（bad 之后、exit 之前）；dead-code/dup 只传 advice。
 */
export function failRatchet(tag, bad, { extraLines = [], advice } = {}) {
  console.error(`${tag} FAIL：${bad.length} 处上涨（基线只许下降或持平）`)
  bad.forEach((b) => console.error('  - ' + b))
  for (const l of extraLines) console.error(l)
  if (advice) console.error(advice)
  process.exit(1)
}
