// CesiumRenderer GeoJSON 加载回归测试（Cesium 引擎渲染链路，D 系列资源治理）
import type { FeatureCollection } from 'geojson'
import { describe, expect, it, vi } from 'vitest'

// 全量 mock cesium：提供显式具名导出（避免递归 Proxy 在 vitest 模块加载期崩溃），
// 仅暴露 GeoJsonDataSource.load 供测试可控（默认 resolve 空 entities）。
vi.mock('cesium', async () => {
  const { makeCesiumMock } = await import('./cesiumMock')
  return makeCesiumMock({
    // load 供测试逐例控制 resolve/reject（token 竞态保护）
    GeoJsonDataSource: { load: vi.fn().mockResolvedValue({ entities: { values: [] } }) },
  })
})

import { GeoJsonDataSource } from 'cesium'

import { CesiumRenderer, updateGeoJsonLayer } from '../CesiumRenderer'

const mockGeoJson: FeatureCollection = {
  type: 'FeatureCollection',
  features: [],
}

/**
 * 白盒测试访问类型：渲染器运行时成员 _geoJsonTokens
 * 未声明在类型中，需显式暴露供测试断言 token Map 状态（渲染器本体无 @ts-nocheck后已移除）。
 */
type CesiumRendererTestAccess = InstanceType<typeof CesiumRenderer> & {
  _geoJsonTokens: Map<string, unknown>
}

/**
 * LIF-7 验收：addGeoJsonLayer 的 _geoJsonTokens 管理
 * 1. 成功路径回收 token（token Map 不跨 id 累积）
 * 2. 陈旧（被更新的同 id 请求覆盖）请求失败时不触发 onError
 */
describe('CesiumRenderer.addGeoJsonLayer (LIF-7)', () => {
  function createRenderer(): CesiumRendererTestAccess {
    // container 用带 appendChild 的 mock，避免复用路径 CesiumViewerManager.mount 时崩溃
    // （cesiumViewerManager 是模块级单例，第二次构造会命中复用分支调用 el.appendChild）
    const container = { appendChild: vi.fn(), removeChild: vi.fn() } as unknown as HTMLElement
    return new CesiumRenderer(container) as unknown as CesiumRendererTestAccess
  }

  it('成功加载后回收 token（_geoJsonTokens 不累积）', async () => {
    const renderer = createRenderer()
    const onError = vi.fn()

    await renderer.addGeoJsonLayer('layer-a', mockGeoJson, { onError })

    expect(onError).not.toHaveBeenCalled()
    // 成功路径 delete(id)，token Map 应为空
    expect(renderer._geoJsonTokens.size).toBe(0)
  })

  it('陈旧（被更新的同 id 请求覆盖）请求失败不触发 onError', async () => {
    const renderer = createRenderer()
    const onError1 = vi.fn()
    const onError2 = vi.fn()

    // 两次加载都失败，模拟并发竞态：第一次先设 token1，第二次覆盖为 token2
    ;(GeoJsonDataSource.load as ReturnType<typeof vi.fn>).mockRejectedValue(
      new Error('load failed')
    )

    const p1 = renderer.addGeoJsonLayer('layer-stale', mockGeoJson, { onError: onError1 })
    const p2 = renderer.addGeoJsonLayer('layer-stale', mockGeoJson, { onError: onError2 })
    await Promise.all([p1, p2])

    // 陈旧请求（先发起、后被覆盖）失败不应调用其 onError
    expect(onError1).not.toHaveBeenCalled()
    // 最新请求失败时也会 delete token，Map 最终清空
    expect(renderer._geoJsonTokens.size).toBe(0)
  })
})

/**
 * W38：`updateGeoJsonLayer` 增量更新路径回归（此前零测试）。
 *
 * 缺口影响面：`layerAdapters.ts` 把 `updateGeoJsonLayer` 当**可选方法**取用，未实现时
 * 静默改走 create 重建 ⇒ 「增量到底走没走」在行为上不可观测；而 `CesiumRenderer.ts:1681-1682`
 * 的 `entry` 缺失分支是**静默返回**（不重建、无日志、无 onError）——「先 update 后 create」
 * 的时序竞态下更新会被无声吞掉，界面停在旧数据且无信号可定位。
 */
describe('CesiumRenderer.updateGeoJsonLayer (W38)', () => {
  function createRenderer(): CesiumRendererTestAccess {
    const container = { appendChild: vi.fn(), removeChild: vi.fn() } as unknown as HTMLElement
    return new CesiumRenderer(container) as unknown as CesiumRendererTestAccess
  }

  it('图层未注册（entry 缺失）⇒ 静默返回：不重建、不调 onError', async () => {
    const renderer = createRenderer()
    const onError = vi.fn()
    const addSpy = vi.spyOn(renderer, 'addGeoJsonLayer')

    await updateGeoJsonLayer(renderer, 'layer-missing', mockGeoJson, { onError })

    expect(addSpy).not.toHaveBeenCalled()
    expect(onError).not.toHaveBeenCalled()
  })

  it('有 entry 但 instance.load 非函数 ⇒ 回退重建（addGeoJsonLayer 被调用）', async () => {
    const renderer = createRenderer()
    const onError = vi.fn()
    // 手工登记一个非 dataSource 的 entry（_layers 是运行时成员，测试经白盒类型写入）
    ;(renderer as unknown as { _layers: Map<string, unknown> })._layers.set('layer-raw', {
      instance: {},
      options: {},
      visible: true,
    })
    // 回退分支调的是**自由函数** addGeoJsonLayer(renderer, …)（:1687），不是类方法
    // 包装 ⇒ spy 打在类方法上不会命中。用 _doRemoveLayer（自由函数 add 的第一步
    // 「先清除同 id 旧图层」）作为重建的可观测信号。
    const removeSpy = vi.spyOn(renderer, '_doRemoveLayer')

    await updateGeoJsonLayer(renderer, 'layer-raw', mockGeoJson, { onError })

    expect(removeSpy).toHaveBeenCalledTimes(1)
  })

  it('并发两次 update 同 id ⇒ 陈旧者的 onError 不触发', async () => {
    const renderer = createRenderer()
    const onError1 = vi.fn()
    const onError2 = vi.fn()
    ;(renderer as unknown as { _layers: Map<string, unknown> })._layers.set('layer-upd', {
      instance: { load: vi.fn().mockResolvedValue(undefined) },
      options: {},
      visible: true,
    })
    // 注意：走的是 entry.instance.load（不是 mock 的 GeoJsonDataSource.load）——
    // 上一条 add 路径用后者是因为 add 内部调它；update 的增量分支调前者。
    const load = vi.fn().mockRejectedValue(new Error('boom'))
    ;(
      (
        renderer as unknown as { _layers: Map<string, { instance: { load: unknown } }> }
      )._layers.get('layer-upd') as { instance: { load: unknown } }
    ).instance.load = load

    const p1 = updateGeoJsonLayer(renderer, 'layer-upd', mockGeoJson, { onError: onError1 })
    const p2 = updateGeoJsonLayer(renderer, 'layer-upd', mockGeoJson, { onError: onError2 })
    await Promise.all([p1, p2])

    // 陈旧请求（先发起、后被覆盖）失败不应调用其 onError——去掉 stale 早退即红
    expect(onError1).not.toHaveBeenCalled()
    expect(onError2).toHaveBeenCalledTimes(1)
  })
})
