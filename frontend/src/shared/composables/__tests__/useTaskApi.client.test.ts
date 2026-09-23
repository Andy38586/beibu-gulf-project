import { beforeEach, describe, expect, it, vi } from 'vitest'

// 只验"匿名会话头三处都带、且同会话同值"——把 apiRequest 打桩，不碰网络
const { captured } = vi.hoisted(() => ({
  captured: [] as Array<{ url: string; opts: Record<string, unknown> }>,
}))

vi.mock('../useApiRequest', () => ({
  useApiRequest: () => ({
    apiRequest: async (url: string, opts: Record<string, unknown>) => {
      captured.push({ url, opts })
      return url === '/task'
        ? { taskId: 't1', status: 'pending', queuePosition: 1, createdAt: 1 }
        : {
            taskId: 't1',
            domain: 'flood-areas',
            route: '/r',
            status: 'running',
            progress: 0,
            retryCount: 0,
            createdAt: 1,
          }
    },
  }),
}))

import { useTaskApi } from '../useTaskApi'

function headerOf(i: number): string {
  const headers = captured[i].opts.headers as Record<string, string>
  return headers['x-task-client']
}

describe('useTaskApi 匿名会话头（d059 匿名侧口子）', () => {
  beforeEach(() => {
    captured.length = 0
    sessionStorage.clear()
  })

  it('🔴 三个请求点都带 x-task-client，且同一会话内取值相同', async () => {
    const api = useTaskApi()
    await api.submit({ domain: 'flood-areas', route: '/r', priority: 'normal', params: {} })
    await api.get('t1')
    await api.cancel('t1')

    expect(captured.map((c) => c.url)).toEqual(['/task', '/task/t1', '/task/t1'])
    for (let i = 0; i < 3; i++) {
      expect(headerOf(i)).toMatch(/^[A-Za-z0-9_-]{16,64}$/)
    }
    // 提交落在哪个匿名槽，查询/取消就得拿同一个槽——否则后端按属主分槽后自己都取不到
    expect(new Set([headerOf(0), headerOf(1), headerOf(2)]).size).toBe(1)
  })

  it('🔴 刷新（新实例、同标签页会话）复用同一 id ⇒ 还能取消自己刚提交的任务', async () => {
    const first = useTaskApi()
    await first.submit({ domain: 'flood-areas', route: '/r', priority: 'normal', params: {} })
    const second = useTaskApi()
    await second.cancel('t1')
    expect(headerOf(1)).toBe(headerOf(0))
  })
})
