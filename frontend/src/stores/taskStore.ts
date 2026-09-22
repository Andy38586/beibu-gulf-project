import { defineStore } from 'pinia'
import { computed, ref } from 'vue'

import { useTaskApi } from '@/shared/composables/useTaskApi'
import { showError, showWarning } from '@/shared/utils/errorHandler'
import { logger } from '@/shared/utils/logger'
import {
  isActiveStatus,
  isTerminalStatus,
  type TaskDomain,
  type TaskSlot,
  type TaskView,
} from '@/types/task'

/**
 * 任务状态托管（v4 系统 B / 不变式 I8）。
 *
 * ## 这一层解决什么问题
 *
 * 面板「要什么」、store「跑到哪」、页面「画出来」——三层分工（总纲 §3.1）。
 * 关键点是**任务状态不能住在页面里**：用户把面板拖进 dock 后会切走路由，
 * 页面被卸载，若状态与 AbortController 长在页面里，任务就会被连带取消
 * ⇒ 「后台跑」的语义直接失效。所以状态、轮询、取消控制器全部上移到本 store。
 *
 * ## 两条硬约束
 *
 * ① 🔴 **按 route 分槽**（`slots[route]`）：一个路由同时只有一个任务。
 *    这样「A 路由的任务在后台跑、用户在 B 路由又发一个」两者互不干扰；
 *    同一路由再提交则旧任务被取代（后端也会把旧的标 cancelled）。
 * ② 🔴 **不 import 任何 renderer / OL / Cesium 类型**（铁律 L3 + 不变式 I1/I2）。
 *    store 只保管 `result: unknown`；怎么画是页面的事。这条一旦破了，
 *    分层就塌了，且引擎会成为 store 的编译期依赖。
 *
 * ## 轮询为什么不用 setInterval
 *
 * 用「一次请求完成后 setTimeout 下一次」的链式轮询：
 * ① 请求慢于间隔时不会堆积请求（setInterval 会）。
 * ② 终态时自然停止，不需要额外的清理分支。
 * ③ 页面卸载**不**触碰定时器（这是保活的前提）——只有显式 cancel / clearAll 才停。
 */

/** 轮询间隔：500ms（总纲 §四）。后端接口在 1.2s 内，此间隔足够跟手且不压垮服务 */
const POLL_INTERVAL_MS = 500

/**
 * 轮询失败（网络抖动）时的退避上限。
 * 轮询不是用户主动操作，抖动时不该弹错——退避重试到上限即可，
 * 真到终态失败由后端给结果（后端已有自己的重试链）。
 */
const POLL_ERROR_BACKOFF_MS = 2000

/** 轮询连续失败多少次后放弃（并标记任务失败） */
const POLL_MAX_CONSECUTIVE_ERRORS = 5

export const useTaskStore = defineStore('task', () => {
  const api = useTaskApi()

  // ── 状态 ────────────────────────────────────────────────────────────────

  /**
   * 按路由分槽的任务表。key = 路由路径（如 '/flood-analysis'）。
   * 🔴 用 `Record` 而不是数组：查找/覆盖都是 O(1)，且天然保证「一个路由一个槽」。
   */
  const slots = ref<Record<string, TaskSlot>>({})

  /**
   * 当前路由路径——决定新任务用 high 还是 normal 优先级（口径 #16）。
   * 由 `setCurrentRoute` 从 router 侧同步进来（store 不直接依赖 vue-router 的 useRoute，
   * 因为 useRoute 只能在组件 setup 内调用，而 store 需要在任意时机判定）。
   */
  const currentRoute = ref<string>('/')

  /** 每个槽位独立的提交序号，竞态守卫（原 `FloodAnalysisPage.vue:56` 的 analysisSeq 上移） */
  const submitSeqByRoute = ref<Record<string, number>>({})

  /** 每个槽位一个 AbortController（原长在页面/composable 里） */
  const controllers = new Map<string, AbortController>()

  /** 每个槽位的轮询定时器句柄 */
  const pollTimers = new Map<string, ReturnType<typeof setTimeout>>()

  /** 每个槽位连续轮询失败次数 */
  const pollErrors = new Map<string, number>()

  // ── 派生 ────────────────────────────────────────────────────────────────

  /** 有活跃任务的槽位（用于底栏 dock 与进度环） */
  const activeSlots = computed(() =>
    Object.values(slots.value).filter((s) => isActiveStatus(s.status))
  )

  /** 有任务的槽位（含已完成的，供 dock 显示结果待查看） */
  const occupiedSlots = computed(() => Object.values(slots.value))

  /** 当前路由的任务（面板用它渲染自己的状态） */
  const currentSlot = computed<TaskSlot | null>(() => slots.value[currentRoute.value] ?? null)

  /** 某路由是否有活跃任务（进度环判据） */
  function hasActiveTask(route: string): boolean {
    const slot = slots.value[route]
    return !!slot && isActiveStatus(slot.status)
  }

  /** 某路由的任务（供导航按钮进度环读取） */
  function getSlot(route: string): TaskSlot | null {
    return slots.value[route] ?? null
  }

  // ── 内部工具 ────────────────────────────────────────────────────────────

  function nextSeq(route: string): number {
    const next = (submitSeqByRoute.value[route] ?? 0) + 1
    submitSeqByRoute.value[route] = next
    return next
  }

  function stopPolling(route: string): void {
    const timer = pollTimers.get(route)
    if (timer !== undefined) {
      clearTimeout(timer)
      pollTimers.delete(route)
    }
    pollErrors.delete(route)
  }

  /** 释放槽位的控制器（**不**清 slot 数据——结果要留着给页面画） */
  function releaseController(route: string): void {
    const controller = controllers.get(route)
    if (controller) {
      controller.abort()
      controllers.delete(route)
    }
  }

  /**
   * 把后端 TaskView 合并进槽位，并保留前端侧字段（submitSeq / docked）。
   *
   * 🔴 保留 `docked`：它表达的是「用户是否把面板拖进了 dock」这一**展示语义**，
   * 后端不知道也不该知道。若这里整体覆写，任务每次轮询回来都会把面板"弹"出来。
   */
  function mergeView(route: string, view: TaskView): void {
    const existing = slots.value[route]
    if (!existing) return

    // 进入重试态 ⇒ 提示一次（口径 #17：说"在重试"，不说"第几次"）
    // 只在「非重试 → 重试」的那一次边说，避免每次轮询都弹
    if (view.status === 'retrying' && existing.status !== 'retrying') {
      showWarning('服务繁忙，正在重试…')
    }

    slots.value[route] = {
      ...existing,
      status: view.status,
      progress: view.progress,
      queuePosition: view.queuePosition,
      retryCount: view.retryCount,
      result: view.result,
      error: view.error,
      startedAt: view.startedAt,
      finishedAt: view.finishedAt,
    }
  }

  /** 终态处理：停轮询、放控制器、按需提示 */
  function settle(route: string, slot: TaskSlot): void {
    stopPolling(route)
    releaseController(route)

    if (slot.status === 'failed') {
      // 🔴 只报「超时/失败」这个结果，不暴露重试了几次（口径 #17）
      showError(null, { fallback: slot.error?.message || '任务超时，请稍后重试' })
    }
  }

  // ── 轮询 ────────────────────────────────────────────────────────────────

  /**
   * 链式轮询：每次响应落地后再排下一次。
   *
   * 🔴 **不要在组件 onUnmounted 里调用 stopPolling**——保活正是靠"页面走了轮询还在"。
   * 停止只发生在三种情况：进终态 / 用户取消 / clearAll（登出）。
   */
  function schedulePoll(route: string, seq: number): void {
    // 已被新提交取代 ⇒ 不再为旧任务轮询
    if (submitSeqByRoute.value[route] !== seq) return

    const slot = slots.value[route]
    if (!slot) return
    if (isTerminalStatus(slot.status)) return

    pollTimers.set(
      route,
      setTimeout(() => {
        void pollOnce(route, seq)
      }, POLL_INTERVAL_MS)
    )
  }

  async function pollOnce(route: string, seq: number): Promise<void> {
    // 竞态守卫：轮询期间又提交了新任务 ⇒ 本次响应作废
    if (submitSeqByRoute.value[route] !== seq) return
    const slot = slots.value[route]
    if (!slot || isTerminalStatus(slot.status)) return

    try {
      const view = await api.get(slot.taskId)
      pollErrors.delete(route)

      // await 之后再判一次：请求在飞时可能被新提交/取消取代
      if (submitSeqByRoute.value[route] !== seq) return

      mergeView(route, view)
      const merged = slots.value[route]
      if (!merged) return

      if (isTerminalStatus(merged.status)) {
        settle(route, merged)
        return
      }
      schedulePoll(route, seq)
    } catch (error) {
      // 任务被 TTL 回收：当作「已结束」，停止轮询（不当故障提示）
      if (error && typeof error === 'object' && (error as { taskGone?: boolean }).taskGone) {
        stopPolling(route)
        return
      }

      const count = (pollErrors.get(route) ?? 0) + 1
      pollErrors.set(route, count)
      logger.warn(`[taskStore] 轮询失败（${route}，第 ${count} 次）`, error)

      if (count >= POLL_MAX_CONSECUTIVE_ERRORS) {
        stopPolling(route)
        // 后端自己的重试链可能仍在跑，这里只代表**前端看不到了**，
        // 所以按失败告知用户，而不是假装成功
        slots.value[route] = {
          ...(slots.value[route] as TaskSlot),
          status: 'failed',
          error: { message: '与服务器失去联系，任务状态未知，请稍后重新发起' },
        }
        showError(null, { fallback: '与服务器失去联系，请稍后重试' })
        return
      }
      // 抖动：退避后再轮询，不打扰用户（轮询不是用户主动操作）
      pollTimers.set(
        route,
        setTimeout(() => {
          void pollOnce(route, seq)
        }, POLL_ERROR_BACKOFF_MS)
      )
    }
  }

  // ── 对外动作 ────────────────────────────────────────────────────────────

  /** 路由切换时调用（AppLayout/RouterView 侧同步），决定后续任务的优先级 */
  function setCurrentRoute(route: string): void {
    currentRoute.value = route
  }

  /**
   * 提交任务。**返回 taskId**，便于调用方立刻登记（如占位条）。
   *
   * 优先级规则（口径 #16）：**该 route 是否就是当前路由** ⇒ high / normal。
   * 用户正看着的路由优先出结果，后台排队的礼让。
   */
  async function submit(input: {
    route: string
    domain: TaskDomain
    params: Record<string, unknown>
  }): Promise<string> {
    const { route, domain, params } = input

    // 同路由旧任务让位：先停本地轮询与控制器，再让后端处理（后端也会把旧的标 cancelled）
    const previous = slots.value[route]
    if (previous && isActiveStatus(previous.status)) {
      stopPolling(route)
      releaseController(route)
      void api.cancel(previous.taskId).catch(() => {
        // 取消失败（可能刚好已终态）不算错误：下面会用新任务覆盖槽位
      })
    }

    const seq = nextSeq(route)
    const priority = route === currentRoute.value ? 'high' : 'normal'

    const res = await api.submit({ domain, route, priority, params })

    // 提交期间又发了一次 ⇒ 本次作废（同时把刚落地的这个取消掉，避免留下孤儿任务）
    if (submitSeqByRoute.value[route] !== seq) {
      void api.cancel(res.taskId).catch(() => {})
      return res.taskId
    }

    slots.value[route] = {
      taskId: res.taskId,
      route,
      domain,
      status: res.status,
      progress: 0,
      queuePosition: res.queuePosition,
      retryCount: 0,
      createdAt: res.createdAt,
      submitSeq: seq,
      // 保留原 docked 状态：用户已经把面板拖进 dock 后重发，面板不该自己回来
      docked: previous?.docked ?? false,
    }

    schedulePoll(route, seq)
    return res.taskId
  }

  /**
   * 提交并等待结果（v4-S3）：`submit` + `waitForResult` 的组合。
   *
   * 绝大多数调用方要的都是「发出去 → 等它跑完 → 拿结果」，
   * 拆两步会让每个调用点重复写一遍「先 submit 再 wait」的样板。
   *
   * 返回 `{ taskId, slot }`：`slot` 为 null 表示任务被移除（dismiss/clearAll）。
   */
  async function submitAndWait(input: {
    route: string
    domain: TaskDomain
    params: Record<string, unknown>
  }): Promise<{ taskId: string; slot: TaskSlot | null }> {
    const taskId = await submit(input)
    const slot = await waitForResult(input.route)
    return { taskId, slot }
  }

  /**
   * 取消任务。
   *
   * ⚠️ 诚实边界（与后端一致）：只有**排队中**的任务能被真正取消；
   * 已在跑的任务后端打断不了，但结果不会被采用。这里统一按「已取消」反馈用户。
   */
  async function cancel(route: string): Promise<void> {
    const slot = slots.value[route]
    if (!slot || isTerminalStatus(slot.status)) return

    stopPolling(route)
    releaseController(route)
    // 递增序号 ⇒ 在途轮询响应全部作废
    submitSeqByRoute.value[route] = (submitSeqByRoute.value[route] ?? 0) + 1

    try {
      const view = await api.cancel(slot.taskId)
      mergeView(route, view)
    } catch {
      // 后端失败（可能刚好终态或已被回收）：本地按取消处理，避免面板卡在"运行中"
      slots.value[route] = { ...slot, status: 'cancelled', error: { message: '任务已取消' } }
    }
  }

  /** 取走结果并从槽位移除（页面画完图后调用，避免重复渲染） */
  function consumeResult(route: string): unknown {
    const slot = slots.value[route]
    if (!slot || slot.result === undefined) return undefined
    const result = slot.result
    return result
  }

  /**
   * 等待某路由的任务进入终态，返回终态槽位（v4-S3）。
   *
   * ## 为什么需要它
   *
   * 航线分析是**逐段串行**的（起点→途径→终点，最多 3 段），而后端 `route-path`
   * 任务域只处理单段。面板要在「上一段拿到结果」之后才提交下一段 —— 这需要一个
   * 「等这个任务跑完」的原语。
   *
   * ## 实现取舍：轮询槽位而非再开一条轮询链
   *
   * 槽位本身已经在被 store 的链式轮询推进，这里只需要**观察它到终态**。
   * 用 100ms 的轻量 setInterval 观察，比再造一条 HTTP 轮询链简单得多，
   * 也不会与既有轮询重复请求（观察的是内存状态，不是网络）。
   *
   * ⚠️ 不返回 slot 引用本身（可能被后续提交替换）：快照返回，调用方拿到的是
   * 那一刻的状态，不会被后续变更"偷改"。
   */
  function waitForResult(
    route: string,
    options: { timeoutMs?: number } = {}
  ): Promise<TaskSlot | null> {
    const timeoutMs = options.timeoutMs ?? 5 * 60 * 1000

    return new Promise<TaskSlot | null>((resolve) => {
      const start = Date.now()

      const check = (): boolean => {
        const slot = slots.value[route]
        if (!slot) {
          // 槽位被 dismiss/clearAll 移除：无任务可等
          clearInterval(timer)
          resolve(null)
          return true
        }
        if (isTerminalStatus(slot.status)) {
          clearInterval(timer)
          resolve({ ...slot })
          return true
        }
        if (Date.now() - start > timeoutMs) {
          // 超时：不擅自改状态（后端可能仍在跑），只放弃等待
          clearInterval(timer)
          resolve({ ...slot })
          return true
        }
        return false
      }

      const timer = setInterval(check, 100)
      // 立即判一次：任务可能已经终态（提交到观察之间已落定）
      check()
    })
  }

  /** 标记面板是否停靠在 dock（展示语义，后端不参与） */
  function setDocked(route: string, docked: boolean): void {
    const slot = slots.value[route]
    if (!slot) return
    slots.value[route] = { ...slot, docked }
  }

  /** 移除某路由的槽位（用户手动关闭任务卡） */
  function dismiss(route: string): void {
    stopPolling(route)
    releaseController(route)
    delete slots.value[route]
    delete submitSeqByRoute.value[route]
  }

  /**
   * 全清（登出链调用）。
   * 🔴 由 `manifest.ts` 的 reset 声明驱动，与其它 store 一致。
   */
  function clearAll(): void {
    for (const route of Object.keys(slots.value)) {
      stopPolling(route)
      releaseController(route)
    }
    slots.value = {}
    submitSeqByRoute.value = {}
  }

  return {
    // 状态
    slots,
    currentRoute,
    // 派生
    activeSlots,
    occupiedSlots,
    currentSlot,
    // 查询
    hasActiveTask,
    getSlot,
    // 动作
    setCurrentRoute,
    submit,
    submitAndWait,
    cancel,
    waitForResult,
    consumeResult,
    setDocked,
    dismiss,
    clearAll,
  }
})
