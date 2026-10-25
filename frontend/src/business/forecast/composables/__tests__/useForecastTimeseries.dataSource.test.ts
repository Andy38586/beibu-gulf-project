/**
 * useForecastTimeseries → store 的降级标记接线（P1-1）。
 *
 * 页面角标读的是 store.chart.lineDataSource：若适配器已透传、页面已渲染，但 composable
 * 没把标记写进 store，角标就永远不会出现（而组件测试仍绿）。本组专门守这一段接线，
 * 同时覆盖「缓存命中必须同口径恢复」——否则角标只在首次请求的帧里出现。
 */
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { useForecastStore } from '@/stores/forecastStore'

const { getTimeSeries } = vi.hoisted(() => ({ getTimeSeries: vi.fn() }))

vi.mock('vue-router', () => ({
  useRouter: () => ({ push: vi.fn() }),
}))

vi.mock('@/services', () => ({
  forecastAdapter: { getTimeSeries },
}))

import { useForecastTimeseries } from '../useForecastTimeseries'

/** 12 个月点，落在页面默认窗口（currentTime=2026-06 往前 11 步）内 */
function series() {
  const data = []
  for (let i = 0; i < 12; i++) {
    const monthIndex = 6 + i
    data.push({
      time: `${2025 + Math.floor(monthIndex / 12)}-${String((monthIndex % 12) + 1).padStart(2, '0')}`,
      value: 100 + i,
      type: 'forecast' as const,
    })
  }
  return [{ portId: 'QZ', portName: '钦州港', data }]
}

async function loadWith(payload: unknown): Promise<void> {
  getTimeSeries.mockResolvedValue(payload)
  const store = useForecastStore()
  const { load } = useForecastTimeseries()
  await load(store.activeTransactionId, new AbortController().signal)
}

describe('useForecastTimeseries 降级标记接线', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
  })

  it('engine-fallback → store.chart.lineDataSource 同步为降级', async () => {
    await loadWith({ series: series(), unit: '万吨', dataSource: 'engine-fallback' })
    expect(useForecastStore().chart.lineDataSource).toBe('engine-fallback')
  })

  it('model → store 标 model（阴性对照：不误标降级）', async () => {
    await loadWith({ series: series(), unit: '万吨', dataSource: 'model' })
    expect(useForecastStore().chart.lineDataSource).toBe('model')
  })

  it('旧响应无 dataSource → store 为 null（不误判降级）', async () => {
    await loadWith({ series: series(), unit: '万吨' })
    expect(useForecastStore().chart.lineDataSource).toBeNull()
  })

  it('缓存命中同样恢复降级标记（不重复请求、角标不丢）', async () => {
    await loadWith({ series: series(), unit: '万吨', dataSource: 'engine-fallback' })
    const store = useForecastStore()
    store.chart.lineDataSource = null // 模拟重建/切页清空

    const { load } = useForecastTimeseries()
    await load(store.activeTransactionId, new AbortController().signal)

    expect(getTimeSeries).toHaveBeenCalledTimes(1) // 命中 requestCache，未再请求
    expect(store.chart.lineDataSource).toBe('engine-fallback')
  })
})
