// @vitest-environment jsdom
/**
 * DiversionPage 离页取消冒烟（z020）：①卸载即 abort 本页在途请求（signal 透传）；
 * ②卸载后迟到的响应不写图层（拦在 `unmounted` 旗标）。两类都是"离页后在途响应
 * 画到别的路由上"的实测失效形态，与 RouteAnalysisPage.staticAbort 同款口径。
 */
import { flushPromises, shallowMount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  updateCanalLayer: vi.fn(),
  updateArcLayers: vi.fn(),
  getBreakdown: vi.fn(),
  getCanalLine: vi.fn(),
  getPorts: vi.fn(),
}))

vi.mock('@/services', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/services')>()
  return {
    ...actual,
    diversionAdapter: {
      getBreakdown: h.getBreakdown,
      getCanalLine: h.getCanalLine,
    },
    mapDataService: { ...actual.mapDataService, getPorts: h.getPorts },
  }
})

vi.mock('../composables/useDiversionLayer', () => ({
  DIVERSION_CANAL_LAYER_ID: 'diversion-canal',
  useDiversionLayer: () => ({
    updateCanalLayer: h.updateCanalLayer,
    updateArcLayers: h.updateArcLayers,
  }),
}))

import DiversionPage from '../DiversionPage.vue'

interface Deferred<T> {
  promise: Promise<T>
  resolve: (value: T) => void
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((res) => {
    resolve = res
  })
  return { promise, resolve }
}

describe('DiversionPage 离页取消（z020）', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('卸载即把本页 signal 传给在途请求并 abort', async () => {
    h.getBreakdown.mockReturnValue(deferred().promise)
    h.getCanalLine.mockReturnValue(deferred().promise)
    h.getPorts.mockReturnValue(deferred().promise)

    const wrapper = shallowMount(DiversionPage)
    const signal = h.getBreakdown.mock.calls[0]?.[1] as AbortSignal | undefined
    expect(signal).toBeInstanceOf(AbortSignal)
    expect(signal?.aborted).toBe(false)

    wrapper.unmount()
    expect(signal?.aborted).toBe(true)
  })

  it('卸载后迟到的响应不写图层（canal 与 breakdown 都不触发 update*）', async () => {
    const breakdown = deferred<unknown>()
    const canal = deferred<unknown>()
    const ports = deferred<unknown>()
    h.getBreakdown.mockReturnValue(breakdown.promise)
    h.getCanalLine.mockReturnValue(canal.promise)
    h.getPorts.mockReturnValue(ports.promise)

    const wrapper = shallowMount(DiversionPage)
    wrapper.unmount()

    canal.resolve({
      lines: [
        {
          coordinates: [
            [108.1, 21.7],
            [108.2, 21.8],
          ],
        },
      ],
    })
    ports.resolve([])
    breakdown.resolve({ year: 2035, transfer: {}, byPort: {}, sankeyFlows: [] })
    await flushPromises()

    expect(h.updateCanalLayer).not.toHaveBeenCalled()
    expect(h.updateArcLayers).not.toHaveBeenCalled()
  })
})
