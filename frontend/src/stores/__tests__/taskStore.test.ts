import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// 部分 mock @/shared：保留真实 useApiRequest（走 fetch），只替换有 UI 副作用的提示函数
vi.mock('@/shared/utils/errorHandler', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/shared/utils/errorHandler')>()
  return {
    ...actual,
    showError: vi.fn(),
    showWarning: vi.fn(),
  }
})

import { showError, showWarning } from '@/shared/utils/errorHandler'

import { useTaskStore } from '../taskStore'

/**
 * useTaskStore 单测（v4 S2 验收）。
 *
 * 覆盖重点（对着施工手册的验收清单写）：
 * - 分槽：A/B 两 route 互不干扰
 * - 同 route 再提交 ⇒ 旧任务被取代
 * - 优先级：当前路由 high / 后台 normal
 * - 轮询：推进 status、终态停止、**页面卸载不影响**（本测试根本不起组件，正是要点）
 * - 竞态：快速连续提交只有最新结果落地
 * - clearAll 清空
 *
 * 网络用 mock global fetch 拦（与 useRouteApi.test 同口径；task 域走统一信封解包）。
 */

const mockFetch = vi.fn()
vi.stubGlobal('fetch', mockFetch)

/** 造一个信封响应（后端 EnvelopeInterceptor 的形状：{code, data}） */
function envelope(data: unknown, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: () => Promise.resolve(JSON.stringify({ code: status, data })),
  }
}

/** 造一个 TaskView */
function view(overrides: Record<string, unknown> = {}) {
  return {
    taskId: 't-1',
    domain: 'flood-areas',
    route: '/flood-analysis',
    status: 'running',
    progress: 0.1,
    retryCount: 0,
    createdAt: 1000,
    ...overrides,
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

describe('useTaskStore', () => {
  let store: ReturnType<typeof useTaskStore>

  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
    // 🔴 用真实定时器（轮询靠 setTimeout 链），因此每个测试结束时必须 clearAll()
    // 停掉在途定时器；否则上一个测试的轮询会继续消费下一个测试的 mock 队列，
    // 表现为「明明只提交了 1 次却发了 5 个请求」这类串味失败（首版踩过）。
    store = useTaskStore()
  })

  afterEach(() => {
    store.clearAll()
    vi.unstubAllGlobals()
    vi.stubGlobal('fetch', mockFetch)
  })

  describe('初始状态', () => {
    it('无任务、无活跃槽位', () => {
      // store 由 beforeEach 提供
      expect(store.slots).toEqual({})
      expect(store.activeSlots).toEqual([])
      expect(store.occupiedSlots).toEqual([])
      expect(store.currentSlot).toBeNull()
      expect(store.hasActiveTask('/flood-analysis')).toBe(false)
    })
  })

  describe('submit', () => {
    it('提交后立刻建槽，落到 pending 并带 queuePosition', async () => {
      mockFetch.mockResolvedValueOnce(
        envelope({ taskId: 't-1', status: 'pending', queuePosition: 1, createdAt: 1000 })
      )
      // 轮询响应（后续会被 schedulePoll 触发）
      mockFetch.mockResolvedValue(envelope(view({ status: 'running', progress: 0.1 })))

      // store 由 beforeEach 提供
      const taskId = await store.submit({
        route: '/flood-analysis',
        domain: 'flood-areas',
        params: { waterLevel: 2.5 },
      })

      expect(taskId).toBe('t-1')
      const slot = store.getSlot('/flood-analysis')
      expect(slot?.taskId).toBe('t-1')
      expect(slot?.queuePosition).toBe(1)
      expect(slot?.docked).toBe(false)
      expect(slot?.domain).toBe('flood-areas')

      store.clearAll()
    })

    it('🔴 请求打到 /nest-api/task（功能域清单三副本漏一即回落 /api ⇒ 404）', async () => {
      mockFetch.mockResolvedValue(
        envelope({ taskId: 't-1', status: 'pending', queuePosition: 1, createdAt: 1 })
      )

      // store 由 beforeEach 提供
      await store.submit({ route: '/flood-analysis', domain: 'flood-areas', params: {} })

      // 这条断言盯的是**功能域清单的第三副本**（vitest.config.js 的 env）。
      // routes-audit 只检查 useApiRequest.ts，扫不到这里；漏加 task 时前缀会回落 /api。
      expect(String(mockFetch.mock.calls[0][0])).toContain('/nest-api/task')

      store.clearAll()
    })

    it('🔴 优先级：该 route 是当前路由 ⇒ high；否则 normal', async () => {
      mockFetch.mockResolvedValue(
        envelope({ taskId: 't-x', status: 'pending', queuePosition: 1, createdAt: 1 })
      )

      // store 由 beforeEach 提供
      store.setCurrentRoute('/flood-analysis')

      await store.submit({ route: '/flood-analysis', domain: 'flood-areas', params: {} })
      const firstBody = JSON.parse(String(mockFetch.mock.calls[0][1].body))
      expect(firstBody.priority).toBe('high')

      mockFetch.mockClear()
      mockFetch.mockResolvedValue(
        envelope({ taskId: 't-y', status: 'pending', queuePosition: 1, createdAt: 2 })
      )
      // 后台路由（不是当前路由）
      await store.submit({ route: '/forecast', domain: 'forecast-timeseries', params: {} })
      const secondBody = JSON.parse(String(mockFetch.mock.calls[0][1].body))
      expect(secondBody.priority).toBe('normal')

      store.clearAll()
    })

    it('🔴 分槽：A/B 两 route 的任务互不干扰', async () => {
      mockFetch.mockResolvedValue(
        envelope({ taskId: 't-tmp', status: 'pending', queuePosition: 1, createdAt: 1 })
      )

      // store 由 beforeEach 提供
      await store.submit({ route: '/flood-analysis', domain: 'flood-areas', params: {} })
      await store.submit({ route: '/forecast', domain: 'forecast-timeseries', params: {} })

      expect(store.getSlot('/flood-analysis')).not.toBeNull()
      expect(store.getSlot('/forecast')).not.toBeNull()
      expect(store.getSlot('/route-analysis')).toBeNull()
      expect(Object.keys(store.slots)).toHaveLength(2)

      store.clearAll()
    })

    it('🔴 同 route 再提交：旧任务被取消，槽位换成新任务', async () => {
      mockFetch.mockResolvedValue(
        envelope({ taskId: 't-old', status: 'pending', queuePosition: 1, createdAt: 1 })
      )
      // store 由 beforeEach 提供
      await store.submit({ route: '/flood-analysis', domain: 'flood-areas', params: {} })
      expect(store.getSlot('/flood-analysis')?.taskId).toBe('t-old')

      mockFetch.mockClear()
      // 取消旧任务的响应 + 新提交响应
      mockFetch.mockResolvedValueOnce(envelope(view({ taskId: 't-old', status: 'cancelled' })))
      mockFetch.mockResolvedValueOnce(
        envelope({ taskId: 't-new', status: 'pending', queuePosition: 1, createdAt: 2 })
      )
      await store.submit({ route: '/flood-analysis', domain: 'flood-areas', params: {} })

      expect(store.getSlot('/flood-analysis')?.taskId).toBe('t-new')

      store.clearAll()
    })

    it('🔴 docked 状态跨重提交保留（用户拖进 dock 后重发，面板不该自己弹回来）', async () => {
      mockFetch.mockResolvedValue(
        envelope({ taskId: 't-1', status: 'pending', queuePosition: 1, createdAt: 1 })
      )
      // store 由 beforeEach 提供
      await store.submit({ route: '/flood-analysis', domain: 'flood-areas', params: {} })
      store.setDocked('/flood-analysis', true)

      await store.submit({ route: '/flood-analysis', domain: 'flood-areas', params: {} })
      expect(store.getSlot('/flood-analysis')?.docked).toBe(true)

      store.clearAll()
    })
  })

  describe('轮询', () => {
    it('推进状态 → 终态停止轮询，不再发请求', async () => {
      mockFetch.mockResolvedValueOnce(
        envelope({ taskId: 't-1', status: 'pending', queuePosition: 1, createdAt: 1 })
      )
      mockFetch.mockResolvedValueOnce(envelope(view({ status: 'running', progress: 0.1 })))
      mockFetch.mockResolvedValueOnce(
        envelope(view({ status: 'done', progress: 1, result: { features: [1, 2] } }))
      )

      // store 由 beforeEach 提供
      await store.submit({ route: '/flood-analysis', domain: 'flood-areas', params: {} })

      // 等两轮轮询（间隔 500ms）
      await sleep(1200)

      const slot = store.getSlot('/flood-analysis')
      expect(slot?.status).toBe('done')
      expect(slot?.progress).toBe(1)
      expect(slot?.result).toEqual({ features: [1, 2] })

      const callsAfterSettle = mockFetch.mock.calls.length
      await sleep(700)
      // 终态后不再发请求
      expect(mockFetch.mock.calls.length).toBe(callsAfterSettle)

      store.clearAll()
    })

    it('🔴 轮询不依赖组件生命周期（保活）：本测试没有任何组件，轮询照常推进', async () => {
      mockFetch.mockResolvedValueOnce(
        envelope({ taskId: 't-1', status: 'pending', queuePosition: 1, createdAt: 1 })
      )
      mockFetch.mockResolvedValueOnce(envelope(view({ status: 'running', progress: 0.1 })))
      mockFetch.mockResolvedValueOnce(
        envelope(view({ status: 'done', progress: 1, result: { ok: true } }))
      )

      // store 由 beforeEach 提供
      await store.submit({ route: '/flood-analysis', domain: 'flood-areas', params: {} })

      // 模拟「页面卸载」：这里什么都不做——store 里没有任何卸载钩子
      await sleep(1200)

      expect(store.getSlot('/flood-analysis')?.status).toBe('done')

      store.clearAll()
    })

    it('🔴 重试态：进入时提示一次，不重复弹、不暴露次数', async () => {
      mockFetch.mockResolvedValueOnce(
        envelope({ taskId: 't-1', status: 'pending', queuePosition: 1, createdAt: 1 })
      )
      // 连续两次 retrying（模拟后端多次重试）
      mockFetch.mockResolvedValue(envelope(view({ status: 'retrying', retryCount: 1 })))

      // store 由 beforeEach 提供
      await store.submit({ route: '/flood-analysis', domain: 'flood-areas', params: {} })

      await sleep(1300)

      // 只提示一次（第二次 retrying 不再弹）
      expect(showWarning).toHaveBeenCalledTimes(1)
      expect(showWarning).toHaveBeenCalledWith('服务繁忙，正在重试…')
      // 🔴 文案里不得出现次数
      expect(String(vi.mocked(showWarning).mock.calls[0][0])).not.toMatch(/\d/)

      store.clearAll()
    })

    it('终态 failed ⇒ 走 showError', async () => {
      mockFetch.mockResolvedValueOnce(
        envelope({ taskId: 't-1', status: 'pending', queuePosition: 1, createdAt: 1 })
      )
      mockFetch.mockResolvedValueOnce(
        envelope(view({ status: 'failed', error: { message: '分析计算失败' } }))
      )

      // store 由 beforeEach 提供
      await store.submit({ route: '/flood-analysis', domain: 'flood-areas', params: {} })
      await sleep(800)

      expect(store.getSlot('/flood-analysis')?.status).toBe('failed')
      expect(showError).toHaveBeenCalled()

      store.clearAll()
    })

    it('任务被回收（404001）⇒ 静默停轮询，不弹错', async () => {
      mockFetch.mockResolvedValueOnce(
        envelope({ taskId: 't-1', status: 'pending', queuePosition: 1, createdAt: 1 })
      )
      // 轮询请求返回 404 业务码。
      // 夹具必须与生产同形（business-error.filter.ts 的 404 分支）：HTTP 404 的信封
      // code 是 404001，不是 404——useTaskApi 的「任务被回收」判定读 bizCode === 404001，
      // 旧夹具 envelope(null, 404) 给的是 code:404 ⇒ 判据恒假、用例绿着但没测到生产路径。
      mockFetch.mockResolvedValue({
        ok: false,
        status: 404,
        text: () =>
          Promise.resolve(
            JSON.stringify({ code: 404001, error: '任务不存在或已过期', data: null })
          ),
      })

      // store 由 beforeEach 提供
      await store.submit({ route: '/flood-analysis', domain: 'flood-areas', params: {} })
      await sleep(800)

      // 不该因「任务没了」而弹错
      expect(showError).not.toHaveBeenCalled()

      // 语义断言：静默停轮询——判定生效后不再打 GET /task/:id
      //（旧夹具判据恒假时本条同样不过：根本走不到 taskGone 分支）
      const callsAfterGone = mockFetch.mock.calls.length
      await sleep(600)
      expect(mockFetch.mock.calls.length).toBe(callsAfterGone)

      store.clearAll()
    })
  })

  describe('取消', () => {
    it('cancel 后槽位变 cancelled，且停止轮询', async () => {
      mockFetch.mockResolvedValueOnce(
        envelope({ taskId: 't-1', status: 'pending', queuePosition: 1, createdAt: 1 })
      )
      // store 由 beforeEach 提供
      await store.submit({ route: '/flood-analysis', domain: 'flood-areas', params: {} })

      mockFetch.mockClear()
      mockFetch.mockResolvedValueOnce(
        envelope(view({ status: 'cancelled', error: { message: '任务已取消' } }))
      )
      await store.cancel('/flood-analysis')

      expect(store.getSlot('/flood-analysis')?.status).toBe('cancelled')

      const calls = mockFetch.mock.calls.length
      await sleep(700)
      expect(mockFetch.mock.calls.length).toBe(calls)

      store.clearAll()
    })

    it('cancel 时后端报错 ⇒ 本地仍按已取消处理（面板不卡在运行中）', async () => {
      mockFetch.mockResolvedValueOnce(
        envelope({ taskId: 't-1', status: 'pending', queuePosition: 1, createdAt: 1 })
      )
      // store 由 beforeEach 提供
      await store.submit({ route: '/flood-analysis', domain: 'flood-areas', params: {} })

      mockFetch.mockClear()
      mockFetch.mockRejectedValueOnce(new TypeError('fetch failed'))
      await store.cancel('/flood-analysis')

      expect(store.getSlot('/flood-analysis')?.status).toBe('cancelled')

      store.clearAll()
    })

    it('对已终态任务 cancel 是空操作（不发请求）', async () => {
      // store 由 beforeEach 提供
      // 直接手工造一个已完成的槽位
      store.slots['/flood-analysis'] = {
        taskId: 't-1',
        route: '/flood-analysis',
        domain: 'flood-areas',
        status: 'done',
        progress: 1,
        retryCount: 0,
        createdAt: 1,
        submitSeq: 1,
        docked: false,
      }
      mockFetch.mockClear()
      await store.cancel('/flood-analysis')
      expect(mockFetch).not.toHaveBeenCalled()
      expect(store.getSlot('/flood-analysis')?.status).toBe('done')
    })
  })

  describe('竞态', () => {
    it('🔴 快速连续提交：只有最新的槽位存活，旧的在途结果不覆盖', async () => {
      // 第一次提交慢（延迟返回），第二次快
      let resolveFirst: (v: unknown) => void = () => {}
      const firstPromise = new Promise((r) => {
        resolveFirst = r
      })
      mockFetch.mockImplementationOnce(() => firstPromise)
      mockFetch.mockResolvedValue(
        envelope({ taskId: 't-second', status: 'pending', queuePosition: 1, createdAt: 2 })
      )

      // store 由 beforeEach 提供
      const p1 = store.submit({ route: '/flood-analysis', domain: 'flood-areas', params: {} })

      // 等第一个请求发出（但未返回）
      await sleep(10)
      const p2 = store.submit({ route: '/flood-analysis', domain: 'flood-areas', params: {} })
      await p2

      expect(store.getSlot('/flood-analysis')?.taskId).toBe('t-second')

      // 现在放行第一个提交的响应——它应当被丢弃（且顺带取消掉这个孤儿任务）
      resolveFirst(
        envelope({ taskId: 't-first', status: 'pending', queuePosition: 1, createdAt: 1 })
      )
      await p1

      // 槽位仍是第二次的
      expect(store.getSlot('/flood-analysis')?.taskId).toBe('t-second')

      store.clearAll()
    })
  })

  describe('dismiss / clearAll', () => {
    it('dismiss 移除单个槽位', async () => {
      mockFetch.mockResolvedValue(
        envelope({ taskId: 't-1', status: 'pending', queuePosition: 1, createdAt: 1 })
      )
      // store 由 beforeEach 提供
      await store.submit({ route: '/flood-analysis', domain: 'flood-areas', params: {} })
      await store.submit({ route: '/forecast', domain: 'forecast-timeseries', params: {} })

      store.dismiss('/flood-analysis')
      expect(store.getSlot('/flood-analysis')).toBeNull()
      expect(store.getSlot('/forecast')).not.toBeNull()

      store.clearAll()
    })

    it('🔴 clearAll 清空全部槽位并停止轮询（登出链用）', async () => {
      mockFetch.mockResolvedValue(
        envelope({ taskId: 't-1', status: 'pending', queuePosition: 1, createdAt: 1 })
      )
      // store 由 beforeEach 提供
      await store.submit({ route: '/flood-analysis', domain: 'flood-areas', params: {} })
      await store.submit({ route: '/forecast', domain: 'forecast-timeseries', params: {} })
      expect(store.occupiedSlots.length).toBe(2)

      store.clearAll()
      expect(store.slots).toEqual({})
      expect(store.occupiedSlots).toEqual([])

      const calls = mockFetch.mock.calls.length
      await sleep(700)
      expect(mockFetch.mock.calls.length).toBe(calls)
    })
  })

  describe('consumeResult / setDocked', () => {
    it('consumeResult 取回结果但不删除槽位（幂等供渲染）', () => {
      // store 由 beforeEach 提供
      store.slots['/flood-analysis'] = {
        taskId: 't-1',
        route: '/flood-analysis',
        domain: 'flood-areas',
        status: 'done',
        progress: 1,
        retryCount: 0,
        result: { features: [] },
        createdAt: 1,
        submitSeq: 1,
        docked: false,
      }
      expect(store.consumeResult('/flood-analysis')).toEqual({ features: [] })
      // 再次取仍能拿到（不消耗）
      expect(store.consumeResult('/flood-analysis')).toEqual({ features: [] })
    })

    it('setDocked 对不存在的槽位是空操作', () => {
      // store 由 beforeEach 提供
      expect(() => store.setDocked('/nope', true)).not.toThrow()
      expect(store.getSlot('/nope')).toBeNull()
    })
  })

  describe('activeSlots / hasActiveTask', () => {
    it('活跃态计入，终态不计入', () => {
      // store 由 beforeEach 提供
      const base = {
        route: '/flood-analysis',
        domain: 'flood-areas' as const,
        progress: 0,
        retryCount: 0,
        createdAt: 1,
        submitSeq: 1,
        docked: false,
      }
      store.slots['/a'] = { ...base, taskId: 't-a', route: '/a', status: 'running' }
      store.slots['/b'] = { ...base, taskId: 't-b', route: '/b', status: 'done' }
      store.slots['/c'] = { ...base, taskId: 't-c', route: '/c', status: 'retrying' }

      expect(store.activeSlots.map((s) => s.route).sort()).toEqual(['/a', '/c'])
      expect(store.hasActiveTask('/a')).toBe(true)
      expect(store.hasActiveTask('/b')).toBe(false)
    })
  })

  describe('waitForResult / submitAndWait（v4-S3 逐段串行编排原语）', () => {
    const base = {
      route: '/route-analysis',
      domain: 'route-path' as const,
      progress: 0,
      retryCount: 0,
      createdAt: 1,
      submitSeq: 1,
      docked: false,
    }

    it('waitForResult：槽位已是终态 ⇒ 立即返回快照', async () => {
      store.slots['/route-analysis'] = {
        ...base,
        taskId: 't-1',
        status: 'done',
        result: { found: true },
      }

      const slot = await store.waitForResult('/route-analysis')
      expect(slot?.status).toBe('done')
      expect(slot?.result).toEqual({ found: true })
    })

    it('waitForResult：活跃态 ⇒ 等槽位变终态后才 resolve', async () => {
      store.slots['/route-analysis'] = { ...base, taskId: 't-1', status: 'running' }

      let settled = false
      const p = store.waitForResult('/route-analysis').then((s) => {
        settled = true
        return s
      })

      await sleep(150)
      expect(settled).toBe(false) // 仍在等

      store.slots['/route-analysis'] = {
        ...store.slots['/route-analysis']!,
        status: 'done',
        result: { ok: 1 },
      }

      const slot = await p
      expect(slot?.status).toBe('done')
    })

    it('waitForResult：槽位被移除（dismiss/clearAll）⇒ resolve null', async () => {
      store.slots['/route-analysis'] = { ...base, taskId: 't-1', status: 'running' }

      const p = store.waitForResult('/route-analysis')
      await sleep(50)
      delete store.slots['/route-analysis']

      await expect(p).resolves.toBeNull()
    })

    it('waitForResult：返回的是快照（后续改动不"偷改"已返回值）', async () => {
      store.slots['/route-analysis'] = {
        ...base,
        taskId: 't-1',
        status: 'done',
        result: { v: 1 },
      }

      const slot = await store.waitForResult('/route-analysis')
      // 拿到后立刻改槽位
      store.slots['/route-analysis'] = { ...store.slots['/route-analysis']!, result: { v: 2 } }

      expect(slot?.result).toEqual({ v: 1 })
    })

    it('submitAndWait：提交 + 等到终态，返回 {taskId, slot}', async () => {
      mockFetch.mockResolvedValueOnce(
        envelope({ taskId: 't-9', status: 'pending', queuePosition: 0, createdAt: 1000 })
      )
      mockFetch.mockResolvedValue(
        envelope(
          view({ taskId: 't-9', route: '/route-analysis', status: 'done', result: { r: 1 } })
        )
      )

      const { taskId, slot } = await store.submitAndWait({
        route: '/route-analysis',
        domain: 'route-path',
        params: { fromLng: 1, fromLat: 2, toLng: 3, toLat: 4 },
      })

      expect(taskId).toBe('t-9')
      expect(slot?.status).toBe('done')
      expect(slot?.result).toEqual({ r: 1 })
    }, 15000)
  })
})
