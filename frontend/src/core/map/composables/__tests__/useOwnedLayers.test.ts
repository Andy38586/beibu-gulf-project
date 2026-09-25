// @vitest-environment jsdom
/**
 * useOwnedLayers 的自测。
 *
 * 这三条钉的是「结构上做不到违反」这件事本身：
 *   - 页面**没有**写 remove 这个动作，条目却在卸载后被清干净；
 *   - 卸载后晚到的注册被拒收（921/922 反复出现的「卸载后仍注册」路径）；
 *   - 主动注销过的键不会在卸载时重复清（归属册与实际一致）。
 *
 * 其中第一条就是「删掉结构约束会不会红」的判据：把 useOwnedLayers 里的
 * onScopeDispose(releaseAll) 删掉，第一条立刻红。
 */
import { mount } from '@vue/test-utils'
import { defineComponent, h } from 'vue'
import { describe, expect, it, vi } from 'vitest'

import { BUSINESS_LAYER_MANAGER_KEY, useOwnedLayers } from '@/core'

/** 记录调用顺序的假 manager：顺序本身就是判据（注册/清理的时序） */
function fakeManager() {
  const calls: string[] = []
  const manager = {
    register: vi.fn((key: string) => {
      calls.push(`register:${key}`)
    }),
    updateData: vi.fn(),
    setVisible: vi.fn(),
    remove: vi.fn((key: string) => {
      calls.push(`remove:${key}`)
    }),
    has: vi.fn(() => false),
    removeAll: vi.fn(),
    getMeta: vi.fn(() => null),
    reapplyAll: vi.fn(),
    isLayerVisible: vi.fn(() => false),
  }
  return { manager, calls }
}

const DESC = { label: 'x', layerType: 'geojson', data: null } as never
const DESC_WITH_DATA = { label: 'x', layerType: 'geojson', data: [1] } as never
const MOUNT_OPTS = (manager: unknown) => ({
  global: { provide: { [BUSINESS_LAYER_MANAGER_KEY]: manager } },
})

describe('useOwnedLayers — 图层归属结构约束', () => {
  it('注册即登记：作用域销毁自动清掉本 owner 全部图层（页面不写 remove）', () => {
    const { manager, calls } = fakeManager()
    const wrapper = mount(
      defineComponent({
        setup() {
          const owned = useOwnedLayers('t')
          owned.register('a', DESC)
          owned.register('b', DESC)
          return () => h('div')
        },
      }),
      MOUNT_OPTS(manager)
    )
    // 卸载前：只有注册，页面侧没有任何 remove 动作（这就是被收窄的那个结构）
    expect(calls).toEqual(['register:a', 'register:b'])
    wrapper.unmount()
    expect(calls).toEqual(['register:a', 'register:b', 'remove:a', 'remove:b'])
  })

  it('@guard-red-sample applyOrUpdate：首次注册、再次只更新（不重复注册）', () => {
    const { manager, calls } = fakeManager()
    const wrapper = mount(
      defineComponent({
        setup() {
          const owned = useOwnedLayers('t')
          owned.applyOrUpdate('a', DESC)
          owned.applyOrUpdate('a', DESC_WITH_DATA)
          return () => h('div')
        },
      }),
      MOUNT_OPTS(manager)
    )
    // 注册只发生一次，第二次走 updateData —— 这就是被收掉的那句「has() ? register : updateData」样板
    expect(calls).toEqual(['register:a'])
    expect(manager.register).toHaveBeenCalledTimes(1)
    expect(manager.updateData).toHaveBeenCalledTimes(1)
    expect(manager.updateData).toHaveBeenCalledWith('a', { data: [1], options: undefined })
    wrapper.unmount()
    expect(calls).toEqual(['register:a', 'remove:a'])
  })

  it('@guard-red-sample applyOrUpdate：卸载后到达 ⇒ 拒收，且不碰引擎', () => {
    const { manager } = fakeManager()
    let owned!: ReturnType<typeof useOwnedLayers>
    const wrapper = mount(
      defineComponent({
        setup() {
          owned = useOwnedLayers('t')
          return () => h('div')
        },
      }),
      MOUNT_OPTS(manager)
    )
    wrapper.unmount()
    expect(owned.applyOrUpdate('late', DESC)).toBe(false)
    expect(manager.register).not.toHaveBeenCalled()
    expect(manager.updateData).not.toHaveBeenCalled()
  })

  it('卸载后到达的注册一律拒收（异步边：fetch 回包晚到）', () => {
    const { manager, calls } = fakeManager()
    let late: ((key: string, desc: never) => boolean) | undefined
    const wrapper = mount(
      defineComponent({
        setup() {
          late = useOwnedLayers('t').register
          return () => h('div')
        },
      }),
      MOUNT_OPTS(manager)
    )
    wrapper.unmount()
    expect(late!('late', DESC)).toBe(false)
    // 既没注册、也无需清理 —— 「卸载后仍向 App 级单例注册」这条路径结构上不存在了
    expect(calls).toEqual([])
  })

  it('主动注销过的键出册，卸载时不重复清', () => {
    const { manager, calls } = fakeManager()
    const wrapper = mount(
      defineComponent({
        setup() {
          const owned = useOwnedLayers('t')
          owned.register('a', DESC)
          owned.unregister('a')
          owned.register('b', DESC)
          return () => h('div')
        },
      }),
      MOUNT_OPTS(manager)
    )
    wrapper.unmount()
    expect(calls).toEqual(['register:a', 'remove:a', 'register:b', 'remove:b'])
  })
})
