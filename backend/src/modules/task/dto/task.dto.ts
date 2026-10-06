import { BusinessError, ErrorCode } from '../../../common/errors/business-error'
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

/**
 * 任务提交体（d025 收口，2026-10-06）：controller 里的手写参数校验搬到这里，
 * 边界统一经 `DtoPipe` + 本类的 `parse`（与 plans/favorites/auth/forecast 同口径）。
 * 校验语义与迁移前**逐字对齐**（domain 闭集 / route 非空 / priority 枚举且默认 normal /
 * params 必须是对象），错误码与文案不变。
 */
export class TaskSubmitBody {
  domain!: TaskDomain
  route!: string
  priority!: TaskPriority
  params!: Record<string, unknown>

  static parse(raw: unknown): TaskSubmitBody {
    const body = (typeof raw === 'object' && raw !== null ? raw : {}) as Record<string, unknown>
    const { domain, route, priority, params } = body
    if (typeof domain !== 'string' || !HTTP_TASK_DOMAINS.includes(domain as TaskDomain)) {
      throw new BusinessError(
        ErrorCode.INVALID_PARAMS,
        `domain 必须为以下之一：${HTTP_TASK_DOMAINS.join(' / ')}`
      )
    }
    if (typeof route !== 'string' || route === '') {
      // route 是前端分槽依据（1 个路由 1 个任务），缺失会让前端无法归属结果
      throw new BusinessError(ErrorCode.INVALID_PARAMS, '缺少参数：route')
    }
    let priorityValue: TaskPriority = 'normal'
    if (priority !== undefined) {
      if (!TASK_PRIORITIES.includes(priority as TaskPriority)) {
        throw new BusinessError(
          ErrorCode.INVALID_PARAMS,
          `priority 必须为 ${TASK_PRIORITIES.join(' / ')}`
        )
      }
      priorityValue = priority as TaskPriority
    }
    if (
      params !== undefined &&
      (typeof params !== 'object' || params === null || Array.isArray(params))
    ) {
      throw new BusinessError(ErrorCode.INVALID_PARAMS, 'params 应为对象')
    }
    const dto = new TaskSubmitBody()
    dto.domain = domain as TaskDomain
    dto.route = route
    dto.priority = priorityValue
    dto.params = (params as Record<string, unknown> | undefined) ?? {}
    return dto
  }
}
