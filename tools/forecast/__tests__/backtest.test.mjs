import { describe, expect, it } from 'vitest'

import bt from '../lib/backtest.cjs'

const {
  runRollingBacktest,
  seasonalNaiveModel,
  seasonalNaiveForecast,
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
