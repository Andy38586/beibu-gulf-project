// F81 / F82 / F84 复核判据（2026-10-26）：把「表驱动之后」的四席分支、两类回测来源、
// 九项累加器清单逐类钉住。
//
// ## 为什么非有它不可
//
// 分支表在 b2746a7e 落地后，真实数据上**只有 linear 与 combination 会胜出**（6 席中
// 北海货/防城货留线性、其余四席组合），ets 与 seasonal_naive 两个分支一次都跑不到。
// 于是「把 `harness: etsH` 抄成 `snH`」「candidateBacktest('ets', snH)」这类错抄
// 没有任何判据会红——产物只在**下次有人重跑并 diff** 时才暴露，而两次重跑之间可能隔几个月。
// 本文件用 `overrideWinner` 把四席各强制跑一遍，断言：
//   ① 字段集与**键序**（JSON.stringify 的字节序，产物字节不变的前提）；
//   ② 回测来源：linear 走 legacy `rollingBacktest`、候选走同协议 harness，且
//      backtest 与 model_comparison 必须**取同一份 harness**（错抄即两者脱钩）；
//   ③ 线性专有口径（validation/bias/correction）在候选席上必须是 null（不伪造）；
//   ④ 四席之间不得互相冒充（区间偏移/PICP 两两不同）。
//
// ## 输入
//
// `backend/data/forecast/cargo.json` 是**受版本控制**的真数据（AGENTS §5.4：判据输入必须
// 入库，不得读 gitignored 路径），故此处直接读它而不用合成夹具——钉的正是生产那三港。

import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import fs from 'node:fs'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

import bt from '../lib/backtest.cjs'
import model from '../throughput_model.cjs'

const { processPort, rollingBacktest, futureTargets, ROLLING_HORIZON } = model
const { STEP_ACCUMULATORS, createStepAccumulators, runRollingBacktest } = bt

const ROOT = fileURLToPath(new URL('../../../', import.meta.url))
const DATA = JSON.parse(
  fs.readFileSync(new URL('../../../backend/data/forecast/cargo.json', import.meta.url), 'utf8')
)
const PORTS = Object.keys(DATA.data)
/** 钦州货：真实闸门胜者 = combination（README 实测精度表），用作「默认路径」对照 */
const PORT = 'qinzhou'
/** 每例独立副本：processPort 就地排序，共享数组会让用例顺序影响结果 */
const hist = (port = PORT) => structuredClone(DATA.data[port].historical)

/** 候选席字段**顺序**（= candidateBacktest 返回序，即 JSON 字节序） */
const CANDIDATE_KEYS = [
  'selected_model',
  'rolling_mape_by_step',
  'rolling_samples_by_step',
  'rolling_picp_by_step',
  'overall_picp',
  'interval_offsets',
  'validation_overall_mape',
  'bias',
  'correction_factor',
]
/** 线性席字段顺序：多 validation_months，且 validation/bias/correction 为真值 */
const LINEAR_KEYS = [
  'selected_model',
  'validation_overall_mape',
  'validation_months',
  'rolling_mape_by_step',
  'rolling_samples_by_step',
  'rolling_picp_by_step',
  'overall_picp',
  'interval_offsets',
  'bias',
  'correction_factor',
]

const run = (winner) => processPort(PORT, hist(), winner)

describe('F82 winner 分支表：默认仍走闸门（overrideWinner 不得成为默认）', () => {
  it('不传 overrideWinner ⇒ 胜者由 selectModel 决定（钦州货 = combination）', () => {
    const r = processPort(PORT, hist())
    expect(r.backtest.selected_model).toBe('combination')
    expect(r.modelComparison.selected).toBe('combination')
  })

  it('未知胜者名回落到线性席（`?? WINNER_BRANCHES.linear` 兜底不被删）', () => {
    const r = processPort(PORT, hist(), 'no_such_model')
    expect(r.backtest.selected_model).toBe('linear')
  })
})

describe('F82 winner 分支表：四席逐类（含 ③ 不伪造 ④ 不互相冒充）', () => {
  it('linear 席：回测取 legacy rollingBacktest（基线数字不因升级漂移）', () => {
    const r = run('linear')
    expect(Object.keys(r.backtest)).toEqual(LINEAR_KEYS)
    // ② linear 的特有来源：分步长 MAPE/samples 必须等于原实现重算值，不是 harness 的
    const legacy = rollingBacktest(hist())
    expect(r.backtest.rolling_mape_by_step).toEqual(legacy.mapeByStep)
    expect(r.backtest.rolling_samples_by_step).toEqual(legacy.cntByStep)
    // ③ 线性专有口径齐备（候选席为 null，见下三例）
    expect(r.backtest.validation_months).toBeGreaterThan(0)
    expect(Number.isFinite(r.backtest.validation_overall_mape)).toBe(true)
    expect(Number.isFinite(r.backtest.correction_factor)).toBe(true)
    expect(['underpredict', 'overpredict', 'balanced']).toContain(r.backtest.bias)
  })

  it.each(['ets', 'seasonal_naive', 'combination'])(
    '%s 席：候选口径 + 线性专有项为 null + backtest 与 model_comparison 同源同一份 harness',
    (winner) => {
      const r = run(winner)
      expect(Object.keys(r.backtest)).toEqual(CANDIDATE_KEYS)
      expect(r.backtest.selected_model).toBe(winner)
      expect(r.modelComparison.selected).toBe(winner)
      // ③ 线性专有口径不适用于候选路径 ⇒ 置 null 而非抄一个数（04-B7）
      expect(r.backtest.validation_overall_mape).toBeNull()
      expect(r.backtest.bias).toBeNull()
      expect(r.backtest.correction_factor).toBeNull()
      // ② 关键：backtest 与对比表必须取同一 harness。把 candidateBacktest 的 harness 抄成
      //    别人的，这两处立刻脱钩（例如 ets 的点值配 sn 的区间偏移）。
      const mcKey = winner === 'ets' ? 'ets_damped' : winner
      expect(r.backtest.rolling_mape_by_step).toEqual(r.modelComparison[mcKey].mape_by_step)
      expect(r.backtest.overall_picp).toBe(r.modelComparison[mcKey].overall_picp)
      // 区间偏移只能来自本席回测（四席两两不同，见下一条）
      expect(r.backtest.interval_offsets).not.toBeNull()
    }
  )

  it('④ 四席互不冒充：interval_offsets 与 overall_picp 两两不同', () => {
    const winners = ['linear', 'ets', 'seasonal_naive', 'combination']
    const rows = winners.map((w) => run(w))
    const offsets = rows.map((r) => JSON.stringify(r.backtest.interval_offsets))
    expect(new Set(offsets).size).toBe(winners.length)
    const picps = rows.map((r) => r.backtest.overall_picp)
    expect(new Set(picps).size).toBe(winners.length)
    // 点值也必须分化：分支表若被抄成同一 fit，预测序列会逐字相同
    const preds = rows.map((r) => JSON.stringify(r.predictions))
    expect(new Set(preds).size).toBe(winners.length)
  })

  it('四席共用同一预测骨架：futureTargets 24 点、字段序 time/value/lower/upper、整数值', () => {
    for (const w of ['linear', 'ets', 'seasonal_naive', 'combination']) {
      const r = run(w)
      expect(r.predictions).toHaveLength(24)
      expect(Object.keys(r.predictions[0])).toEqual(['time', 'value', 'lower', 'upper'])
      for (const p of r.predictions) {
        expect(Number.isInteger(p.value)).toBe(true)
        expect(Number.isInteger(p.lower)).toBe(true)
        expect(Number.isInteger(p.upper)).toBe(true)
      }
    }
    expect(futureTargets('2026-06')).toHaveLength(24)
  })
})

describe('F81 candidateBacktest 单源：三候选席字段集恒等，只有 selected_model 不同', () => {
  it('ets / seasonal_naive / combination 的 backtest 键序与键值类型逐字一致', () => {
    const rows = ['ets', 'seasonal_naive', 'combination'].map((w) => run(w).backtest)
    for (const row of rows) expect(Object.keys(row)).toEqual(CANDIDATE_KEYS)
    // 除 selected_model 外，其余字段的"形状"（null 与否）必须一致
    for (const key of CANDIDATE_KEYS.filter((k) => k !== 'selected_model')) {
      const shapes = rows.map((r) => r[key] === null)
      expect(new Set(shapes).size, key).toBe(1)
    }
  })
})

describe('F82 model_comparison 指标行：键序（字节序）与行尾独有字段', () => {
  const METRIC_ROW = [
    'overall_mape',
    'overall_mase',
    'overall_smape',
    'overall_picp',
    'mape_by_step',
    'mase_by_step',
  ]

  it('四席指标行前六键同序；ETS 追加 params/seasonal_type，组合追加 final_weights/member_mape', () => {
    const mc = run('combination').modelComparison
    expect(Object.keys(mc)).toEqual([
      'protocol',
      'linear',
      'ets_damped',
      'seasonal_naive',
      'combination',
      'dm_vs_linear',
      'selected',
    ])
    expect(Object.keys(mc.linear)).toEqual(METRIC_ROW)
    expect(Object.keys(mc.seasonal_naive)).toEqual(METRIC_ROW)
    expect(Object.keys(mc.ets_damped)).toEqual([...METRIC_ROW, 'params', 'seasonal_type'])
    expect(Object.keys(mc.combination)).toEqual([...METRIC_ROW, 'final_weights', 'member_mape'])
  })
})

describe('F84 分步长累加器清单：九项唯一真值（加指标必须同改清单与汇总）', () => {
  // 硬编码而非 import STEP_ACCUMULATORS：本判据的作用就是"别人加了第十项也必须来这里登记"，
  // 否则「清单加了、汇总忘加」只会在产物里以 NaN/缺字段的形式静默出现。
  const EXPECTED = [
    'err',
    'absErr',
    'cnt',
    'qSum',
    'qCnt',
    'smapeSum',
    'smapeCnt',
    'picpHit',
    'picpCnt',
  ]

  it('清单恰为九项且顺序与历史声明序一致', () => {
    expect([...STEP_ACCUMULATORS]).toEqual(EXPECTED)
  })

  it('工厂为每项建「step → 0」表，无漏项（horizon=1/12 两端）', () => {
    for (const horizon of [1, ROLLING_HORIZON]) {
      const acc = createStepAccumulators(horizon)
      expect(Object.keys(acc)).toEqual(EXPECTED)
      for (const name of EXPECTED) {
        expect(Object.keys(acc[name])).toHaveLength(horizon)
        for (let s = 1; s <= horizon; s++) expect(acc[name][s]).toBe(0)
      }
    }
  })

  it('回测返回值里九项都被消费：samplesByStep 覆盖全步长、四指标为 number|null（无 NaN/undefined）', () => {
    const histFixture = Array.from({ length: 36 }, (_, i) => ({
      time: `${2021 + Math.floor(i / 12)}-${String((i % 12) + 1).padStart(2, '0')}`,
      value: 100 + i,
    }))
    const r = runRollingBacktest({
      historical: histFixture,
      fitFn: () => ({}),
      forecastFn: () => 101,
      originStart: '2022-01',
      originEnd: '2022-06',
      horizon: 6,
    })
    expect(Object.keys(r.samplesByStep)).toEqual(['1', '2', '3', '4', '5', '6'])
    for (let s = 1; s <= 6; s++) {
      expect(Number.isFinite(r.samplesByStep[s])).toBe(true)
      for (const metric of [r.mapeByStep, r.smapeByStep, r.maseByStep]) {
        const v = metric[s]
        expect(v === null || Number.isFinite(v), `step ${s}`).toBe(true)
      }
    }
  })
})

describe('模块副作用隔离：require 不得重写 backend/data 产物', () => {
  const ARTIFACTS = ['throughput_model.json', 'container_model.json'].map(
    (f) => new URL(`../../../backend/data/forecast/${f}`, import.meta.url)
  )
  const sha = (u) => createHash('sha256').update(fs.readFileSync(u)).digest('hex')

  it('require.main 守卫在位：子进程 require 后两份产物 sha256 不变', () => {
    const before = ARTIFACTS.map(sha)
    const res = spawnSync(
      process.execPath,
      ['-e', "require('./tools/forecast/throughput_model.cjs')"],
      { cwd: ROOT, encoding: 'utf8' }
    )
    expect(res.status, res.stderr).toBe(0)
    expect(ARTIFACTS.map(sha)).toEqual(before)
  })
})
