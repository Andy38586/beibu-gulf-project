// @vitest-environment jsdom
/* eslint-disable vue/one-component-per-file -- 本文件是 .ts 测试而非 SFC：集中定义 AppLayout 与三个重子组件的轻量替身，规则不适用 */
/**
 * DiversionPage 4×4 布局断言（W10-11 改造）：
 * 把用户四条要求落成可执行判据——
 *   ① 四个 GCSPanel 全部 4×4（原右上 4×3、右下 4×5 的超支/不足消除）；
 *   ② 桑基图在左下（anchor=top-left、offset-y=5.5，原在右下）；
 *   ③ 图层控制面板在右下（anchor=top-right、offset-y=5.5）；
 *   ④ 左上不再是文字清单，而是 BarChart，数据仍取自 result.transfer（不新增接口调用）。
 *
 * 布局断言直接读 GCSPanel 真实组件收到的 w/h/anchor/offset props（与其它页 GCS 规格同源），
 * 故 mount 真组件而非 shallowMount：AppLayout 以「渲染命名插槽」的替身承接（真身依赖路由/地图/store），
 * 图表与图层面板用轻量替身（ECharts 在 jsdom 无 canvas；LayerControlPanel 依赖 mapStore 图层目录）。
 *
 * 2026-10-04 位置收表之后：位置事实移到 `panels.ts` 注册表，模板只 v-bind。本文件补
 * 派生侧三判据（strict 零重叠 / cell=80 等于旧字面量 / cell=70 贴标题行），mount 侧的
 * 期望改由 `placementsFor(DIVERSION_PANELS, 80)` 派生——两侧对同一注册表断言。
 */
import { flushPromises, mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { defineComponent, h, nextTick } from 'vue'

import { BUSINESS_LAYER_MANAGER_KEY, type BusinessLayerManager, GCSPanel } from '@/core'
import {
  computeLayout,
  diversionArcLayerId,
  findOverlaps,
  placementsFor,
  SAFE_MARGIN,
  useGCS,
} from '@/shared'

import { DIVERSION_PANELS } from '../../panels'

const api = vi.hoisted(() => ({
  getBreakdown: vi.fn(),
  getCanalLine: vi.fn(),
  getPorts: vi.fn(),
}))

// 只替身数据适配器与静态港口取数：页面取数链路不动，断言其调用次数/参数
vi.mock('@/services/adapters/diversionAdapter', () => ({
  diversionAdapter: { getBreakdown: api.getBreakdown, getCanalLine: api.getCanalLine },
}))
vi.mock('@/services/mapDataService', () => ({
  mapDataService: { getPorts: api.getPorts },
}))

import DiversionPage from '../../DiversionPage.vue'

/** 真实 AppLayout 依赖路由/地图/store：以渲染 left/right 命名插槽的替身承接布局骨架 */
const AppLayoutStub = defineComponent({
  name: 'AppLayout',
  setup(_, { slots }) {
    return () => h('div', { class: 'stub-app-layout' }, [slots.left?.(), slots.right?.()])
  },
})

/** BarChart 替身：声明 props 供断言数据接线（ECharts 在 jsdom 无 canvas，不能挂真身） */
const BarChartStub = defineComponent({
  name: 'BarChart',
  props: {
    title: { type: String, default: '' },
    xData: { type: Array, default: () => [] },
    series: { type: Array, default: () => [] },
  },
  setup() {
    return () => h('div', { class: 'stub-bar-chart' })
  },
})

const SankeyChartStub = defineComponent({
  name: 'SankeyChart',
  props: {
    title: { type: String, default: '' },
    nodes: { type: Array, default: () => [] },
    links: { type: Array, default: () => [] },
  },
  setup() {
    return () => h('div', { class: 'stub-sankey-chart' })
  },
})

const LayerControlPanelStub = defineComponent({
  name: 'LayerControlPanel',
  setup() {
    return () => h('div', { class: 'stub-layer-control-panel' })
  },
})

const FIXTURE = {
  year: 2035,
  transfer: { year: 2035, coal: 428.68, grain: 837.555, ironOre: 313.64, sandCement: 0 },
  byPort: { qinzhou: { coal: 201.48, grain: 393.65, ironOre: 147.41, total: 742.54 } },
  // 三段口径（2026-10-02）：西江上行货 → 平陆运河 → 中文港名；拼音不得回流。
  // 三条出边补全（A3 联动测试需要三弧都在场）；byPort 夹具仍取最小形状（弧线不消费它）
  sankeyFlows: [
    { from: '西江上行货', to: '平陆运河', value: 742.54 },
    { from: '平陆运河', to: '钦州港', value: 742.54 },
    { from: '平陆运河', to: '北海港', value: 170 },
    { from: '平陆运河', to: '防城港', value: 300 },
  ],
}

const CANAL_FIXTURE = {
  lines: [
    {
      name: '平陆运河（示意线）',
      section: '起点-平塘江口',
      coordinates: [
        [109.29, 22.7],
        [108.62, 21.87],
      ],
    },
  ],
}

const PORTS_FIXTURE = [
  {
    id: '1',
    name: '钦州港口岸',
    address: '',
    lng: 108.590379,
    lat: 21.726917,
    type: '货运港口码头',
  },
  { id: '2', name: '防城港', address: '', lng: 108.340973, lat: 21.617689, type: '货运港口码头' },
  { id: '3', name: '北海国际客运港', address: '', lng: 109.130658, lat: 21.418792, type: '客运港' },
]

/** 分流页会经 useDiversionLayer 注册图层：provide 假 manager 接住注册并暴露注册表供断言 */
function mountPage() {
  const registry = new Map<string, { options: Record<string, unknown> }>()
  const fakeManager = {
    has: (key: string) => registry.has(key),
    register: (key: string, desc: { options: Record<string, unknown> }) => {
      registry.set(key, desc)
    },
    updateData: (key: string, payload: { options?: Record<string, unknown> }) => {
      const prev = registry.get(key)
      if (prev) registry.set(key, { options: payload.options ?? prev.options })
    },
    remove: (key: string) => {
      registry.delete(key)
    },
  } as unknown as Pick<BusinessLayerManager, 'has' | 'register' | 'updateData' | 'remove'>
  const wrapper = mount(DiversionPage, {
    global: {
      provide: {
        [BUSINESS_LAYER_MANAGER_KEY]: fakeManager as unknown as BusinessLayerManager,
      },
      stubs: {
        AppLayout: AppLayoutStub,
        BarChart: BarChartStub,
        SankeyChart: SankeyChartStub,
        LayerControlPanel: LayerControlPanelStub,
      },
    },
  })
  return { wrapper, registry }
}

/** 定位包含指定子元素的 GCSPanel（四面板各含唯一识别物，不会歧义） */
function panelWithClass(wrapper: ReturnType<typeof mountPage>['wrapper'], selector: string) {
  const panel = wrapper.findAllComponents(GCSPanel).find((p) => p.find(selector).exists())
  if (!panel) throw new Error(`未找到包含 ${selector} 的 GCSPanel`)
  return panel
}

/** mount 侧期望：注册表在 cell=80 的派生值（与模板同源，不手抄字面量） */
const CELL80 = placementsFor(DIVERSION_PANELS, 80)

describe('DiversionPage 布局派生（注册表 → props）', () => {
  it('1320×800 strict：零重叠 + 不溢出 + 不越界', () => {
    const layout = computeLayout(DIVERSION_PANELS, { width: 1320, height: 800 }, 'desktop', {
      strict: true,
    })
    expect(layout.overflow).toEqual([])
    expect(findOverlaps(layout.rects)).toEqual([])
    for (const r of layout.rects) {
      expect(r.x).toBeGreaterThanOrEqual(SAFE_MARGIN)
      expect(r.x + r.w).toBeLessThanOrEqual(1320 - SAFE_MARGIN)
      expect(r.y + r.h).toBeLessThanOrEqual(800 - SAFE_MARGIN)
    }
  })

  it('cell=80 派生值等于旧字面量 1.25/5.5（像素零变化）', () => {
    expect(placementsFor(DIVERSION_PANELS, 80)).toEqual({
      transfer: { w: 4, h: 4, anchor: 'top-left', offsetX: 0, offsetY: 1.25 },
      sankey: { w: 4, h: 4, anchor: 'top-left', offsetX: 0, offsetY: 5.5 },
      year: { w: 4, h: 4, anchor: 'top-right', offsetX: 0, offsetY: 1.25 },
      layers: { w: 4, h: 4, anchor: 'top-right', offsetX: 0, offsetY: 5.5 },
    })
  })

  it('cell=70 首面板顶边贴标题行底（旧字面量差 2.5px 即红）', () => {
    const first = placementsFor(DIVERSION_PANELS, 70).transfer
    expect(20 + first.offsetY * 70).toBeCloseTo(110)
  })
})

describe('DiversionPage 4×4 布局', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('四个 GCSPanel 全部 4×4，槽位与目标布局一致', async () => {
    api.getBreakdown.mockResolvedValue(FIXTURE)
    const { wrapper } = mountPage()
    await flushPromises()

    const panels = wrapper.findAllComponents(GCSPanel)
    expect(panels).toHaveLength(4)
    for (const panel of panels) {
      expect(panel.props('w')).toBe(4)
      expect(panel.props('h')).toBe(4)
    }

    // 左上：转移量图表；左下：桑基图；右上：年份控制；右下：图层面板（位置期望由注册表派生）
    expect(panelWithClass(wrapper, '.stub-bar-chart').props()).toMatchObject(CELL80.transfer)
    expect(panelWithClass(wrapper, '.stub-sankey-chart').props()).toMatchObject(CELL80.sankey)
    expect(panelWithClass(wrapper, '.year-panel').props()).toMatchObject(CELL80.year)
    expect(panelWithClass(wrapper, '.stub-layer-control-panel').props()).toMatchObject(
      CELL80.layers
    )

    wrapper.unmount()
  })

  it('左上为 BarChart（原文字清单已删除），四货类与数值取自 result.transfer', async () => {
    api.getBreakdown.mockResolvedValue(FIXTURE)
    const { wrapper } = mountPage()
    await flushPromises()

    const barPanel = panelWithClass(wrapper, '.stub-bar-chart')
    // 原文字清单结构（面板/行/脚注三段）不再存在——已合并为图 + 一行脚注
    expect(wrapper.find('.info-panel').exists()).toBe(false)
    expect(wrapper.find('.info-row').exists()).toBe(false)
    expect(wrapper.find('.info-note').exists()).toBe(false)

    const bar = barPanel.findComponent({ name: 'BarChart' })
    expect(bar.props('xData')).toEqual(['煤炭', '粮食', '铁矿石', '砂石水泥'])
    expect(bar.props('series')).toEqual([
      { name: '转移量（万吨/年）', data: [428.68, 837.555, 313.64, 0] },
    ])
    expect(String(bar.props('title'))).toContain('2035')

    // 不新增接口调用：首屏仍只有适配器这一次取数
    expect(api.getBreakdown).toHaveBeenCalledTimes(1)
    expect(api.getBreakdown).toHaveBeenCalledWith(2035)

    wrapper.unmount()
  })

  it('加载中渲染 ChartLoading（与其它页一致的加载态）', async () => {
    let resolveLoad: (value: unknown) => void = () => {}
    api.getBreakdown.mockReturnValue(
      new Promise((resolve) => {
        resolveLoad = resolve
      })
    )
    const { wrapper } = mountPage()
    await wrapper.vm.$nextTick()

    expect(wrapper.find('[role="status"]').exists()).toBe(true)

    resolveLoad(FIXTURE)
    await flushPromises()
    expect(wrapper.find('[role="status"]').exists()).toBe(false)

    wrapper.unmount()
  })

  it('桑基图空态语义保持：无 sankeyFlows 时左下显示「暂无数据」', async () => {
    api.getBreakdown.mockResolvedValue({ ...FIXTURE, sankeyFlows: [] })
    const { wrapper } = mountPage()
    await flushPromises()

    expect(wrapper.find('.stub-sankey-chart').exists()).toBe(false)
    const sankeyPanel = panelWithClass(wrapper, '.empty')
    expect(sankeyPanel.find('.empty').text()).toBe('暂无数据')
    expect(sankeyPanel.props()).toMatchObject(CELL80.sankey)

    wrapper.unmount()
  })

  it('年份滑块收进卡片：默认无 range，点击卡片才出现；输入经 300ms 防抖以新年份取数', async () => {
    api.getBreakdown.mockResolvedValue(FIXTURE)
    const { wrapper } = mountPage()
    await flushPromises()
    expect(api.getBreakdown).toHaveBeenCalledTimes(1)

    // 默认：整页 0 个 range（年份滑块被收进卡片）；年份面板是按钮卡片（三态卡片已选态）
    expect(wrapper.findAll('input[type="range"]')).toHaveLength(0)
    const yearPanel = panelWithClass(wrapper, '.year-panel')
    expect(yearPanel.findAll('input[type="range"]')).toHaveLength(0)
    const card = yearPanel.find('button.ssc')
    expect(card.exists()).toBe(true)
    expect(card.find('.ssc-label').text()).toBe('年份')
    expect(card.find('.ssc-status').text()).toBe('2035')

    // 点击卡片 → 选择态才渲染滑块，值=当前年份，档位=2027..2050
    await card.trigger('click')
    const slider = yearPanel.find('input[type="range"]')
    expect(slider.exists()).toBe(true)
    expect((slider.element as HTMLInputElement).value).toBe('2035')
    expect(slider.attributes('min')).toBe('2027')
    expect(slider.attributes('max')).toBe('2050')
    expect(slider.attributes('step')).toBe('1')

    // 输入 2040：300ms 内不取数（防抖），300ms 后用新年份取一次；卡片状态文案同步
    await slider.setValue('2040')
    await new Promise((resolve) => setTimeout(resolve, 150))
    expect(api.getBreakdown).toHaveBeenCalledTimes(1)
    await new Promise((resolve) => setTimeout(resolve, 250))
    await flushPromises()
    expect(api.getBreakdown).toHaveBeenCalledTimes(2)
    expect(api.getBreakdown).toHaveBeenLastCalledWith(2040)
    expect(yearPanel.find('.ssc-status').text()).toBe('2040')

    wrapper.unmount()
  })

  it('桑基点击联动（A3）：点港节点→对应弧高亮、再点取消、点「平陆运河」→运河线高亮', async () => {
    api.getBreakdown.mockResolvedValue(FIXTURE)
    api.getCanalLine.mockResolvedValue(CANAL_FIXTURE)
    api.getPorts.mockResolvedValue(PORTS_FIXTURE)
    const { wrapper, registry } = mountPage()
    await flushPromises()

    const arcColor = (portId: string): unknown =>
      registry.get(diversionArcLayerId(portId))?.options.strokeColor
    const canalColor = (): unknown => registry.get('diversion-canal')?.options.strokeColor

    // 几何底座到位：运河线 + 三弧全部注册
    expect(registry.has('diversion-canal')).toBe(true)
    expect(arcColor('qinzhou')).toBeDefined()
    expect(arcColor('beihai')).toBeDefined()

    const sankey = wrapper.findComponent({ name: 'SankeyChart' })
    const normal = arcColor('beihai')

    // 点「北海港」节点 → 北海弧高亮，其余保持常规色
    sankey.vm.$emit('sankey-click', { kind: 'node', name: '北海港' })
    await nextTick()
    expect(arcColor('beihai')).not.toBe(normal)
    expect(arcColor('qinzhou')).toBe(normal)

    // 再点同港 → 取消高亮
    sankey.vm.$emit('sankey-click', { kind: 'node', name: '北海港' })
    await nextTick()
    expect(arcColor('beihai')).toBe(normal)

    // 点「平陆运河」节点 → 运河线高亮（弧线全回常规色）
    const canalNormal = canalColor()
    sankey.vm.$emit('sankey-click', { kind: 'node', name: '平陆运河' })
    await nextTick()
    expect(canalColor()).not.toBe(canalNormal)
    expect(arcColor('beihai')).toBe(normal)

    // 点边（平陆运河→钦州港）→ 钦州弧高亮（边按目标港定位）
    sankey.vm.$emit('sankey-click', {
      kind: 'edge',
      name: '',
      source: '平陆运河',
      target: '钦州港',
    })
    await nextTick()
    expect(arcColor('qinzhou')).not.toBe(normal)
    expect(canalColor()).toBe(canalNormal)

    wrapper.unmount()
  })

  it('cell=70 档：模板绑定跟随注册表（位置回写字面量即红，不依赖文本扫描）', async () => {
    api.getBreakdown.mockResolvedValue(FIXTURE)
    const { cellPixel } = useGCS()
    const original = cellPixel.value
    cellPixel.value = 70
    try {
      const derived70 = placementsFor(DIVERSION_PANELS, 70)
      // 阳性对照：两档派生值确实不同（否则本用例对"回写字面量"零分辨力）
      expect(derived70.transfer.offsetY).not.toBe(1.25)
      expect(derived70.sankey.offsetY).not.toBe(5.5)

      const { wrapper } = mountPage()
      await flushPromises()
      expect(panelWithClass(wrapper, '.stub-bar-chart').props()).toMatchObject(derived70.transfer)
      expect(panelWithClass(wrapper, '.stub-sankey-chart').props()).toMatchObject(derived70.sankey)
      expect(panelWithClass(wrapper, '.year-panel').props()).toMatchObject(derived70.year)
      expect(panelWithClass(wrapper, '.stub-layer-control-panel').props()).toMatchObject(
        derived70.layers
      )
      wrapper.unmount()
    } finally {
      cellPixel.value = original
    }
  })
})
