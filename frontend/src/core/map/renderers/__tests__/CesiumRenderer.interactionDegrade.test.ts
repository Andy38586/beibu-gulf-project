// CesiumRenderer 交互期降载（z038②）行为测试：
// 相机 moveStart 隐藏重图层（顶点规模达阈值），moveEnd 按各图层 visible 权威值恢复；
// 隐藏只切引擎侧 show，不得改写面板权威值（否则恢复时用错值 = 图层永久消失）。
import { describe, expect, it, vi } from 'vitest'

// Primitive 用可回读 show 的普通对象；其余导出走共享工厂
vi.mock('cesium', async () => {
  const { makeCesiumMock } = await import('./cesiumMock')
  return makeCesiumMock({
    Primitive: class TestPrimitive {
      show = true
    },
  })
})

import { countCoordinatePairs, setupCameraDebounce } from '../../perf/cameraPerf'
import { CesiumRenderer, destroyEvents } from '../CesiumRenderer'

/** 记录监听器的 Cesium 事件替身 */
function makeEvent() {
  const handlers = new Set<() => void>()
  return {
    addEventListener: vi.fn((fn: () => void) => handlers.add(fn)),
    removeEventListener: vi.fn((fn: () => void) => handlers.delete(fn)),
    fire: () => handlers.forEach((fn) => fn()),
    handlers,
  }
}

function makeRenderer() {
  // container 用带 appendChild 的 mock，避免复用路径 CesiumViewerManager.mount 时崩溃
  const container = { appendChild: vi.fn(), removeChild: vi.fn() } as unknown as HTMLElement
  const renderer = new CesiumRenderer(container)
  const camera = { changed: makeEvent(), moveStart: makeEvent(), moveEnd: makeEvent() }
  const scene = { requestRender: vi.fn() }
  const entities: Array<{ show?: boolean }> = []
  const primitives: Array<{ show: boolean }> = []
  renderer.viewer = {
    isDestroyed: () => false,
    scene: {
      ...scene,
      primitives: {
        add: vi.fn((primitive: { show: boolean }) => {
          primitives.push(primitive)
          return primitive
        }),
        remove: vi.fn(),
      },
    },
    camera,
    entities: {
      add: vi.fn((entity: { show?: boolean }) => {
        entities.push(entity)
        return entity
      }),
      values: entities,
      remove: vi.fn(),
    },
  } as never
  return { renderer, camera, scene, entities, primitives }
}

/** 3001 个坐标对 ⇒ 越过 3000 顶点降载阈值，addPolygonLayer 会登记 interactionHeavy */
function heavyPolygon() {
  const ring: Array<[number, number]> = Array.from({ length: 3001 }, (_, i) => [
    108.5 + i * 1e-5,
    21.5,
  ])
  return [{ geometry: { type: 'Polygon' as const, coordinates: [ring] }, properties: {} }]
}

describe('CesiumRenderer 交互期降载（z038②）', () => {
  it('countCoordinatePairs：GeoJSON 嵌套形态计数（Polygon/MultiPolygon/非法输入）', () => {
    expect(countCoordinatePairs(undefined)).toBe(0)
    expect(countCoordinatePairs([])).toBe(0)
    // Polygon: 外环 3 点
    expect(
      countCoordinatePairs([
        [
          [0, 0],
          [1, 0],
          [1, 1],
        ],
      ])
    ).toBe(3)
    // MultiPolygon: 两部件各 3 点
    expect(
      countCoordinatePairs([
        [
          [
            [0, 0],
            [1, 0],
            [1, 1],
          ],
        ],
        [
          [
            [2, 2],
            [3, 2],
            [3, 3],
          ],
        ],
      ])
    ).toBe(6)
  })

  it('moveStart 隐藏重图层、moveEnd 按 visible 恢复；轻图层不动', () => {
    const { renderer, camera, entities } = makeRenderer()
    setupCameraDebounce(renderer)
    renderer.addPolygonLayer('flood-area', heavyPolygon(), {})
    const heavy = entities.slice()
    const heavyCount = heavy.length
    renderer.addPointLayer('ports', [{ id: 'p1', lng: 108.5, lat: 21.5 }], {})
    const light = entities.slice(heavyCount)

    expect(heavy.length).toBeGreaterThan(0)
    expect(light).toHaveLength(1)

    camera.moveStart.fire()
    expect(heavy.every((e) => e.show === false)).toBe(true)
    expect(light[0].show).not.toBe(false)
    // 隐藏期不改面板权威值（恢复判据）
    expect(renderer.isLayerVisible('flood-area')).toBe(true)

    camera.moveEnd.fire()
    expect(heavy.every((e) => e.show === true)).toBe(true)
  })

  it('用户已隐藏的重图层：恢复时保持隐藏（按 visible 权威值，不亮回来）', () => {
    const { renderer, camera, entities } = makeRenderer()
    setupCameraDebounce(renderer)
    renderer.addPolygonLayer('hidden-heavy', heavyPolygon(), {})
    renderer.setVisibility('hidden-heavy', false)
    const heavy = entities.slice()
    expect(heavy.every((e) => e.show === false)).toBe(true)

    camera.moveStart.fire()
    expect(heavy.every((e) => e.show === false)).toBe(true)
    camera.moveEnd.fire()
    expect(heavy.every((e) => e.show === false)).toBe(true)
    expect(renderer.isLayerVisible('hidden-heavy')).toBe(false)
  })

  it('水面（Primitive）同受降载；恢复不改写 water.visible', async () => {
    const { renderer, camera, primitives } = makeRenderer()
    setupCameraDebounce(renderer)
    const coordinates: Array<[number, number]> = Array.from({ length: 3001 }, (_, i) => [
      108.5 + i * 1e-5,
      21.5,
    ])
    await expect(renderer.addWaterSurface('water', coordinates, 1)).resolves.toBe(true)
    const [primitive] = primitives

    camera.moveStart.fire()
    expect(primitive.show).toBe(false)
    expect(renderer.isLayerVisible('water')).toBe(true)
    camera.moveEnd.fire()
    expect(primitive.show).toBe(true)
  })

  it('销毁时摘除 moveStart/moveEnd 监听（与 changed 同契约，防单例 Viewer 上累加）', () => {
    const { renderer, camera } = makeRenderer()
    setupCameraDebounce(renderer)
    expect(camera.moveStart.handlers.size).toBe(1)
    expect(camera.moveEnd.handlers.size).toBe(1)

    destroyEvents(renderer)
    expect(camera.moveStart.removeEventListener).toHaveBeenCalled()
    expect(camera.moveEnd.removeEventListener).toHaveBeenCalled()
    expect(camera.moveStart.handlers.size).toBe(0)
    expect(camera.moveEnd.handlers.size).toBe(0)
    expect(camera.changed.handlers.size).toBe(0)
  })
})
