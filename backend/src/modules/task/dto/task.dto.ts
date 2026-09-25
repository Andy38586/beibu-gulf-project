import { TASK_DOMAINS, type TaskDomain, type TaskPriority } from '../types/task'

export const TASK_PRIORITIES: readonly TaskPriority[] = ['high', 'normal'] as const

/**
 * 业务侧允许通过 HTTP 提交的域。
 *
 * 🔴 单一事实源（2026-09-19 修复）：直接取 `TASK_DOMAINS`——此前的第二份手写白名单
 * 只有 4 项而 `TaskDomain` 有 5 项，导致 `forecast-map` 提交恒被拒（400），
 * 预测页热力图永久无数据。新增域默认开放 HTTP 提交；若某域需禁，在此显式排除并注明理由。
 */
export const HTTP_TASK_DOMAINS: readonly TaskDomain[] = TASK_DOMAINS
