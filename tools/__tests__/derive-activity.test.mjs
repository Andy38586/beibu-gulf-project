import { describe, expect, it } from 'vitest'

import {
  BASE_PERIOD,
  baseMean,
  deriveActivity,
  GULF_BOUNDS,
  interpolateMonthly,
  monthOffset,
  PORT_COORDS,
} from '../derive-activity.mjs'

// derive-activity 派生脚本单测（纯函数注入 fixture，2026-09-08）：
// 口径 = cargo 基期均值归一指数（base=100），锚点取 ports 表真坐标

function mkHistorical(months = 24, base = 1000) {
  const historical = []
  for (let i = 0; i < months; i++) {
    const year = 2021 + Math.floor(i / 12)
    const month = (i % 12) + 1
    historical.push({
      time: `${year}-${String(month).padStart(2, '0')}`,
      value: base + i * 10,
      type: 'historical',
    })
  }
  return historical
}

function mkModel(cargoPortId = 'qinzhou') {
  return {
    ports: {
      [cargoPortId]: {
        predictions: [
          { time: '2026-07', value: 2000 },
          { time: '2027-01', value: 2200 },
        ],
        backtest: { rolling_mape_by_step: { 1: 5, 12: 10 } },
      },
    },
    model_info: { method: 'test' },
  }
}

describe('baseMean — 基期均值', () => {
  it('按 [2021-01, 2024-12] 窗口计算月均（基期=官方真数据）', () => {
    const hist = mkHistorical(66) // 2021-01 ~ 2026-06
    const mean = baseMean(hist)
    expect(mean).toBeGreaterThan(1000)
    // 24 个月基期（2021-01~2024-12），均值 = (base + avg offset*10)
    const sum = hist.filter((d) => d.time >= BASE_PERIOD.start && d.time <= BASE_PERIOD.end)
    const expected = sum.reduce((s, d) => s + d.value, 0) / sum.length
    expect(mean).toBeCloseTo(expected, 6)
  })

  it('基期内无数据 → null（防御）', () => {
    expect(baseMean([])).toBeNull()
    expect(baseMean(mkHistorical(6), '2030-01', '2030-12')).toBeNull()
  })
})

describe('deriveActivity — 真数据派生', () => {
  it('历史段指数 = value / baseMean × 100', () => {
    const cargo = { data: { qinzhou: { historical: mkHistorical(66) } } }
    const act = deriveActivity(cargo, mkModel())
    const mean = baseMean(cargo.data.qinzhou.historical)
    const h = act.data.qinzhou.historical
    expect(h.length).toBe(66)
    // round1 保留 1 位小数
    expect(h[0].value).toBeCloseTo((cargo.data.qinzhou.historical[0].value / mean) * 100, 1)
    expect(h[0].type).toBe('historical')
  })

  it('forecast 段与模型预测对齐（指数化 + 可信度折算）且逐月覆盖到模型末点', () => {
    const cargo = { data: { qinzhou: { historical: mkHistorical(66) } } }
    const model = mkModel()
    const act = deriveActivity(cargo, model)
    const f = act.data.qinzhou.forecast
    expect(f.length).toBeGreaterThan(0)
    expect(f[0].time).toBe('2026-07')
    expect(f[0].type).toBe('forecast')
    expect(f.at(-1).time).toBe('2027-01')
    // 吞吐量 2000/2200 指数化后恒大于 100（基期均值 < 2000）
    expect(f[0].value).toBeGreaterThan(100)
    expect(f[0].reliability).toBeGreaterThan(0.25)
  })

  it('真坐标锚点落在北部湾 bbox 内（ports 表 4490→4326）', () => {
    const cargo = { data: { qinzhou: { historical: mkHistorical(66) } } }
    const act = deriveActivity(cargo, mkModel())
    const [lng, lat] = act.data.qinzhou.spatial.features[0].geometry.coordinates
    expect(lng).toBeGreaterThanOrEqual(GULF_BOUNDS.minLng)
    expect(lng).toBeLessThanOrEqual(GULF_BOUNDS.maxLng)
    expect(lat).toBeGreaterThanOrEqual(GULF_BOUNDS.minLat)
    expect(lat).toBeLessThanOrEqual(GULF_BOUNDS.maxLat)
    expect(lng).toBeCloseTo(PORT_COORDS.qinzhou.lng, 6)
    expect(lat).toBeCloseTo(PORT_COORDS.qinzhou.lat, 6)
  })

  it('基期均值非正/缺失 → 该港派生置空并标注（不产出假值）', () => {
    const cargo = { data: { qinzhou: { historical: [] } } }
    const act = deriveActivity(cargo, mkModel())
    expect(act.data.qinzhou.historical).toEqual([])
    expect(act.data.qinzhou.error).toMatch(/baseMean/)
    expect(act._baseMeans.qinzhou).toBeNull()
  })
})

describe('interpolateMonthly — 月化插值', () => {
  it('半年点间线性插值补月度（与模型末点对齐）', () => {
    const points = [
      { time: '2026-07', value: 2000 },
      { time: '2026-12', value: 2100 },
    ]
    const out = interpolateMonthly(points, '2026-06')
    expect(out.map((p) => p.time)).toEqual([
      '2026-07',
      '2026-08',
      '2026-09',
      '2026-10',
      '2026-11',
      '2026-12',
    ])
    // 线性中点 2027-?? ：gap=5，g 从 1..4 插值
    expect(out[2].value).toBeCloseTo(2000 + (2100 - 2000) * (2 / 5), 6)
  })

  it('丢弃 ≤ afterTime 的重叠点', () => {
    const points = [
      { time: '2026-05', value: 100 },
      { time: '2026-07', value: 200 },
    ]
    const out = interpolateMonthly(points, '2026-06')
    expect(out.map((p) => p.time)).toEqual(['2026-07'])
  })
})

describe('monthOffset — 时间工具', () => {
  it('月份偏移换算正确', () => {
    expect(monthOffset('2026-01')).toBe(2026 * 12)
    expect(monthOffset('2026-06')).toBe(2026 * 12 + 5)
    expect(monthOffset('2026-12')).toBe(2026 * 12 + 11)
  })
})
