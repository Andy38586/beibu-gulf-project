// BottomNavBar 三档位响应式测试（2026-08-09 类型补全后新增——档位逻辑此前零覆盖）
import { mount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mockPush = vi.fn()
const { mockPreloadCesium } = vi.hoisted(() => ({ mockPreloadCesium: vi.fn() }))

vi.mock('../../map/renderers', () => ({ preloadCesium: mockPreloadCesium }))

vi.mock('vue-router', () => ({
  useRoute: () => ({ path: '/' }),
  useRouter: () => ({
    push: mockPush,
    // 供 BottomNavBar 的 3D 意图预取判定：只有 3D 路由（浸没/航线）才预取
    resolve: (p: string) => ({
      path: p,
      meta: { engine: p === '/flood-analysis' || p === '/route-analysis' ? '3d' : '2d' },
    }),
  }),
}))

import BottomNavBar from '../components/BottomNavBar.vue'
import { registerNavItems } from '../navConfig'
import { useMobileDrawer } from '../useMobileDrawer'

/** 模拟视口宽度并触发 useGCS 的 resize 防抖 */
async function setViewport(width: number) {
  Object.defineProperty(window, 'innerWidth', { value: width, writable: true, configurable: true })
  window.dispatchEvent(new Event('resize'))
  // useGCS 的 resize 防抖 150ms
  await new Promise((r) => setTimeout(r, 200))
}

/** 渲染后提取按钮文本（NavButton 与 GCSButton 的 label+icon 拼接） */
function buttonLabels(wrapper: ReturnType<typeof mount>) {
  return wrapper
    .findAll('.GCS-button')
    .map((b) => b.text().replace(/\s+/g, ''))
    .filter((t) => t.length > 0)
}

/** 断言按钮文本包含子串 */
function hasLabel(labels: string[], label: string): boolean {
  return labels.some((l) => l.includes(label))
}

describe('BottomNavBar 三档位', () => {
  beforeEach(() => {
    mockPush.mockReset()
    mockPreloadCesium.mockReset()
    registerNavItems([
      { type: 'home', label: '首页', icon: '⌂', path: '/', disabled: false },
      { type: 'business', label: '预测', icon: '📊', path: '/forecast', disabled: false },
      { type: 'business', label: '分流', icon: '≋', path: '/diversion-analysis', disabled: false },
      { type: 'business', label: '浸没', icon: '🌊', path: '/flood-analysis', disabled: false },
      { type: 'business', label: '航线', icon: '🚢', path: '/route-analysis', disabled: true },
      { type: 'profile', label: '个人中心', icon: '👤', path: '/profile', disabled: false },
    ])
  })

  afterEach(() => {
    document.body.innerHTML = ''
  })

  it('档位 1（≥960px）：6 键——首页+4 业务+个人中心，无菜单键', async () => {
    await setViewport(1200)
    const wrapper = mount(BottomNavBar)
    const labels = buttonLabels(wrapper)
    expect(labels).toHaveLength(6)
    expect(hasLabel(labels, '首页')).toBe(true)
    expect(hasLabel(labels, '分流')).toBe(true)
    expect(hasLabel(labels, '航线')).toBe(true)
    expect(hasLabel(labels, '个人中心')).toBe(true)
    expect(hasLabel(labels, '菜单')).toBe(false)
  })

  it('档位 2（640~959px）：7 键——业务保留 + 菜单键', async () => {
    await setViewport(800)
    const wrapper = mount(BottomNavBar)
    const labels = buttonLabels(wrapper)
    expect(labels).toHaveLength(7)
    expect(hasLabel(labels, '分流')).toBe(true)
    expect(hasLabel(labels, '菜单')).toBe(true)
  })

  it('档位 3（<640px）：3 键——首页/个人中心/菜单，业务收敛', async () => {
    await setViewport(375)
    const wrapper = mount(BottomNavBar)
    const labels = buttonLabels(wrapper)
    expect(labels).toHaveLength(3)
    expect(hasLabel(labels, '首页')).toBe(true)
    expect(hasLabel(labels, '个人中心')).toBe(true)
    expect(hasLabel(labels, '菜单')).toBe(true)
    expect(hasLabel(labels, '分流')).toBe(false)
  })

  it('点击导航项调用 router.push', async () => {
    await setViewport(1200)
    const wrapper = mount(BottomNavBar)
    const siteBtn = wrapper.findAll('.GCS-button').find((b) => b.text().includes('分流'))!
    await siteBtn.trigger('click')
    expect(mockPush).toHaveBeenCalledWith('/diversion-analysis')
  })

  it('禁用项点击不跳转', async () => {
    await setViewport(1200)
    const wrapper = mount(BottomNavBar)
    const routeBtn = wrapper.findAll('.GCS-button').find((b) => b.text().includes('航线'))!
    await routeBtn.trigger('click')
    expect(mockPush).not.toHaveBeenCalled()
  })

  it('悬停 3D 导航项触发 Cesium 意图预取（治 z037：点进去要等 10s+）', async () => {
    await setViewport(1200)
    const wrapper = mount(BottomNavBar)
    // mouseenter 不冒泡：必须打在外层包裹元素（真实悬停的作用域），不能打内层按钮
    const floodWrap = wrapper.findAll('.nav-button-wrap').find((w) => w.text().includes('浸没'))!
    await floodWrap.trigger('mouseenter')
    expect(mockPreloadCesium).toHaveBeenCalledTimes(1)
    // 键盘可达性同等对待（focusin 会冒泡到包裹层）
    await floodWrap.find('.GCS-button').trigger('focusin')
    expect(mockPreloadCesium).toHaveBeenCalledTimes(2)
  })

  it('悬停 2D 导航项不预取（不抢首屏带宽）', async () => {
    await setViewport(1200)
    const wrapper = mount(BottomNavBar)
    const siteWrap = wrapper.findAll('.nav-button-wrap').find((w) => w.text().includes('分流'))!
    await siteWrap.trigger('mouseenter')
    expect(mockPreloadCesium).not.toHaveBeenCalled()
  })

  it('禁用项悬停不预取', async () => {
    await setViewport(1200)
    const wrapper = mount(BottomNavBar)
    const routeWrap = wrapper.findAll('.nav-button-wrap').find((w) => w.text().includes('航线'))!
    await routeWrap.trigger('mouseenter')
    expect(mockPreloadCesium).not.toHaveBeenCalled()
  })

  it('档位 2/3 菜单键点击切换抽屉状态', async () => {
    const { drawerOpen, closeDrawer } = useMobileDrawer()
    closeDrawer()
    await setViewport(800)
    const wrapper = mount(BottomNavBar)
    const menuBtn = wrapper.findAll('.GCS-button').find((b) => b.text().includes('菜单'))!
    await menuBtn.trigger('click')
    expect(drawerOpen.value).toBe(true)
  })
})
