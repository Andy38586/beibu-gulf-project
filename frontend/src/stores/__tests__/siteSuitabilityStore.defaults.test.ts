// @vitest-environment jsdom
/**
 * siteSuitabilityStore.defaults 单测（权重以后端为准·快照兜底·控制台留痕）：
 * ①初值/reset = 快照（旧 0.4/0.1/0.2/0.2/0.1 已删）；②成功覆盖并 info 留痕；
 * ③失败保留快照并 warn 留痕（带快照身份）；④once 守卫同页只发一次；
 * ⑤快照 ≈ 后端定稿向量 1e-4（跨文件对齐守卫，另一半见后端 defaults 单测）。
 */
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockApiRequest } = vi.hoisted(() => ({ mockApiRequest: vi.fn() }))

vi.mock('@/shared', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/shared')>()
  return {
    ...actual,
    useApiRequest: () => ({ apiRequest: mockApiRequest }),
  }
})

import { logger } from '@/shared'
import { useSiteSuitabilityStore } from '../siteSuitabilityStore'
import {
  SNAPSHOT_MIN_LAND_FRAC,
  SNAPSHOT_PROVENANCE,
  SNAPSHOT_THRESHOLDS,
  SNAPSHOT_WEIGHTS,
} from '../siteSuitabilityDefaults.snapshot'

/** 后端定稿特征向量全精度（与 backend/.../site-ahp.constants.ts 矩阵亲手复算值同源） */
const FINAL_WEIGHTS: Record<string, number> = {
  inundation: 0.42993537381873326,
  terrain: 0.08451837333607896,
  land: 0.20591100060530831,
  access: 0.10971791699328601,
  demand: 0.1699173352465935,
}

function remoteDefaults() {
  return {
    weights: { ...FINAL_WEIGHTS },
    thresholds: { ...SNAPSHOT_THRESHOLDS },
    minLandFrac: 0.5,
    resolution: 0,
    source: 'SITE_AHP_MATRIX@2026-09-30',
  }
}

describe('siteSuitabilityStore.defaults', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
    vi.restoreAllMocks()
  })

  it('初值 = 快照（旧 0.4 权重已删），来源 pending', () => {
    const state = useSiteSuitabilityStore()
    expect(state.weights).toEqual(SNAPSHOT_WEIGHTS)
    expect(state.weights.inundation).not.toBe(0.4)
    expect(state.minLandFrac).toBe(SNAPSHOT_MIN_LAND_FRAC)
    expect(state.defaultsSource).toBe('pending')
  })

  it('成功：后端值覆盖 + info 留痕 + 来源 remote', async () => {
    mockApiRequest.mockResolvedValue(remoteDefaults())
    const info = vi.spyOn(logger, 'info').mockImplementation(() => undefined)
    const state = useSiteSuitabilityStore()
    await state.loadDefaults()
    expect(mockApiRequest).toHaveBeenCalledWith(
      '/site-suitability/defaults',
      expect.objectContaining({ method: 'GET' })
    )
    expect(state.weights.inundation).toBeCloseTo(0.42993537381873326, 9)
    expect(state.defaultsSource).toBe('remote')
    expect(info).toHaveBeenCalledWith(
      expect.stringContaining('defaults 后端直连成功'),
      expect.anything()
    )
  })

  it('失败：保留快照 + warn 留痕带快照身份 + 来源 snapshot', async () => {
    mockApiRequest.mockRejectedValue(new Error('network down'))
    const warn = vi.spyOn(logger, 'warn').mockImplementation(() => undefined)
    const state = useSiteSuitabilityStore()
    await state.loadDefaults()
    expect(state.weights).toEqual(SNAPSHOT_WEIGHTS)
    expect(state.defaultsSource).toBe('snapshot')
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining('快照兜底'),
      expect.objectContaining({
        snapshot: expect.objectContaining({ source: SNAPSHOT_PROVENANCE.source }),
      })
    )
  })

  it('once：同页多次调用只发一次请求；reset 后可重拉', async () => {
    mockApiRequest.mockResolvedValue(remoteDefaults())
    vi.spyOn(logger, 'info').mockImplementation(() => undefined)
    const state = useSiteSuitabilityStore()
    await Promise.all([state.loadDefaults(), state.loadDefaults()])
    expect(mockApiRequest).toHaveBeenCalledTimes(1)
    state.reset()
    expect(state.weights).toEqual(SNAPSHOT_WEIGHTS)
    expect(state.defaultsSource).toBe('pending')
    await state.loadDefaults()
    expect(mockApiRequest).toHaveBeenCalledTimes(2)
  })

  it('快照 ≈ 后端定稿向量（1e-4；漂移即红，两侧改一边必红一边）', () => {
    for (const [k, v] of Object.entries(FINAL_WEIGHTS)) {
      expect(SNAPSHOT_WEIGHTS[k as keyof typeof SNAPSHOT_WEIGHTS]).toBeCloseTo(v, 4)
    }
    expect(SNAPSHOT_MIN_LAND_FRAC).toBe(0.5)
  })
})
