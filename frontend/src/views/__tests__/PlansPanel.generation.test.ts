// @vitest-environment jsdom
/**
 * 修复守卫：plansList 写点代次判定 + 登出先取消再清空。
 *
 * 阳性对照：删掉 loadPlans 里的 `if (generation === plansLoadGeneration)` 判定，
 * 本用例「迟到响应不得回填」必红（旧账号清单会写进已登出面板）。
 */
import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  userRef: null as unknown as { value: { id: string; username: string } | null },
  getPlans: vi.fn(),
  cancelPlans: vi.fn(),
  showError: vi.fn(),
}))

vi.mock('@/shared', async (importOriginal) => {
  // 部分 mock：保留真实 barrel（LAYER_DEFAULTS 等被 @/core 传递依赖），
  // 只替换本用例要控制的认证/方案/收藏与重组件
  const actual = await importOriginal<typeof import('@/shared')>()
  const { ref } = await import('vue')
  h.userRef = ref<{ id: string; username: string } | null>({ id: 'u-a', username: 'alice' })
  return {
    ...actual,
    useAuth: () => ({ user: h.userRef }),
    usePlans: () => ({
      getPlans: h.getPlans,
      updatePlan: vi.fn(),
      deletePlan: vi.fn(),
      cancel: h.cancelPlans,
      updating: ref(false),
      loading: ref(false),
      deleting: ref(false),
    }),
    useFavorites: () => ({ favorites: ref([]), removeFavorite: vi.fn() }),
    showModal: vi.fn(),
    showError: h.showError,
    showToast: vi.fn(),
    EmptyState: { template: '<div class="empty-stub" />' },
    PaginatedListPanel: { template: '<div class="plp-stub"><slot name="item" /></div>' },
    PlanSaveModal: { template: '<div class="psm-stub" />' },
  }
})

vi.mock('vue-router', () => ({
  useRouter: () => ({ push: vi.fn() }),
}))

import { EDITING_PLAN_KEY, RESTORE_PLAN_DATA_KEY } from '@/core'
import PlansPanel from '../components/PlansPanel.vue'

const PLAN_A = [{ id: 'p-a', name: 'A 的方案', userId: 'u-a', selectedKeys: [], typeSettings: {} }]

function mountPanel() {
  return mount(PlansPanel, {
    global: {
      provide: {
        [RESTORE_PLAN_DATA_KEY as symbol]: { value: null },
        [EDITING_PLAN_KEY as symbol]: { value: null },
      },
    },
  })
}

function plansListOf(wrapper: ReturnType<typeof mount>): unknown[] {
  return (wrapper.vm as unknown as { plansList: unknown[] }).plansList
}

describe('PlansPanel 方案列表代次守卫（c044）', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    h.getPlans.mockReset()
    h.cancelPlans.mockReset()
    h.showError.mockReset()
    h.userRef.value = { id: 'u-a', username: 'alice' }
  })

  it('登录后正常加载：响应落地即写入', async () => {
    h.getPlans.mockResolvedValue(PLAN_A)
    const wrapper = mountPanel()
    await new Promise((r) => setTimeout(r, 0))
    expect(plansListOf(wrapper)).toEqual(PLAN_A)
    wrapper.unmount()
  })

  it('登出后迟到的旧账号响应不得回填，且在途请求被取消', async () => {
    let resolveFn: (v: typeof PLAN_A) => void = () => {}
    h.getPlans.mockReturnValue(
      new Promise((resolve) => {
        resolveFn = resolve
      })
    )
    const wrapper = mountPanel()
    await new Promise((r) => setTimeout(r, 0))

    // 登出（watch 分支）：作废代次 + 取消在途 + 清空
    h.userRef.value = null
    await wrapper.vm.$nextTick()
    expect(h.cancelPlans).toHaveBeenCalled()
    expect(plansListOf(wrapper)).toEqual([])

    // 旧账号响应此时才落地
    resolveFn(PLAN_A)
    await new Promise((r) => setTimeout(r, 0))
    expect(plansListOf(wrapper)).toEqual([])
    // 登出误弹「加载失败」也不应出现（被代次判定静默丢弃）
    expect(h.showError).not.toHaveBeenCalled()
    wrapper.unmount()
  })
})
