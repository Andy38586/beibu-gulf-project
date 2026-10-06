import { taskSubmitResponseSchema, taskViewResponseSchema } from '@/types/schemas'
import type { TaskSubmitResponse, TaskView } from '@/types/task'

import { ENDPOINTS } from '../constants/api'

import { useApiRequest } from './useApiRequest'

/**
 * task 端点客户端（v4 系统 B）。
 *
 * 单独成一个 composable 而不是散在 store 里直接 `apiRequest('/task')`：
 * ① 端点路径只有一个来源，改路径不会漏改；
 * ② 便于单测（store 测试可注入假实现，不碰网络）。
 *
 * 🔴 三个端点全走 `/task` 前缀 ⇒ `resolveBackendPrefix` 会解析到 `/nest-api`。
 * 前提是 `MODULE_BY_PATH_PREFIX` 里有 `task` 键、且 `VITE_USE_NEST_MODULES` 含 `task`——
 * 漏一处就会回落 `/api` 旧前缀而 404（见 frontend/.env.example 的同步须知）。
 */
export interface UseTaskApiReturn {
  submit: (payload: {
    domain: string
    route: string
    priority: string
    params: Record<string, unknown>
  }) => Promise<TaskSubmitResponse>
  get: (taskId: string, signal?: AbortSignal) => Promise<TaskView>
  cancel: (taskId: string) => Promise<TaskView>
}

/** 轮询 GET 不应触发 apiRequest 的内部自动重试：轮询本身就会再来一次，重试等于放大负载 */
const POLL_TIMEOUT_MS = 8000

/** 后端读取的匿名会话标识头（与 backend/src/modules/task/utils/request-owner.ts 同名） */
const TASK_CLIENT_HEADER = 'x-task-client'
const TASK_CLIENT_STORAGE_KEY = 'beibu-gulf-task-client'
/** 无 sessionStorage（隐私模式/被测环境）时的进程内兜底：同一次页面会话内仍稳定 */
let memoryClientId: string | null = null

/**
 * 匿名会话 id（d059 补完）：task 三端点免鉴权，后端只能用「会话 id」把匿名提交者彼此分开，
 * 否则同一路由下匿名可以互相取消（原症状）。粒度 = 标签页会话：同页刷新后仍是同一个任务属主
 *（能接着轮询/取消自己刚提交的任务），关标签页即失效。
 */
function taskClientId(): string {
  try {
    const existing = sessionStorage.getItem(TASK_CLIENT_STORAGE_KEY)
    if (existing) return existing
    const id = crypto.randomUUID().replace(/-/g, '')
    sessionStorage.setItem(TASK_CLIENT_STORAGE_KEY, id)
    return id
  } catch {
    memoryClientId ??= crypto.randomUUID().replace(/-/g, '')
    return memoryClientId
  }
}

export function useTaskApi(): UseTaskApiReturn {
  const { apiRequest } = useApiRequest()
  /** 三个请求点共用同一会话头：提交时落在哪个槽，查询/取消就得拿同一个槽 */
  const clientHeaders = (): Record<string, string> => ({
    [TASK_CLIENT_HEADER]: taskClientId(),
  })

  return {
    async submit(payload) {
      const res = await apiRequest<unknown>(ENDPOINTS.task.root, {
        method: 'POST',
        body: JSON.stringify(payload),
        headers: clientHeaders(),
        // 提交应当很快（后端实测 < 100ms），超时给 8s 足够；
        // 不开重试：提交重试会创建重复任务（后端虽按 route 去重，但会平白取消掉刚提交的那个）
        timeoutMs: POLL_TIMEOUT_MS,
        retry: false,
      })
      // 契约校验（三个请求点都必须过）：后端删/改名必填字段时当场抛错，
      // 而不是让 queuePosition/status 静默变 undefined 一路漏到 UI
      return taskSubmitResponseSchema.parse(res) satisfies TaskSubmitResponse
    },

    async get(taskId, signal) {
      try {
        const res = await apiRequest<unknown>(ENDPOINTS.task.byId(taskId), {
          headers: clientHeaders(),
          signal,
          timeoutMs: POLL_TIMEOUT_MS,
          retry: false,
        })
        return taskViewResponseSchema.parse(res) satisfies TaskView
      } catch (error) {
        // 任务被 TTL 回收后后端返回 404 —— 这不是故障，是「任务已结束且结果过期」。
        // 轮询方需要能区分「网络抖动（继续轮询）」与「任务没了（停止轮询）」，
        // 故统一补一个可判定的标记，而不是让调用方去解析错误文案。
        if (
          error &&
          typeof error === 'object' &&
          'bizCode' in error &&
          (error as { bizCode?: number }).bizCode === 404001
        ) {
          const gone = new Error('任务不存在或已过期') as Error & { taskGone?: boolean }
          gone.taskGone = true
          throw gone
        }
        throw error
      }
    },

    async cancel(taskId) {
      const res = await apiRequest<unknown>(ENDPOINTS.task.byId(taskId), {
        method: 'DELETE',
        headers: clientHeaders(),
        timeoutMs: POLL_TIMEOUT_MS,
        retry: false,
      })
      return taskViewResponseSchema.parse(res) satisfies TaskView
    },
  }
}
