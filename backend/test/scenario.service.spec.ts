import { describe, expect, it } from 'vitest'

import { BusinessError } from '../src/common/errors/business-error'
import type { DataFilesService } from '../src/infra/files/data-files.service'
import { CANAL_PORT_SHARES } from '../src/modules/forecast/constants/scenario.constants'
import { ForecastService } from '../src/modules/forecast/services/forecast.service'
import {
  applyCanalScenario,
  parseScenarioId,
  timeToYearFloat,
} from '../src/modules/forecast/services/scenario.service'

// 运河情景层单测（2026-09-26 F3）。参数锚点出处见 constants/scenario.constants.ts 头注释
// （刘胜友 2025 §2.1/§3、罗淳 2024 §2.6）；期望值按锚点手工复算，不许从实现反推。

describe('parseScenarioId 入参归一', () => {
  it('缺省/空串归 baseline；合法值透传；非法值抛业务错误', () => {
    expect(parseScenarioId(undefined)).toBe('baseline')
    expect(parseScenarioId('')).toBe('baseline')
    expect(parseScenarioId('baseline')).toBe('baseline')
    expect(parseScenarioId('design')).toBe('design')
    expect(parseScenarioId('induced')).toBe('induced')
    expect(() => parseScenarioId('nope')).toThrow(BusinessError)
  })
})

describe('timeToYearFloat 时间解析（04-B5 单一入口）', () => {
  it('YYYY-MM 取月中点；YYYY-MM-DD 同口径', () => {
    expect(timeToYearFloat('2030-01')).toBeCloseTo(2030 + 0.5 / 12, 9)
    expect(timeToYearFloat('2035-12')).toBeCloseTo(2035 + 11.5 / 12, 9)
  })
  it('非法时间显式抛错，不产出 NaN 静默散射', () => {
    expect(() => timeToYearFloat('2030-13')).toThrow(BusinessError)
    expect(() => timeToYearFloat('garbage')).toThrow(BusinessError)
  })
})

describe('applyCanalScenario 变换', () => {
  const qz = [
    { time: '2026-05', value: 1300, lower: 1200, upper: 1400 },
    { time: '2030-01', value: 1400, lower: 1300, upper: 1500 },
    { time: '2035-01', value: 1500, lower: 1400, upper: 1600 },
  ]

  it('baseline 原样返回（同引用，零拷贝零改写）', () => {
    expect(applyCanalScenario('qinzhou', qz, 'baseline')).toBe(qz)
  })

  it('design 情景 2035-01 钦州：加量 = 9550×(7510/9550)×0.47/12 ≈ 294.14（锚点手工复算）', () => {
    const out = applyCanalScenario('qinzhou', qz, 'design')
    // 2035-01 已过末锚点（2035）→ 总量持平 9550；区间插值持平 2040 → jh = 7510/9550
    const expected = Math.round(1500 + (7510 * 0.47) / 12)
    expect(out[2].value).toBe(expected)
    // 区间同幅右移（情景不确定性由三档选择表达，带宽不变）
    expect(out[2].lower).toBe(Math.round(1400 + (7510 * 0.47) / 12))
    expect(out[2].upper).toBe(Math.round(1600 + (7510 * 0.47) / 12))
  })

  it('2030-01 在 2029→2035 段内线性插值（design 总量 5340→9550）', () => {
    const out = applyCanalScenario('qinzhou', qz, 'design')
    const t = 2030 + 0.5 / 12
    const annual = 5340 + ((t - 2029) / 6) * (9550 - 5340)
    const interval = 1310 + ((t - 2029) / 6) * (2040 - 1310)
    const add = (annual * ((annual - interval) / annual) * 0.47) / 12
    expect(out[1].value).toBe(Math.round(1400 + add))
  })

  it('通航前（2026-05 早于首锚点）零增量原样返回', () => {
    const out = applyCanalScenario('qinzhou', qz, 'design')
    expect(out[0]).toEqual(qz[0])
  })

  it('钦州分摊大头 > 北海本地小头（分摊结构可观测）', () => {
    const out = applyCanalScenario('qinzhou', qz, 'design')
    const bh = applyCanalScenario('beihai', qz, 'design')
    expect(out[2].value).toBeGreaterThan(bh[2].value)
  })

  it('未知港域/未知情景显式抛业务错误（静默回基线 = 藏口径错误，04-B8）', () => {
    expect(() => applyCanalScenario('unknown-port', qz, 'design')).toThrow(BusinessError)
    expect(() => applyCanalScenario('qinzhou', qz, 'nope' as never)).toThrow(BusinessError)
  })
})

describe('常量守卫（分摊结构自洽）', () => {
  it('三港分摊之和恒为 1（B3：改任一占比必须同步改其余）', () => {
    const sum = Object.values(CANAL_PORT_SHARES).reduce((a, b) => a + b, 0)
    expect(Math.abs(sum - 1)).toBeLessThan(1e-9)
  })
})

describe('服务级缓存键行为（F3 修复点：键此前忽略情景导致串缓存）', () => {
  const artifact = {
    ports: {
      qinzhou: {
        name: '钦州港',
        backtest: { rolling_mape_by_step: { 1: 5 } },
        predictions: [
          { time: '2035-01', value: 1500, lower: 1400, upper: 1600 },
          { time: '2035-07', value: 1550, lower: 1450, upper: 1650 },
        ],
      },
    },
    model_info: { method: 'fixture' },
  }
  const cargoFile = {
    indicator: 'cargo',
    unit: '万吨',
    data: {
      qinzhou: {
        historical: Array.from({ length: 24 }, (_, i) => ({
          time: `${2024 + Math.floor(i / 12)}-${String((i % 12) + 1).padStart(2, '0')}`,
          value: 1300,
          type: 'historical',
        })),
        spatial: null,
      },
    },
  }
  const dataFiles = {
    read: async (name: string) => {
      if (name === 'forecast/cargo.json') return cargoFile
      if (name === 'forecast/throughput_model.json') return artifact
      throw Object.assign(new Error('not found'), { code: 'ENOENT' })
    },
  } as unknown as DataFilesService

  it('同指标不同情景返回不同预测（若键忽略情景，第二发命中第一发缓存 ⇒ 必红）', async () => {
    const svc = new ForecastService(dataFiles)
    const base = (await svc.getIndicatorData('cargo', undefined, 'qinzhou', 1.0, 'baseline')) as {
      ports: Record<string, { forecast: Array<{ time: string; value: number }> }>
    }
    const design = (await svc.getIndicatorData('cargo', undefined, 'qinzhou', 1.0, 'design')) as {
      ports: Record<string, { forecast: Array<{ time: string; value: number }> }>
    }
    const bVal = base.ports.qinzhou.forecast.find((d) => d.time === '2035-01')!.value
    const dVal = design.ports.qinzhou.forecast.find((d) => d.time === '2035-01')!.value
    expect(dVal).toBeGreaterThan(bVal)
    // 再取一次 design：缓存命中也应与首次 design 一致（键区分情景后不串）
    const designAgain = (await svc.getIndicatorData(
      'cargo',
      undefined,
      'qinzhou',
      1.0,
      'design'
    )) as {
      ports: Record<string, { forecast: Array<{ time: string; value: number }> }>
    }
    expect(designAgain.ports.qinzhou.forecast.find((d) => d.time === '2035-01')!.value).toBe(dVal)
  })

  it('非 cargo 指标配情景显式拒绝（04-B10：无文献参数不伪造）', async () => {
    const svc = new ForecastService(dataFiles)
    await expect(
      svc.getIndicatorData('container', undefined, 'qinzhou', 1.0, 'design')
    ).rejects.toThrow(BusinessError)
  })
})
