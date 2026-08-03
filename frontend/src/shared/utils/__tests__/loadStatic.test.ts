/**
 * loadStatic 缓存上限测试（z050-FE）
 * 锁定：缓存条目超过 MAX_CACHE_SIZE(100) 时，按 LRU 近似淘汰最旧插入项，
 * 而非无界增长。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const fetchMock = vi.fn()
vi.stubGlobal('fetch', fetchMock)

import { clearStaticCache, loadStatic } from '../loadStatic'

beforeEach(() => {
  fetchMock.mockReset()
  clearStaticCache()
  fetchMock.mockImplementation(async (url: string) => ({
    ok: true,
    json: async () => ({ url }),
  }))
})

describe('loadStatic 缓存上限 (z050-FE)', () => {
  it('超过 100 条时淘汰最旧条目，重新请求被淘汰项会再次 fetch', async () => {
    const N = 120
    for (let i = 0; i < N; i++) {
      await loadStatic(`/data/t${i}.json`)
    }
    // 最旧的 /data/t0.json 应已被淘汰 → 重新请求触发一次新 fetch
    await loadStatic('/data/t0.json')
    // 初始 N 次 + t0 重新拉取 1 次；t1..t119 仍在 TTL 内命中，不再 fetch
    expect(fetchMock).toHaveBeenCalledTimes(N + 1)
  })

  it('未达上限时所有条目均命中缓存', async () => {
    const N = 50
    for (let i = 0; i < N; i++) {
      await loadStatic(`/data/s${i}.json`)
    }
    // 全部命中，无任何重新 fetch
    for (let i = 0; i < N; i++) {
      await loadStatic(`/data/s${i}.json`)
    }
    expect(fetchMock).toHaveBeenCalledTimes(N)
  })
})
