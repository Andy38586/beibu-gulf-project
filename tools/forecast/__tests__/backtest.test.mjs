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

describe('selectModel 闸门（胜者必须双胜，含换记法不变性）', () => {
  it('ETS 同时优于两者才胜出', () => {
    expect(selectModel({ linear: 10, ets: 8, seasonal_naive: 12 })).toBe('ets')
  })

  it('ETS 输给任一对手即保留线性（严格小于，平局不留情）', () => {
    expect(selectModel({ linear: 10, ets: 13, seasonal_naive: 12 })).toBe('linear')
    expect(selectModel({ linear: 10, ets: 10, seasonal_naive: 12 })).toBe('linear')
    // ETS 赢线性但输给朴素基准——闸门必须仍保留线性（变异①回归用例：
    // 摘掉 naive 约束后本用例必红，2026-09-26 实测曾因缺此格而假绿）
    expect(selectModel({ linear: 10, ets: 9, seasonal_naive: 8 })).toBe('linear')
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
