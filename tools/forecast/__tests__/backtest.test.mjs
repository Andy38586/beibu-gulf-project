import { describe, expect, it } from 'vitest'

import bt from '../lib/backtest.cjs'
import { createWeightTracker } from '../lib/combination.cjs'

const {
  runRollingBacktest,
  seasonalNaiveModel,
  seasonalNaiveForecast,
  quantileSorted,
  intervalBounds,
  selectModel,
  addMonths,
  monthIndex,
} = bt

// 回测 harness 与闸门单测（2026-09-26 F2）：协议判据、MASE 尺度、闸门四式（04-B10 / 5.3）

/** 纯季节无趋势序列（seasonal-naive 的精确解）：y_m = 50 + 10·sin(2πm/12) */
function pureSeasonalFixture(months = 48) {
  const out = []
  for (let i = 0; i < months; i++) {
    const m = (i % 12) + 1
    out.push({
      time: `${2021 + Math.floor(i / 12)}-${String(m).padStart(2, '0')}`,
      value: 50 + 10 * Math.sin((2 * Math.PI * m) / 12),
    })
  }
  return out
}

/** 季节 + 线性趋势序列（朴素法必输、带趋势模型应赢） */
function seasonalTrendFixture(months = 48) {
  const out = []
  for (let i = 0; i < months; i++) {
    const m = (i % 12) + 1
    out.push({
      time: `${2021 + Math.floor(i / 12)}-${String(m).padStart(2, '0')}`,
      value: 100 + i * 2 + 20 * Math.sin((2 * Math.PI * m) / 12),
    })
  }
  return out
}

describe('addMonths / monthIndex 日历运算', () => {
  it('跨年进位正确', () => {
    expect(addMonths('2024-12', 1)).toBe('2025-01')
    expect(addMonths('2026-06', 12)).toBe('2027-06')
    expect(monthIndex('2026-06') - monthIndex('2025-06')).toBe(12)
  })
})

describe('runRollingBacktest 协议', () => {
  it('纯季节序列上 seasonal-naive 精确命中：全步长 MAPE = 0；Q=0 时 MASE 置 null（不伪造）', () => {
    const r = runRollingBacktest({
      historical: pureSeasonalFixture(),
      fitFn: seasonalNaiveModel,
      forecastFn: seasonalNaiveForecast,
    })
    expect(r.origins).toBeGreaterThan(0)
    for (const v of Object.values(r.mapeByStep)) {
      expect(v).toBe(0)
    }
    expect(r.overallMape).toBe(0)
    expect(r.overallMase).toBeNull()
  })

  it('季节+趋势序列：带趋势候选的 MAPE 须打赢 seasonal-naive（基准纪律的可运行样例）', () => {
    const hist = seasonalTrendFixture()
    const sn = runRollingBacktest({
      historical: hist,
      fitFn: seasonalNaiveModel,
      forecastFn: seasonalNaiveForecast,
    })
    // 线性趋势候选：训练段最小二乘拟合趋势 + 已知季节项（夹具生成式），预测续延
    const lin = runRollingBacktest({
      historical: hist,
      fitFn: (train) => {
        if (train.length < 24) return null
        const n = train.length
        let sx = 0
        let sy = 0
        let sxy = 0
        let sxx = 0
        train.forEach((d, i) => {
          sx += i
          sy += d.value
          sxy += i * d.value
          sxx += i * i
        })
        const denom = n * sxx - sx * sx
        const slope = (n * sxy - sx * sy) / denom
        const intercept = (sy - slope * sx) / n
        return { slope, intercept }
      },
      forecastFn: (model, t) => {
        const g = monthIndex(t) - monthIndex('2021-01')
        return (
          model.intercept + model.slope * g + 20 * Math.sin((2 * Math.PI * ((g % 12) + 1)) / 12)
        )
      },
    })
    expect(sn.overallMape).toBeGreaterThan(0)
    expect(lin.overallMape).toBeGreaterThan(0)
    expect(lin.overallMape).toBeLessThan(sn.overallMape)
  })

  it('fitFn 返回 null 的 origin 被跳过（数据不足门槛：训练 <24 个月）', () => {
    const hist = seasonalTrendFixture(26) // 2021-01 ~ 2023-02
    const r = runRollingBacktest({
      historical: hist,
      originStart: '2022-11',
      originEnd: '2023-03',
      fitFn: (train) => (train.length < 24 ? null : { n: train.length }),
      forecastFn: () => 100,
    })
    // 5 个 origin 中 2022-11/12 训练段 22/23 个月被跳过，2023-01/02/03 三个月参跑
    expect(r.origins).toBe(3)
  })
})

describe('selectModel 闸门（P0-2：季节朴素可胜 + 0.5pp 防抖，含换记法不变性）', () => {
  it('达门槛的最低 MAPE 候选胜出（ETS 8 vs SN 12 ⇒ ets）', () => {
    expect(selectModel({ linear: 10, ets: 8, seasonal_naive: 12 })).toBe('ets')
  })

  it('季节朴素可当胜者：钦州 container 形态（10.22 / 13.27 / 7.81 ⇒ seasonal_naive）', () => {
    expect(selectModel({ linear: 10.22, ets: 13.27, seasonal_naive: 7.81 })).toBe('seasonal_naive')
  })

  it('改善不足 0.5pp 不换（防抖）：0.4pp 保留线性、0.5pp 恰好达标', () => {
    expect(selectModel({ linear: 10, ets: 9.6, seasonal_naive: 12 })).toBe('linear')
    expect(selectModel({ linear: 10, ets: 9.5, seasonal_naive: 12 })).toBe('ets')
  })

  it('达标者里取最小；平局按参数少者优先（SN 12 < ETS 18）', () => {
    expect(selectModel({ linear: 10, ets: 9, seasonal_naive: 8 })).toBe('seasonal_naive')
    expect(selectModel({ linear: 10, ets: 9, seasonal_naive: 9 })).toBe('seasonal_naive')
  })

  it('组合须严格优于当轮最好单模型且达门槛才参与（平局/落后不参与）', () => {
    expect(selectModel({ linear: 10, ets: 8, seasonal_naive: 12, combination: 7.9 })).toBe(
      'combination'
    )
    expect(selectModel({ linear: 10, ets: 8, seasonal_naive: 12, combination: 8 })).toBe('ets')
    expect(selectModel({ linear: 10, ets: 9.6, seasonal_naive: 12, combination: 9.55 })).toBe(
      'linear'
    )
  })

  it('分数缺失/非有限一律保留线性（不猜）', () => {
    expect(selectModel({ linear: 10, ets: null, seasonal_naive: 12 })).toBe('linear')
    expect(selectModel({ linear: 10, ets: Number.NaN, seasonal_naive: 12 })).toBe('linear')
    expect(selectModel({ linear: null, ets: 8, seasonal_naive: 12 })).toBe('linear')
  })

  it('换记法不变（同一违约换比例尺度表达仍红）：放大缩小 100 倍判据不变', () => {
    expect(selectModel({ linear: 1000, ets: 800, seasonal_naive: 1200 })).toBe('ets')
    expect(selectModel({ linear: 0.1, ets: 0.13, seasonal_naive: 0.12 })).toBe('linear')
  })
})

// ── L5（2026-10-02）：sMAPE / PICP / 逐点 series ──

/** 恒值 100 序列（sMAPE 已知值夹具） */
function constantFixture(months = 48) {
  return Array.from({ length: months }, (_, i) => ({
    time: `${2021 + Math.floor(i / 12)}-${String((i % 12) + 1).padStart(2, '0')}`,
    value: 100,
  }))
}

const alwaysModel = () => ({})

describe('L5: sMAPE（H&K 2006，2|e|/(|y|+|ŷ|)×100）', () => {
  it('恒定 150% 超预测 → sMAPE=40（同夹具 MAPE=50：单侧偏离偏倚的对照判据）', () => {
    const r = runRollingBacktest({
      historical: constantFixture(),
      fitFn: alwaysModel,
      forecastFn: () => 150,
    })
    expect(r.overallSmape).toBe(40)
    expect(r.overallMape).toBe(50)
  })

  it('预测全对 → overallSmape=0；|y|+|ŷ|=0 的点不计（不产生 NaN）', () => {
    const r = runRollingBacktest({
      historical: constantFixture(),
      fitFn: alwaysModel,
      forecastFn: () => 100,
    })
    expect(r.overallSmape).toBe(0)
    for (const v of Object.values(r.smapeByStep)) {
      expect(v).not.toBeNull()
      expect(Number.isFinite(v)).toBe(true)
    }
  })
})

describe('L5: PICP（intervalFn 钩子）', () => {
  it('宽区间（预测±80）→ 覆盖率 1；贴预测窄区间（±1）→ 0（actual=100 vs pred=150）', () => {
    const base = { historical: constantFixture(), fitFn: alwaysModel, forecastFn: () => 150 }
    const wide = runRollingBacktest({
      ...base,
      intervalFn: (model, t) => ({ lo: 70, hi: 230 }),
    })
    expect(wide.overallPicp).toBe(1)
    const tight = runRollingBacktest({
      ...base,
      intervalFn: (model, t) => ({ lo: 149, hi: 151 }),
    })
    expect(tight.overallPicp).toBe(0)
  })

  it('不传 intervalFn → picpByStep 全 null、overallPicp null（缺省不计）', () => {
    const r = runRollingBacktest({
      historical: constantFixture(),
      fitFn: alwaysModel,
      forecastFn: () => 150,
    })
    expect(r.overallPicp).toBeNull()
    for (const v of Object.values(r.picpByStep)) expect(v).toBeNull()
  })

  it('区间含非有限值（null/NaN）→ 该点不计入分母（缺失区间不虚增覆盖）', () => {
    const r = runRollingBacktest({
      historical: constantFixture(),
      fitFn: alwaysModel,
      forecastFn: () => 150,
      intervalFn: (model, t) => null,
    })
    expect(r.overallPicp).toBeNull()
  })
})

describe('L5: 逐点 series（供 DM 检验对齐）', () => {
  it('条目数 = 各步长样本数之和；字段齐备且有限', () => {
    const r = runRollingBacktest({
      historical: pureSeasonalFixture(),
      fitFn: seasonalNaiveModel,
      forecastFn: seasonalNaiveForecast,
    })
    const total = Object.values(r.samplesByStep).reduce((a, b) => a + b, 0)
    expect(r.series.length).toBe(total)
    for (const e of r.series) {
      expect(Number.isFinite(e.actual)).toBe(true)
      expect(Number.isFinite(e.predicted)).toBe(true)
      expect(e.step).toBeGreaterThanOrEqual(1)
      expect(/^\d{4}-\d{2}$/.test(e.time)).toBe(true)
    }
  })
})

// ── P0-1（2026-10-04）：组合模式（members + 因果 WeightTracker）──

/** 组合夹具：恒定 100 共 36 个月；good 恒偏 4%，bad 按目标月变差（01=50%, 02=10%, 03=5%, 其余=20%） */
function comboFixture() {
  return Array.from({ length: 36 }, (_, i) => ({
    time: `${2021 + Math.floor(i / 12)}-${String((i % 12) + 1).padStart(2, '0')}`,
    value: 100,
  }))
}

function comboBadForecast(t) {
  const m = t.slice(5)
  const pct = m === '01' ? 0.5 : m === '02' ? 0.1 : m === '03' ? 0.05 : 0.2
  return 100 * (1 + pct)
}

function comboMembers() {
  return [
    { key: 'good', fitFn: () => ({}), forecastFn: () => 104 },
    { key: 'bad', fitFn: () => ({}), forecastFn: (model, t) => comboBadForecast(t) },
  ]
}

describe('P0-1: 组合模式（members/weightTracker）', () => {
  it('因果性：权重逐 origin 只喂"目标时点 ≤ 当前 origin"的误差，未来步长不得入权', () => {
    const real = createWeightTracker('inverse')
    const updates = []
    const spy = {
      update(s) {
        updates.push({ ...s })
        real.update(s)
      },
      weights() {
        return real.weights()
      },
    }
    runRollingBacktest({
      historical: comboFixture(),
      members: comboMembers(),
      weightTracker: spy,
      originStart: '2023-01',
      originEnd: '2023-03',
      horizon: 3,
    })
    expect(updates.length).toBe(3)
    // 各 origin 结束时可见的已实现误差（含同一时点多 origin 重复记入）：
    expect(updates[0].good).toBeCloseTo(4, 10)
    expect(updates[0].bad).toBeCloseTo(50, 10) // 泄漏版会掺 02/03 月步长 ⇒ 21.7
    expect(updates[1].good).toBeCloseTo(4, 10)
    expect(updates[1].bad).toBeCloseTo(70 / 3, 10)
    expect(updates[2].good).toBeCloseTo(4, 10)
    expect(updates[2].bad).toBeCloseTo(85 / 6, 10)
  })

  it('等权起步：tracker 未喂过时首 origin 组合 = 成员均值（{104,150} ⇒ 127，MAPE=27%）', () => {
    const r = runRollingBacktest({
      historical: comboFixture(),
      members: comboMembers(),
      weightTracker: createWeightTracker('inverse'),
      originStart: '2023-01',
      originEnd: '2023-01',
      horizon: 1,
    })
    expect(r.overallMape).toBe(27)
    const noTracker = runRollingBacktest({
      historical: comboFixture(),
      members: comboMembers(),
      originStart: '2023-01',
      originEnd: '2023-01',
      horizon: 1,
    })
    expect(noTracker.overallMape).toBe(27) // 无 tracker ⇒ 恒等权，同值
  })

  it('权重随已实现误差收敛：memberScores 与 finalWeights 由平均误差 1/score 导出', () => {
    const r = runRollingBacktest({
      historical: comboFixture(),
      members: comboMembers(),
      weightTracker: createWeightTracker('inverse'),
      originStart: '2023-01',
      originEnd: '2023-03',
      horizon: 1,
    })
    // 全期成员平均误差（报告口径）：good=4%，bad=(50+10+5)/3=21.67%
    expect(r.memberScores.good).toBeCloseTo(4, 10)
    expect(r.memberScores.bad).toBeCloseTo(21.67, 10)
    // finalWeights 用 memberScores（含 21.67 舍入）反比归一
    const wGood = 1 / 4 / (1 / 4 + 1 / 21.67)
    expect(r.finalWeights.good).toBeCloseTo(wGood, 10)
    expect(r.finalWeights.bad).toBeCloseTo(1 - wGood, 10)
    // 自适应组合不劣于恒等权组合（同夹具、同 origin）
    const equal = runRollingBacktest({
      historical: comboFixture(),
      members: comboMembers(),
      originStart: '2023-01',
      originEnd: '2023-03',
      horizon: 1,
    })
    expect(r.overallMape).toBeLessThan(equal.overallMape)
  })
})

// ── P0-3（2026-10-04）：因果区间校准（逐 origin 已实现相对误差分位数）──

describe('P0-3: quantileSorted / intervalBounds / calibration 模式', () => {
  it('quantileSorted：type-7 线性插值（手算 [0..40] q10=4 / q50=20 / q90=36）', () => {
    expect(quantileSorted([0, 10, 20, 30, 40], 0.1)).toBeCloseTo(4, 12)
    expect(quantileSorted([0, 10, 20, 30, 40], 0.5)).toBeCloseTo(20, 12)
    expect(quantileSorted([0, 10, 20, 30, 40], 0.9)).toBeCloseTo(36, 12)
    expect(quantileSorted([7], 0.3)).toBe(7)
    expect(quantileSorted([], 0.5)).toBeNull()
  })

  it('intervalBounds：校准偏移优先；缺失回退 MAPE 折算；>h12 按 sqrt(年) 放大', () => {
    const off = { 3: { lo: -0.1, hi: 0.2, n: 12 } }
    const calibrated = intervalBounds(3, 12, off, { 3: 8 }, 5)
    expect(calibrated.lo).toBeCloseTo(-0.1, 12)
    expect(calibrated.hi).toBeCloseTo(0.2, 12)
    expect(calibrated.source).toBe('calibrated')
    const scaled = intervalBounds(24, 12, { 12: { lo: -0.1, hi: 0.2, n: 12 } }, { 12: 6 }, 5)
    expect(scaled.lo).toBeCloseTo(-0.1 * Math.sqrt(3), 12)
    expect(scaled.hi).toBeCloseTo(0.2 * Math.sqrt(3), 12)
    const fallback = intervalBounds(3, 12, { 3: null }, { 3: 8 }, 5)
    expect(fallback.lo).toBeCloseTo(-0.08, 12)
    expect(fallback.hi).toBeCloseTo(0.08, 12)
    expect(fallback.source).toBe('mape')
    const overall = intervalBounds(1, 12, null, {}, 7)
    expect(overall.hi).toBeCloseTo(0.07, 12)
    expect(overall.source).toBe('mape')
  })

  it('calibration 模式：区间只用"目标时点 < 当前 origin"的已实现误差（future 步长不入分位）', () => {
    // 夹具：12 个月真值 100·(1+a_i)，a_i=(i−5)/10；forecastFn 恒 100 ⇒ r_i = a_i（单调漂移）。
    // horizon=2：每个 origin 同时记录 step1（当月）与 step2（下月）误差——step2 的"下月误差"
    // 对下一 origin 而言尚未实现，必须被 filter 排除（本测试即钉住该过滤器）。
    const fixture = Array.from({ length: 12 }, (_, i) => ({
      time: `2023-${String(i + 1).padStart(2, '0')}`,
      value: 100 * (1 + (i - 5) / 10),
    }))
    const r = runRollingBacktest({
      historical: fixture,
      fitFn: () => ({}),
      forecastFn: () => 100,
      calibration: { level: 0.8, minSamples: 3 },
      originStart: '2023-06',
      originEnd: '2023-10',
      horizon: 2,
    })
    // 因果性：step2 的首个区间只能出现在 2023-10（此前可见样本 <3）；无过滤器时 09 月就会
    // 拿"未来（09 月）的 step2 误差"建区间 ⇒ 本条必红。n 表示"t < origin 的样本数"。
    expect(r.calibrationLog.filter((l) => l.step === 2).map((l) => [l.origin, l.n])).toEqual([
      ['2023-10', 3],
    ])
    // 全期偏移 = 全部已记录误差的分位（记录集与 filter 无关）：step2 r=[0.1..0.5] n=5
    expect(r.intervalOffsets[2]).toMatchObject({ n: 5 })
    expect(r.intervalOffsets[2].lo).toBeCloseTo(0.14, 12)
    expect(r.intervalOffsets[2].hi).toBeCloseTo(0.46, 12)
    // 单调漂移夹具：测量点 r 高于过去样本上分位 ⇒ PICP=0（诚实负结果，不是虚高）
    expect(r.overallPicp).toBe(0)
  })

  it('calibration minSamples 门槛：样本不足 ⇒ 偏移 null、PICP 全 null（不计分母）', () => {
    const fixture = Array.from({ length: 12 }, (_, i) => ({
      time: `2023-${String(i + 1).padStart(2, '0')}`,
      value: 100 * (1 + (i - 5) / 10),
    }))
    const r = runRollingBacktest({
      historical: fixture,
      fitFn: () => ({}),
      forecastFn: () => 100,
      calibration: { level: 0.8, minSamples: 7 },
      originStart: '2023-06',
      originEnd: '2023-11',
      horizon: 1,
    })
    expect(r.intervalOffsets[1]).toBeNull()
    expect(r.overallPicp).toBeNull()
    expect(r.calibrationLog).toEqual([])
  })
})
