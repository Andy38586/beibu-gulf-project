import { afterEach, describe, expect, it, vi } from 'vitest'

const loadStatic = vi.fn()
const loggerDebug = vi.fn()

vi.mock('@/shared', () => ({
  loadStatic: (...args: unknown[]) => loadStatic(...args),
  logger: { debug: (...args: unknown[]) => loggerDebug(...args) },
}))

interface BoundaryGeometry {
  type: string
  coordinates: unknown
}

const OUTER: number[][] = [
  [0, 0],
  [10, 0],
  [10, 10],
  [0, 10],
  [0, 0],
]
const HOLE: number[][] = [
  [4, 4],
  [6, 4],
  [6, 6],
  [4, 6],
  [4, 4],
]
const FAR: number[][] = [
  [100, 100],
  [110, 100],
  [110, 110],
  [100, 110],
  [100, 100],
]

const feature = (geometry: BoundaryGeometry) => ({ geometry })

/** 每个用例重取模块：boundaryCache / boundaryLoading 是模块级状态 */
async function loadModule() {
  vi.resetModules()
  return await import('../useCityBoundary')
}

describe('useCityBoundary — 钦北防三市选点校验（射线法 + 懒加载缓存）', () => {
  afterEach(() => {
    vi.clearAllMocks()
  })

  it('Polygon：面内 true、面外 false', async () => {
    loadStatic.mockResolvedValueOnce({
      features: [feature({ type: 'Polygon', coordinates: [OUTER] })],
    })
    const { isWithinThreeCities } = await loadModule()
    expect(await isWithinThreeCities(5, 5)).toBe(true)
    expect(await isWithinThreeCities(15, 5)).toBe(false)
  })

  it('Polygon 带洞：外环内且不在内环 ⇒ true，内环内 ⇒ false', async () => {
    loadStatic.mockResolvedValueOnce({
      features: [feature({ type: 'Polygon', coordinates: [OUTER, HOLE] })],
    })
    const { isWithinThreeCities } = await loadModule()
    expect(await isWithinThreeCities(2, 2)).toBe(true)
    expect(await isWithinThreeCities(5, 5)).toBe(false)
  })

  it('MultiPolygon：任一面命中即 true，全不命中 false', async () => {
    loadStatic.mockResolvedValueOnce({
      features: [feature({ type: 'MultiPolygon', coordinates: [[OUTER], [FAR]] })],
    })
    const { isWithinThreeCities } = await loadModule()
    expect(await isWithinThreeCities(5, 5)).toBe(true)
    expect(await isWithinThreeCities(105, 105)).toBe(true)
    expect(await isWithinThreeCities(50, 50)).toBe(false)
  })

  it('非面几何与非法 coordinates 被过滤；过滤后为空 ⇒ false（并记 debug 日志）', async () => {
    loadStatic.mockResolvedValueOnce({
      features: [
        feature({ type: 'Point', coordinates: [5, 5] }),
        feature({ type: 'Polygon', coordinates: 'not-an-array' }),
      ],
    })
    const { isWithinThreeCities } = await loadModule()
    expect(await isWithinThreeCities(5, 5)).toBe(false)
    expect(loggerDebug).toHaveBeenCalledWith(expect.stringContaining('0 个面'))
  })

  it('懒加载去重 + 模块级缓存：并发与后续调用合计只请求一次', async () => {
    loadStatic.mockResolvedValueOnce({
      features: [feature({ type: 'Polygon', coordinates: [OUTER] })],
    })
    const { isWithinThreeCities } = await loadModule()
    const [a, b] = await Promise.all([isWithinThreeCities(1, 1), isWithinThreeCities(2, 2)])
    expect([a, b]).toEqual([true, true])
    expect(await isWithinThreeCities(3, 3)).toBe(true)
    expect(loadStatic).toHaveBeenCalledTimes(1)
  })

  it('加载失败：抛错并复位 loading，下一次调用重试', async () => {
    loadStatic
      .mockRejectedValueOnce(new Error('network'))
      .mockResolvedValueOnce({ features: [feature({ type: 'Polygon', coordinates: [OUTER] })] })
    const { isWithinThreeCities } = await loadModule()
    await expect(isWithinThreeCities(1, 1)).rejects.toThrow('network')
    expect(await isWithinThreeCities(1, 1)).toBe(true)
    expect(loadStatic).toHaveBeenCalledTimes(2)
  })
})
