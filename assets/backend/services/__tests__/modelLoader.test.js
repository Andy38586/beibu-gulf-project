// modelLoader 单测：插值逻辑 + 产物读取/降级契约
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockReadFile } = vi.hoisted(() => ({
  mockReadFile: vi.fn(),
}))

vi.mock('fs/promises', async (importOriginal) => {
  const actual = await importOriginal()
  return {
    ...actual,
    readFile: mockReadFile,
    default: { ...actual, readFile: mockReadFile },
  }
})

function makeModelJson() {
  return JSON.stringify({
    ports: {
      qinzhou: {
        name: '钦州港',
        backtest: {
          mape_2023: 2.37,
          mape_2024: 2.49,
          mape_2025: 2.05,
          overall_mape: 2.3,
          bias: 'balanced',
          correction_factor: 0.9839,
        },
        predictions: [
          { time: '2026-01', value: 1516, lower: 1481, upper: 1551 },
          { time: '2026-12', value: 1561, lower: 1525, upper: 1597 },
          { time: '2027-06', value: 1580, lower: 1528, upper: 1631 },
          { time: '2027-12', value: 1585, lower: 1534, upper: 1637 },
        ],
      },
    },
    model_info: {
      method: 'seasonal_decomposition_with_correction',
      training_period: '2018-2022',
      validation_period: '2023-2025',
      forecast_period: '2026-2035',
    },
  })
}

describe('interpolateMonthly', () => {
  it('丢弃 <= afterTime 的模型点', async () => {
    const { interpolateMonthly } = await import('../modelLoader.js')
    const out = interpolateMonthly(
      [
        { time: '2026-01', value: 100 },
        { time: '2026-06', value: 200 },
        { time: '2026-12', value: 300 },
        { time: '2027-06', value: 400 },
      ],
      '2026-06'
    )
    // 保留点 2026-12 / 2027-06，中间插 2027-01~05
    expect(out.map((d) => d.time)).toEqual([
      '2026-12',
      '2027-01',
      '2027-02',
      '2027-03',
      '2027-04',
      '2027-05',
      '2027-06',
    ])
    expect(out[0].value).toBe(300)
  })

  it('间隔大于 1 个月的节点间做月度线性插值', async () => {
    const { interpolateMonthly } = await import('../modelLoader.js')
    const out = interpolateMonthly(
      [
        { time: '2026-12', value: 100 },
        { time: '2027-06', value: 200 },
      ],
      undefined
    )
    // 100 + (200-100) * g/6
    expect(out.map((d) => [d.time, d.value])).toEqual([
      ['2026-12', 100],
      ['2027-01', 117],
      ['2027-02', 133],
      ['2027-03', 150],
      ['2027-04', 167],
      ['2027-05', 183],
      ['2027-06', 200],
    ])
  })

  it('相邻月度点不做插值', async () => {
    const { interpolateMonthly } = await import('../modelLoader.js')
    const out = interpolateMonthly(
      [
        { time: '2026-01', value: 1 },
        { time: '2026-02', value: 2 },
      ],
      undefined
    )
    expect(out).toHaveLength(2)
  })

  it('输出点携带 type=forecast 与 reliability', async () => {
    const { interpolateMonthly } = await import('../modelLoader.js')
    const out = interpolateMonthly([{ time: '2026-12', value: 100 }], undefined)
    expect(out[0]).toEqual({ time: '2026-12', value: 100, type: 'forecast', reliability: 1 })
  })
})

describe('getModelForecast', () => {
  beforeEach(() => {
    mockReadFile.mockReset()
    vi.resetModules()
  })

  it('模型文件缺失时返回 null（调用方降级）', async () => {
    const { getModelForecast } = await import('../modelLoader.js')
    mockReadFile.mockRejectedValue(Object.assign(new Error('not found'), { code: 'ENOENT' }))
    expect(await getModelForecast('qinzhou', '2025-12')).toBeNull()
  })

  it('港口不存在于产物时返回 null', async () => {
    const { getModelForecast } = await import('../modelLoader.js')
    mockReadFile.mockResolvedValue(makeModelJson())
    expect(await getModelForecast('unknown-port', '2025-12')).toBeNull()
  })

  it('返回插值后的月度预测与回测 metadata', async () => {
    const { getModelForecast } = await import('../modelLoader.js')
    mockReadFile.mockResolvedValue(makeModelJson())
    const result = await getModelForecast('qinzhou', '2026-06')

    expect(result).not.toBeNull()
    expect(result.metadata.model).toBe('throughput_model')
    expect(result.metadata.backtest.overall_mape).toBe(2.3)
    expect(result.metadata.interpolated).toBe(true)
    // 保留点：2026-12 / 2027-06 / 2027-12（2026-01 与历史重叠被丢弃）
    expect(result.forecast[0].time).toBe('2026-12')
    expect(result.forecast[0].value).toBe(1561)
    // 2027-01 应为 2026-12 与 2027-06 的插值
    const jan = result.forecast.find((d) => d.time === '2027-01')
    expect(jan.value).toBe(Math.round(1561 + (1580 - 1561) * (1 / 6)))
    expect(result.forecast[result.forecast.length - 1].time).toBe('2027-12')
    expect(result.forecast.every((d) => d.type === 'forecast')).toBe(true)
  })
})
