#!/usr/bin/env node
/**
 * run-all.mjs — 预测域「可复算交付」的一键入口（方案 §2-L6 / §4）。
 *
 * ## 为什么需要它
 *
 * 论文答辩的第一个问题是"结果可复现吗"。此前复算要靠人肉记住"先跑 model、再跑
 * activity、数字在哪个产物字段里"——散件没有单一入口，也没有"这次算的是哪份输入"的痕迹。
 * 本脚本把这条链收成一个命令，并产出可核对的**指纹 + 报告**。
 *
 * ## 做什么（一条命令）
 *
 * 1. 记录输入指纹：源文件 md5 + 覆盖时间范围（从 JSON 里的 YYYY-MM 字面量取 min/max）；
 * 2. 跑模型：`throughput_model.cjs`（cargo + container 两份产物）；
 * 3. 跑派生：`derive-activity.mjs`（活跃度指标）；
 * 4. 记录产物指纹，落 `out/fingerprint.json`（含生成时间戳——**时间戳只进指纹，不进产物**，
 *    这样产物才可能逐字节一致）；
 * 5. 生成 `out/report.md`：输入指纹表 + 每港每指标的"论文数字 → 产物字段"映射表。
 *
 * ## 确定性
 *
 * 模型与派生脚本全程无随机数、无 Date（2026-10-03 实测 `grep -n "Date|now(" = 0`），
 * 因此同输入两次运行产物应逐字节一致。验证方式见 README「复算」节。
 *
 * ## 用法
 *
 *   node tools/forecast/run-all.mjs              # 复算并写 out/
 *   node tools/forecast/run-all.mjs --check      # 只比指纹，不改任何产物（对不上即 exit 1）
 *   node tools/forecast/run-all.mjs --skip-model # 跳过模型/派生（只重算指纹与报告）
 */
import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(HERE, '..', '..')
const DATA_DIR = path.join(ROOT, 'backend', 'data', 'forecast')

/** 输入（源真数据）——顺序固定，保证报告与指纹稳定 */
export const SOURCES = ['cargo.json', 'container.json']
/** 产物（模型生成）——顺序对应 SOURCES */
export const MODEL_ARTIFACTS = [
  { file: 'throughput_model.json', indicator: 'cargo' },
  { file: 'container_model.json', indicator: 'container' },
]
/** 派生产物 */
export const DERIVED_ARTIFACTS = ['activity.json']

/** 读文件 → md5（十六进制） */
export function md5Of(buf) {
  return createHash('md5').update(buf).digest('hex')
}

/** 从任意 JSON 文本里取所有 YYYY-MM 字面量的 min/max（不猜结构） */
export function monthRangeOf(text) {
  const found = String(text).match(/\d{4}-\d{2}/g)
  if (!found || found.length === 0) return null
  const sorted = [...found].sort()
  return { from: sorted[0], to: sorted[sorted.length - 1], count: found.length }
}

/** 收集输入指纹 */
export function collectSources(dataDir = DATA_DIR) {
  return SOURCES.map((file) => {
    const p = path.join(dataDir, file)
    if (!fs.existsSync(p)) throw new Error('缺少输入文件：' + p)
    const text = fs.readFileSync(p, 'utf8')
    return {
      file,
      md5: md5Of(Buffer.from(text)),
      bytes: Buffer.byteLength(text),
      range: monthRangeOf(text),
    }
  })
}

/** 收集产物指纹（不存在的产物记为 null，交由调用方判定） */
export function collectArtifacts(files, dataDir = DATA_DIR) {
  return files.map((f) => {
    const file = typeof f === 'string' ? f : f.file
    const p = path.join(dataDir, file)
    if (!fs.existsSync(p)) return { file, md5: null, bytes: 0 }
    const buf = fs.readFileSync(p)
    return { file, md5: md5Of(buf), bytes: buf.length }
  })
}

/** 从产物里派生"论文数字 → 字段"映射（**由产物结构派生，不手写清单**） */
export function buildFieldMap(artifact, sourceName) {
  const rows = []
  for (const [port, p] of Object.entries(artifact.ports ?? {})) {
    const bt = p.backtest ?? {}
    const cmp = p.model_comparison ?? {}
    for (const [model, m] of Object.entries(cmp)) {
      if (typeof m?.overall_mape === 'number') {
        rows.push({
          label: port + ' 全步长 MAPE（' + model + '）',
          field: sourceName + ' → ports.' + port + '.model_comparison.' + model + '.overall_mape',
          value: m.overall_mape,
        })
      }
      if (typeof m?.overall_mase === 'number') {
        rows.push({
          label: port + ' 全步长 MASE（' + model + '）',
          field: sourceName + ' → ports.' + port + '.model_comparison.' + model + '.overall_mase',
          value: m.overall_mase,
        })
      }
    }
    if (bt.selected_model !== undefined) {
      rows.push({
        label: port + ' 选中模型',
        field: sourceName + ' → ports.' + port + '.backtest.selected_model',
        value: bt.selected_model,
      })
    }
    if (bt.validation_overall_mape !== undefined) {
      rows.push({
        label: port + ' 验证期 MAPE',
        field: sourceName + ' → ports.' + port + '.backtest.validation_overall_mape',
        value: bt.validation_overall_mape,
      })
    }
    for (const [step, v] of Object.entries(bt.rolling_mape_by_step ?? {})) {
      rows.push({
        label: port + ' h' + step + ' MAPE',
        field: sourceName + ' → ports.' + port + '.backtest.rolling_mape_by_step.' + step,
        value: v,
      })
    }
    if (bt.correction_factor !== undefined) {
      rows.push({
        label: port + ' 偏差校正系数',
        field: sourceName + ' → ports.' + port + '.backtest.correction_factor',
        value: bt.correction_factor,
      })
    }
  }
  return rows
}

/** 渲染报告（纯函数，便于测试） */
export function renderReport({ sources, artifacts, fieldRows, generatedAt, determinism }) {
  const lines = []
  lines.push('# 预测域复算报告（L6）')
  lines.push('')
  lines.push(
    '> 由 `node tools/forecast/run-all.mjs` 生成；数字全部由产物派生，**不改写、不手填**。'
  )
  lines.push(
    '> 生成时间：' +
      generatedAt +
      '（时间戳只进本报告与 fingerprint.json，**不进产物**，否则无法逐字节复现）'
  )
  lines.push('')
  lines.push('## 一、输入指纹')
  lines.push('')
  lines.push('| 文件 | md5 | 字节 | 覆盖月份 |')
  lines.push('| --- | --- | --- | --- |')
  for (const s of sources) {
    const r = s.range ? s.range.from + ' ~ ' + s.range.to : '（无 YYYY-MM 字面量）'
    lines.push('| `' + s.file + '` | `' + s.md5 + '` | ' + s.bytes + ' | ' + r + ' |')
  }
  lines.push('')
  lines.push('## 二、产物指纹')
  lines.push('')
  lines.push('| 文件 | md5 | 字节 |')
  lines.push('| --- | --- | --- |')
  for (const a of artifacts) lines.push('| `' + a.file + '` | `' + a.md5 + '` | ' + a.bytes + ' |')
  lines.push('')
  if (determinism) {
    lines.push('## 三、确定性校验')
    lines.push('')
    lines.push('- ' + determinism)
    lines.push('')
  }
  lines.push('## 四、论文数字 → 产物字段（' + fieldRows.length + ' 条，全部由产物结构派生）')
  lines.push('')
  lines.push('| 论文里的数字 | 产物字段路径 | 当前值 |')
  lines.push('| --- | --- | --- |')
  for (const r of fieldRows) lines.push('| ' + r.label + ' | `' + r.field + '` | ' + r.value + ' |')
  lines.push('')
  return lines.join('\n')
}

/**
 * 复算结论（**纯函数**：把"不许把变化说成一致"钉成可红判据）。
 *
 * 2026-10-03 变异实测的教训：这段判断原先内联在 main() 里，测件只能把字符串当输入传进去，
 * 于是"把 ⚠️ 分支改成 ✅"这种退化**不会变红**（假绿）。抽成纯函数后，
 * 变异"把变化说成一致"会立即被 `determinismVerdict` 的用例抓住。
 */
export function determinismVerdict(before, after) {
  const changed = after.filter((a) => {
    const b = before.find((x) => x.file === a.file)
    return b && b.md5 !== a.md5
  })
  if (changed.length === 0) {
    return '✅ 复算后产物与运行前**逐字节一致**（' + after.length + ' 份）⇒ 同输入可复现'
  }
  return (
    '⚠️ 产物发生变化：' + changed.map((c) => c.file).join('、') + '（若为预期升级，请在提交里说明）'
  )
}

function runStep(label, args) {
  process.stdout.write('[run-all] ' + label + ' ... ')
  const r = spawnSync(process.execPath, args, { cwd: ROOT, stdio: ['ignore', 'pipe', 'inherit'] })
  if (r.status !== 0) {
    process.stdout.write('FAILED\n')
    throw new Error(label + ' 退出码 ' + r.status)
  }
  process.stdout.write('ok\n')
}

function main() {
  const argv = process.argv.slice(2)
  const check = argv.includes('--check')
  const skipModel = argv.includes('--skip-model')
  const outIdx = argv.indexOf('--out')
  const outDir = path.resolve(outIdx >= 0 ? argv[outIdx + 1] : path.join(HERE, 'out'))
  fs.mkdirSync(outDir, { recursive: true })

  const sources = collectSources()
  // 快照必须在"跑之前"取，且**含全部产物**（原实现只取模型两份 + 按下标比对，
  // 会漏掉 activity.json 这类派生产物的变化——2026-10-03 实测发现并修正）
  const allArtifactFiles = [...MODEL_ARTIFACTS, ...DERIVED_ARTIFACTS.map((file) => ({ file }))]
  const before = collectArtifacts(allArtifactFiles, DATA_DIR)

  if (!skipModel) {
    runStep('模型（cargo + container）', [path.join(HERE, 'throughput_model.cjs')])
    runStep('派生（活跃度）', [path.join(HERE, 'derive-activity.mjs')])
  }

  const artifacts = collectArtifacts(allArtifactFiles, DATA_DIR)
  const generatedAt = new Date().toISOString()

  // 确定性：与"跑之前"的产物 md5 比对（结论由纯函数给出，见 determinismVerdict）
  const determinism = skipModel ? null : determinismVerdict(before, artifacts)

  // 字段映射（由 cargo 产物派生；container 产物同构，凡存在即列出）
  const fieldRows = []
  for (const a of MODEL_ARTIFACTS) {
    const p = path.join(DATA_DIR, a.file)
    if (!fs.existsSync(p)) continue
    fieldRows.push(...buildFieldMap(JSON.parse(fs.readFileSync(p, 'utf8')), a.file))
  }

  const report = renderReport({ sources, artifacts, fieldRows, generatedAt, determinism })

  if (check) {
    const fpPath = path.join(outDir, 'fingerprint.json')
    if (!fs.existsSync(fpPath)) {
      console.error('[run-all] --check 需要先跑一次生成 ' + fpPath)
      process.exit(1)
    }
    const prev = JSON.parse(fs.readFileSync(fpPath, 'utf8'))
    const bad = []
    for (const a of artifacts) {
      const old = prev.artifacts.find((x) => x.file === a.file)
      if (!old || old.md5 !== a.md5)
        bad.push(a.file + '（' + (old ? old.md5 + ' → ' + a.md5 : '缺失') + '）')
    }
    for (const s of sources) {
      const old = prev.sources.find((x) => x.file === s.file)
      if (!old || old.md5 !== s.md5) bad.push(s.file + '（输入指纹变了）')
    }
    if (bad.length) {
      console.error('[run-all] --check 失败：' + bad.join('；'))
      process.exit(1)
    }
    console.log(
      '[run-all] --check 通过：输入与产物指纹与记录一致（' + artifacts.length + ' 份产物）'
    )
    return
  }

  fs.writeFileSync(
    path.join(outDir, 'fingerprint.json'),
    JSON.stringify({ generatedAt, sources, artifacts }, null, 2) + '\n'
  )
  fs.writeFileSync(path.join(outDir, 'report.md'), report)
  console.log('[run-all] 产物指纹 + 报告已写入 ' + outDir)
  console.log(
    '[run-all] 字段映射 ' +
      fieldRows.length +
      ' 条；' +
      (determinism ?? '（跳过模型，未做确定性校验）')
  )
}

const invokedDirectly =
  process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
if (invokedDirectly) main()
