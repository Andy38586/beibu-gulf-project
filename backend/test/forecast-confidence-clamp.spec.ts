import { describe, expect, it, vi } from 'vitest'

import {
  FALLBACK_CONFIDENCE,
  MAX_CONFIDENCE,
  parseConfidence,
} from '../src/common/constants/forecast.constants'
import { computeForecast } from '../src/modules/forecast/services/forecast-engine'
import type { HistoricalPoint } from '../src/modules/forecast/services/forecast-engine'
import { TaskHandlers } from '../src/modules/task/services/task-handlers'

/**
 * F3（2026-10-05）confidence 上限钳制单源收口回归。
 * 修前：controller 局部 parseConfidence 有上限；task-handlers 两处手写
 * `Number.isFinite && >0` 无上限；engine 只兜非有限/≤0 ⇒ 1e9 走异步路径直入 Math.pow，
 * 结果可含 Infinity/NaN（同步/异步同参数不等价）。
 */

const history: HistoricalPoint[] = Array.from({ length: 48 }, (_, i) => ({
  time: `${2020 + Math.floor(i / 12)}-${String((i % 12) + 1).padStart(2, '0')}`,
  value: 1000 + i * 12,
  type: 'historical',
}))

describe('F3 confidence 上限钳制（单源 parseConfidence）', () => {
  it('🔴 parseConfidence：1e9 → MAX；非有限/≤0 → FALLBACK', () => {
    expect(parseConfidence(1e9)).toBe(MAX_CONFIDENCE)
    expect(parseConfidence('1e9')).toBe(MAX_CONFIDENCE)
    expect(parseConfidence(0)).toBe(FALLBACK_CONFIDENCE)
    expect(parseConfidence(-3)).toBe(FALLBACK_CONFIDENCE)
    expect(parseConfidence(Number.POSITIVE_INFINITY)).toBe(FALLBACK_CONFIDENCE)
    expect(parseConfidence(undefined)).toBe(FALLBACK_CONFIDENCE)
    expect(parseConfidence(1.5)).toBe(1.5) // 区间内原样透传
  })

  it('🔴 引擎入口钳制：1e9 与 MAX_CONFIDENCE 输出逐值一致（修前 1e9 产非有限值）', () => {
    const huge = computeForecast(history, 1e9)
    const capped = computeForecast(history, MAX_CONFIDENCE)

    expect(huge.forecast.length).toBeGreaterThan(0)
    expect(huge.forecast.every((p) => Number.isFinite(p.value))).toBe(true)
    expect(huge.forecast).toEqual(capped.forecast)
  })

  it('🔴 异步 handler 与同步 controller 同口径：1e9 也钳到 MAX（修前裸传 1e9）', async () => {
    const forecastService = {
      getTimeSeriesData: vi.fn().mockResolvedValue({ series: [] }),
      getMapData: vi.fn().mockResolvedValue({ features: [] }),
    }
    const handlers = new TaskHandlers(
      {} as never,
      {} as never,
      forecastService as never,
      {} as never
    )

    await handlers.get('forecast-map')({ indicator: 'cargo', time: '2026-10', confidence: 1e9 })
    expect(forecastService.getMapData).toHaveBeenCalledWith('cargo', '2026-10', MAX_CONFIDENCE)

    await handlers.get('forecast-timeseries')({ indicator: 'cargo', confidence: '1e9' })
    expect(forecastService.getTimeSeriesData).toHaveBeenCalledWith(
      'cargo',
      undefined,
      undefined,
      undefined,
      undefined,
      MAX_CONFIDENCE
    )
  })
})
