import { mount, flushPromises } from '@vue/test-utils'
import { ref } from 'vue'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// 依赖 mock 提升：组件在 import 期即读取 '@/shared' 等模块，工厂必须在常量初始化前可运行
const mocks = vi.hoisted(() => ({
  showWarning: vi.fn(),
  showError: vi.fn(),
  searchPois: vi.fn(),
  queryPath: vi.fn(),
  cancel: vi.fn(),
  updateRouteLayers: vi.fn(),
  clearRouteLayers: vi.fn(),
  isWithinThreeCities: vi.fn(),
}))

vi.mock('@/shared', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/shared')>()
  return {
    ...actual,
    logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn(), sampled: vi.fn() },
    showWarning: mocks.showWarning,
    showError: mocks.showError,
    // useGCS 提供像素/槽位尺寸（真实实现依赖视口监听，测试里给固定值）
    useGCS: () => ({
      cellPixel: ref(100),
      css: { cell8px: '8px', cell16px: '16px', cell4px: '4px' },
    }),
  }
})

// GCSPanel 只是布局壳（定位/尺寸由真实实现负责），用插槽透传壳替身
vi.mock('@/core', () => ({
  GCSPanel: { name: 'GCSPanel', template: '<div class="gcs-panel"><slot /></div>' },
}))

vi.mock('@/stores', () => ({
  useMapStore: () => ({ currentRenderer: null }),
}))

vi.mock('../../composables/useRouteApi', () => ({
  useRouteApi: () => ({
    queryPath: mocks.queryPath,
    searchPois: mocks.searchPois,
    calculating: ref(false),
    calcError: ref(''),
    cancel: mocks.cancel,
  }),
  RouteQueryCancelledError: class RouteQueryCancelledError extends Error {},
}))

vi.mock('../../composables/useRouteLayer', () => ({
  useRouteLayer: () => ({
    updateRouteLayers: mocks.updateRouteLayers,
    clearRouteLayers: mocks.clearRouteLayers,
  }),
  ROUTE_SLOT_KEYS: ['from', 'waypoint-1', 'waypoint-2', 'to'],
}))

vi.mock('../../composables/useCityBoundary', () => ({
  isWithinThreeCities: mocks.isWithinThreeCities,
}))

import RouteControlPanel from '../RouteControlPanel.vue'

/** 最近一次挂载的实例（afterEach 统一卸载） */
let lastWrapper: ReturnType<typeof mount> | undefined

const PORT_POI = {
  id: 'port-1',
  name: '北海港',
  type: 'port',
  source: 'port',
  city: '',
  district: null,
  lng: 109.1,
  lat: 21.5,
}

/** 挂载面板（manager 走 mock，只作为图层方法的透传载体）；
 *  登记实例供 afterEach 卸载——面板在 onMounted 注册了 document 级监听，不卸载会跨用例累积 */
function mountPanel() {
  lastWrapper = mount(RouteControlPanel, {
    props: { manager: {} as never },
  })
  return lastWrapper
}

/** 组件暴露的地图点击入口（页面经渲染器 click 转交） */
function mapPick(wrapper: ReturnType<typeof mountPanel>, lng: number, lat: number) {
  const vm = wrapper.vm as unknown as {
    handleMapPick: (lng: number, lat: number) => Promise<void>
  }
  return vm.handleMapPick(lng, lat)
}

function slotLabels(wrapper: ReturnType<typeof mountPanel>): string[] {
  return wrapper.findAll('.slot-btn').map((b) => b.text().replace(/\s+/g, ' ').trim())
}

describe('RouteControlPanel — 抓取/注入交互（2026-09-12 线上反馈回归）', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.searchPois.mockResolvedValue([PORT_POI])
    mocks.isWithinThreeCities.mockResolvedValue(true)
  })

  afterEach(() => {
    lastWrapper?.unmount()
    lastWrapper = undefined
  })

  it('无激活槽时选搜索结果 → 进入抓取态（搜索框变暂存点），点槽位才注入', async () => {
    const wrapper = mountPanel()
    await flushPromises()

    await wrapper.find('input.poi-search').trigger('focus')
    await flushPromises()
    expect(wrapper.find('.poi-drop').exists()).toBe(true)

    await wrapper.find('.poi-item').trigger('mousedown')
    await flushPromises()

    // 抓取态：搜索框被暂存条取代，来源标签来自服务端 source 字段，槽位**未**被自动填充
    expect(wrapper.find('.pending-chip').exists()).toBe(true)
    expect(wrapper.find('.pending-text').text()).toContain('北海港')
    expect(wrapper.find('.pending-src').text()).toBe('港口')
    expect(wrapper.find('input.poi-search').exists()).toBe(false)
    expect(slotLabels(wrapper)).toEqual(['+ 起点', '+ 途径点', '+ 途径点', '+ 终点'])

    // 点「起点」→ 注入并清空暂存
    await wrapper.findAll('.slot-btn')[0].trigger('click')
    await flushPromises()
    expect(slotLabels(wrapper)[0]).toContain('北海港')
    expect(wrapper.find('.pending-chip').exists()).toBe(false)
    expect(mocks.updateRouteLayers).not.toHaveBeenCalled() // 注入不等于查询
  })

  it('已激活槽时选搜索结果 → 直接落入该槽（保留快路径，且不再自动流转）', async () => {
    const wrapper = mountPanel()
    await flushPromises()

    await wrapper.findAll('.slot-btn')[2].trigger('click') // 激活「途径点 2」
    await flushPromises()
    await wrapper.find('.poi-item').trigger('mousedown')
    await flushPromises()

    expect(slotLabels(wrapper)[2]).toContain('北海港')
    expect(wrapper.find('.pending-chip').exists()).toBe(false)
    // 旧实现会流转到「终点」；现口径注入即结束，终点保持空
    expect(slotLabels(wrapper)[3]).toBe('+ 终点')
  })

  it('下拉打开时点地图 → 不再被静默丢弃：收起下拉并抓取暂存', async () => {
    const wrapper = mountPanel()
    await flushPromises()
    await wrapper.find('input.poi-search').trigger('focus')
    await flushPromises()
    expect(wrapper.find('.poi-drop').exists()).toBe(true)

    await mapPick(wrapper, 108.62, 21.72)
    await flushPromises()

    // 原实现此处 return：下拉不关、点丢失、查询按钮永远不可用
    expect(wrapper.find('.poi-drop').exists()).toBe(false)
    expect(wrapper.find('.pending-chip').exists()).toBe(true)
    expect(wrapper.find('.pending-text').text()).toContain('108.6200')

    await wrapper.findAll('.slot-btn')[3].trigger('click')
    await flushPromises()
    expect(slotLabels(wrapper)[3]).toContain('108.6200')
  })

  it('范围内校验失败（三市之外）→ 提示且不抓取', async () => {
    mocks.isWithinThreeCities.mockResolvedValue(false)
    const wrapper = mountPanel()
    await flushPromises()

    await mapPick(wrapper, 120, 30)
    await flushPromises()

    expect(mocks.showWarning).toHaveBeenCalled()
    expect(wrapper.find('.pending-chip').exists()).toBe(false)
  })

  it('外部点击（面板之外）→ 收起下拉，不再只能靠"选中某项"关闭', async () => {
    const wrapper = mountPanel()
    await flushPromises()
    await wrapper.find('input.poi-search').trigger('focus')
    await flushPromises()
    expect(wrapper.find('.poi-drop').exists()).toBe(true)

    document.body.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))
    await flushPromises()

    expect(wrapper.find('.poi-drop').exists()).toBe(false)
  })

  it('起终点齐备前「开始查询」禁用；齐备后点击走 queryPath 并回传摘要', async () => {
    mocks.queryPath.mockResolvedValue({
      found: true,
      mode: 'distance',
      distanceM: 3100,
      durationMin: 5.1,
      snapDistanceM: { from: 3, to: 20 },
      edgeCount: 4,
      coordinates: [
        [109.1, 21.5],
        [109.12, 21.52],
      ],
    })
    const wrapper = mountPanel()
    await flushPromises()

    const queryBtn = wrapper.find('.route-btn.primary')
    expect(queryBtn.attributes('disabled')).toBeDefined()

    // 终点：激活槽 → 选搜索结果（快路径直接落入该槽）
    await wrapper.findAll('.slot-btn')[3].trigger('click')
    await flushPromises()
    await wrapper.find('.poi-item').trigger('mousedown')
    await flushPromises()

    // 起点：激活槽 → 再选一次（下拉此时已关，本次点击必须重新展开而非"取消激活"）
    await wrapper.findAll('.slot-btn')[0].trigger('click')
    await flushPromises()
    await wrapper.find('.poi-item').trigger('mousedown')
    await flushPromises()

    expect(slotLabels(wrapper)[0]).toContain('北海港')
    expect(wrapper.find('.route-btn.primary').attributes('disabled')).toBeUndefined()
    await wrapper.find('.route-btn.primary').trigger('click')
    await flushPromises()

    expect(mocks.queryPath).toHaveBeenCalledTimes(1)
    expect(mocks.updateRouteLayers).toHaveBeenCalledTimes(1)
    expect(wrapper.emitted('query-result')?.[0]?.[0]).toMatchObject({ pointCount: 2 })
  })

  it('口径切换：默认最短；点「最快」后以 mode=time 立即重跑（v2 补的前端口径开关）', async () => {
    mocks.queryPath.mockResolvedValue({
      found: true,
      mode: 'distance',
      distanceM: 3100,
      durationMin: 5.1,
      snapDistanceM: { from: 3, to: 20 },
      edgeCount: 4,
      coordinates: [
        [109.1, 21.5],
        [109.12, 21.52],
      ],
    })
    const wrapper = mountPanel()
    await flushPromises()

    // 起终点各一次「地图抓取 → 点槽注入」
    await mapPick(wrapper, 109.1, 21.5)
    await wrapper.findAll('.slot-btn')[0].trigger('click')
    await flushPromises()
    await mapPick(wrapper, 109.2, 21.6)
    await wrapper.findAll('.slot-btn')[3].trigger('click')
    await flushPromises()

    await wrapper.find('.route-btn.primary').trigger('click')
    await flushPromises()
    expect(mocks.queryPath).toHaveBeenCalledTimes(1)
    expect((mocks.queryPath.mock.calls[0]?.[0] as { mode?: string })?.mode).toBe('distance')

    // 切「最快」→ 已有结果，必须立即重跑（否则用户以为开关是摆设）
    await wrapper.findAll('.mode-btn')[1].trigger('click')
    await flushPromises()
    expect(mocks.queryPath).toHaveBeenCalledTimes(2)
    expect((mocks.queryPath.mock.calls[1]?.[0] as { mode?: string })?.mode).toBe('time')
    expect(wrapper.find('.mode-btn.on').text()).toBe('最快')
  })
})
