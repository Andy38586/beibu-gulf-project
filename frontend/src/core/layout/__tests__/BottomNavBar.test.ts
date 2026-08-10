// BottomNavBar 三档位响应式测试（2026-08-09 类型补全后新增——档位逻辑此前零覆盖）
import { mount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mockPush = vi.fn()
vi.mock('vue-router', () => ({
  useRoute: () => ({ path: '/' }),
  useRouter: () => ({ push: mockPush }),
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
    registerNavItems([
      { type: 'home', label: '首页', icon: '⌂', path: '/', disabled: false },
      { type: 'business', label: '选址', icon: '◈', path: '/site-selection', disabled: false },
      { type: 'business', label: '预测', icon: '📊', path: '/forecast', disabled: false },
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
    expect(hasLabel(labels, '选址')).toBe(true)
    expect(hasLabel(labels, '航线')).toBe(true)
    expect(hasLabel(labels, '个人中心')).toBe(true)
    expect(hasLabel(labels, '菜单')).toBe(false)
  })

  it('档位 2（640~959px）：7 键——业务保留 + 菜单键', async () => {
    await setViewport(800)
    const wrapper = mount(BottomNavBar)
    const labels = buttonLabels(wrapper)
    expect(labels).toHaveLength(7)
    expect(hasLabel(labels, '选址')).toBe(true)
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
    expect(hasLabel(labels, '选址')).toBe(false)
  })

  it('点击导航项调用 router.push', async () => {
    await setViewport(1200)
    const wrapper = mount(BottomNavBar)
    const siteBtn = wrapper
      .findAll('.GCS-button')
      .find((b) => b.text().includes('选址'))!
    await siteBtn.trigger('click')
    expect(mockPush).toHaveBeenCalledWith('/site-selection')
  })

  it('禁用项点击不跳转', async () => {
    await setViewport(1200)
    const wrapper = mount(BottomNavBar)
    const routeBtn = wrapper
      .findAll('.GCS-button')
      .find((b) => b.text().includes('航线'))!
    await routeBtn.trigger('click')
    expect(mockPush).not.toHaveBeenCalled()
  })

  it('档位 2/3 菜单键点击切换抽屉状态', async () => {
    const { drawerOpen, closeDrawer } = useMobileDrawer()
    closeDrawer()
    await setViewport(800)
    const wrapper = mount(BottomNavBar)
    const menuBtn = wrapper
      .findAll('.GCS-button')
      .find((b) => b.text().includes('菜单'))!
    await menuBtn.trigger('click')
    expect(drawerOpen.value).toBe(true)
  })
})
