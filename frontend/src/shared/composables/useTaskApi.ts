import type { TaskSubmitResponse, TaskView } from '@/types/task'

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

export function useTaskApi(): UseTaskApiReturn {
  const { apiRequest } = useApiRequest()

  return {
    async submit(payload) {
      return apiRequest<TaskSubmitResponse>('/task', {
        method: 'POST',
        body: JSON.stringify(payload),
        // 提交应当很快（后端实测 < 100ms），超时给 8s 足够；
        // 不开重试：提交重试会创建重复任务（后端虽按 route 去重，但会平白取消掉刚提交的那个）
        timeoutMs: POLL_TIMEOUT_MS,
        retry: false,
      })
    },

    async get(taskId, signal) {
      try {
        return await apiRequest<TaskView>(`/task/${encodeURIComponent(taskId)}`, {
          signal,
          timeoutMs: POLL_TIMEOUT_MS,
          retry: false,
        })
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
      return apiRequest<TaskView>(`/task/${encodeURIComponent(taskId)}`, {
        method: 'DELETE',
        timeoutMs: POLL_TIMEOUT_MS,
        retry: false,
      })
    },
  }
}
