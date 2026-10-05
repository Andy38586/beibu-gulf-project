import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common'

import { BusinessError, ErrorCode } from '../../../common/errors/business-error'
import { sanitizeDetail } from '../../../common/utils/sanitize-detail'
import {
  TASK_MAX_WAIT_MS,
  TASK_QUEUE_LIMIT,
  type TaskPriority,
  type TaskRecord,
  type TaskStatus,
  type TaskSubmitResponse,
  type TaskView,
} from '../types/task'

import { TaskHandlers } from './task-handlers'
import { type TaskJob, TaskQueue } from './task-queue'
import { TaskRegistry } from './task-registry'

/** 提交入参（controller 已做形状校验，这里是领域内的窄化版本） */
export interface SubmitTaskInput {
  domain: TaskJob['domain']
  route: string
  /** 提交者属主（d059）：controller 从请求身份解析；匿名端点用 ANONYMOUS_OWNER */
  ownerId: string
  priority: TaskPriority
  params: Record<string, unknown>
}

/**
 * 任务编排服务：`POST 立即返回 → 后台串行执行 → 前端轮询取结果`。
 *
 * 三层职责（与前端 store 的「展示/执行语义解耦」呼应）：
 *   · TaskRegistry —— 跑在哪（状态与结果）
 *   · TaskQueue    —— 什么时候跑（串行 + 优先级 + 重试）
 *   · TaskService  —— 对外语义（提交/查询/取消）与**幂等规则**
 */
@Injectable()
export class TaskService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(TaskService.name)
  private readonly registry = new TaskRegistry()
  private readonly queue: TaskQueue
  private seq = 0

  constructor(private readonly handlers: TaskHandlers) {
    this.queue = new TaskQueue({
      run: (job) => this.handlers.get(job.domain)(job.params),
      onStart: (taskId) => {
        this.registry.patch(taskId, { status: 'running', progress: 0, queuePosition: undefined })
        this.registry.patch(taskId, {
          startedAt: this.registry.get(taskId)?.startedAt ?? Date.now(),
        })
      },
      onProgress: (taskId, progress) => {
        this.registry.patch(taskId, { progress })
      },
      onRetry: (taskId, attempt, delayMs) => {
        const record = this.registry.get(taskId)
        this.registry.patch(taskId, { status: 'retrying', retryCount: attempt })
        this.logger.log(
          `任务 ${taskId} 第 ${attempt} 次重试（${delayMs}ms）· 域=${record?.domain ?? '?'}`
        )
      },
      onSuccess: (taskId, result) => {
        this.registry.patch(taskId, {
          status: 'done',
          progress: 1,
          result,
          error: undefined,
          queuePosition: undefined,
        })
      },
      onFailure: (taskId, error) => {
        // 非 BusinessError 的底层 message 原样下发会绕过同步路径的生产隐藏策略
        // （business-error.filter.ts 对同类异常只回「服务器内部错误」）：
        // pg 连接级 message 惯含内网服务名/端口，SQL 级含表名/列名，
        // 而 GET /task/:id 是公开端点 ⇒ 匿名轮询者即可读走。
        // BusinessError 的 message 是给用户看的业务文案，按原样下发。
        const isBusiness = error instanceof BusinessError
        // 即便是给用户看的业务文案也要净化：它可由请求输入拼出（键名/类型名），
        // 未净化时匿名轮询者可用换行把响应体撑成多行、或用超长文本灌满前端存储
        const detail =
          isBusiness || process.env.NODE_ENV !== 'production'
            ? sanitizeDetail(error.message)
            : '任务执行失败，请稍后重试'
        this.registry.patch(taskId, {
          status: 'failed',
          queuePosition: undefined,
          error: { message: detail, bizCode: isBusiness ? error.bizCode : undefined },
        })
      },
      // 三态取消判定（1004-04）：cancelled=用户取消；undefined=注册表条目已不存在
      //（onModuleDestroy → dispose 清表，或 TTL 回收）——后者在停机下与"已取消"同判，
      // 否则在飞 handler 跑完后继续走重试/onSuccess 链，把「已销毁」当成「没取消」。
      isCancelled: (taskId) => {
        const status = this.registry.get(taskId)?.status
        return status === 'cancelled' || status === undefined
      },
    })
  }

  onModuleInit(): void {
    // 节拍做两件事：回收超 TTL 的终态记录 + 把等太久的 pending 判失败。
    // 🔴 第二件必须在这里接线——`expireStalePending` 早已实现却无人调用，
    // 结果是串行队列（并发上限 1、容量 8）会被非终态 pending 永久占位，只能重启解。
    this.registry.startSweeper(() => this.expireStalePending())
  }

  onModuleDestroy(): void {
    this.registry.dispose()
  }

  /**
   * 提交任务。
   *
   * 🔴 **幂等规则（不变式 I8 的后端侧）**：同一 `route` 上已有未完成任务时，
   * **旧任务自动 cancelled**（口径 #14「一个路由只能跑一个任务」）。
   * 不用「拒绝新提交」是因为那会把判断权推给前端，用户得到的体验是「点了没反应」。
   */
  submit(input: SubmitTaskInput): TaskSubmitResponse {
    // 容量先按三重维度收口（d060）：条数/字节超限时先淘汰最旧终态（丢缓存不丢计算），
    // 仍超限才拒绝新提交；活跃维度沿用队列容量（TASK_QUEUE_LIMIT）。
    this.registry.trimTerminal()
    if (this.registry.isQueueFull()) {
      throw new BusinessError(
        ErrorCode.ANALYSIS_FAILED,
        `任务队列已满（上限 ${TASK_QUEUE_LIMIT}），请等待现有任务完成`
      )
    }
    const overCapacity = this.registry.capacityProblem()
    if (overCapacity) {
      throw new BusinessError(ErrorCode.ANALYSIS_FAILED, overCapacity)
    }

    // 同路由去重：旧任务让位（既不在队列的，直接标终态；在队列的，移出队列）。
    // 🔴 取代键必须含属主（d059）：route 是客户端任意字符串，只按 route 判定时
    // 任何人提交同一 route 就能取消他人正在跑的任务（且不需知道对方 taskId）。
    for (const record of this.registry.list()) {
      if (record.route !== input.route) continue
      if (record.ownerId !== input.ownerId) continue
      if (!isActive(record.status)) continue
      this.queue.remove(record.taskId)
      this.registry.patch(record.taskId, {
        status: 'cancelled',
        queuePosition: undefined,
        error: { message: '已被同一路由的新任务取代' },
      })
    }

    const taskId = this.nextTaskId()
    const record: TaskRecord = {
      taskId,
      domain: input.domain,
      route: input.route,
      ownerId: input.ownerId,
      priority: input.priority,
      params: input.params,
      status: 'pending',
      progress: 0,
      retryCount: 0,
      createdAt: Date.now(),
    }
    this.registry.add(record)

    const position = this.queue.enqueue({
      taskId,
      domain: input.domain,
      route: input.route,
      priority: input.priority,
      params: input.params,
    })
    this.registry.patch(taskId, { queuePosition: position })

    return {
      taskId,
      status: 'pending',
      queuePosition: position,
      createdAt: record.createdAt,
    }
  }

  /**
   * 查询（前端轮询入口）。🔴 未找到 = 404 语义，而不是返回空对象（前端据此判定任务被回收）
   *
   * `requesterId` 是调用者的属主标识（d059）：非属主一律按 404 处理，**与"不存在"同码同文案**
   * ——否则 403 就变成了「这个 taskId 存在」的探测器（taskId 可猜）。
   */
  get(taskId: string, requesterId: string): TaskView {
    const record = this.registry.get(taskId)
    if (!record || record.ownerId !== requesterId) {
      throw new BusinessError(ErrorCode.NOT_FOUND, '任务不存在或已过期')
    }
    return this.toView(record)
  }

  /**
   * 取消。
   *
   * ⚠️ **能取消什么、不能取消什么**（诚实边界，前端提示文案据此写）：
   *   · pending（还在排队）→ **能**真正取消：出队 + 标 cancelled，任务不会再执行。
   *   · running/retrying → **不能打断**已在飞的 `await`：标为 cancelled 后，
   *     队列在下一个检查点（重试前 / 结果返回前）放弃写结果。底层那次 DB 查询
   *     仍会跑完（PG 侧无法从 Node 侧中断），但**不会被重试**、结果也不会被采用。
   *   · 已是终态 → 幂等返回当前状态，不报错。
   *
   * `requesterId` 为调用者属主（d059）：**非属主取消必须失败**——否则任何人拿到
   * （或猜到）taskId 即可掐掉他人任务；与查询同口径按 404 处理，不暴露存在性。
   */
  cancel(taskId: string, requesterId: string): TaskView {
    const record = this.registry.get(taskId)
    if (!record || record.ownerId !== requesterId) {
      throw new BusinessError(ErrorCode.NOT_FOUND, '任务不存在或已过期')
    }
    if (isActive(record.status)) {
      this.queue.remove(taskId)
      this.registry.patch(taskId, {
        status: 'cancelled',
        queuePosition: undefined,
        error: { message: '任务已取消' },
      })
    }
    return this.toView(this.registry.get(taskId) as TaskRecord)
  }

  /** 供单测/诊断：当前排队数、活跃数、记录总数与累计结果字节 */
  stats(): { pending: number; active: number; total: number; bytes: number } {
    return {
      pending: this.queue.pendingCount,
      active: this.registry.activeCount(),
      total: this.registry.size,
      bytes: this.registry.totalBytes,
    }
  }

  /** 排队等待超时兜底：等太久的 pending 直接判失败，避免前端无限转圈 */
  expireStalePending(now = Date.now()): number {
    let expired = 0
    for (const record of this.registry.list()) {
      if (record.status !== 'pending') continue
      if (now - record.createdAt < TASK_MAX_WAIT_MS) continue
      this.queue.remove(record.taskId)
      this.registry.patch(record.taskId, {
        status: 'failed',
        queuePosition: undefined,
        error: { message: '任务排队超时，请稍后重试' },
      })
      expired++
    }
    return expired
  }

  /** taskId 形如 `t-<时间戳36>-<递增序号>`：可读、可按时间排序、单进程内唯一 */
  private nextTaskId(): string {
    this.seq = (this.seq + 1) % 1_000_000
    return `t-${Date.now().toString(36)}-${this.seq.toString(36)}`
  }

  /** 记录 → 对外投影。queuePosition 现算，避免注册表与队列两份状态不一致 */
  private toView(record: TaskRecord): TaskView {
    return {
      taskId: record.taskId,
      domain: record.domain,
      route: record.route,
      status: record.status,
      progress: record.progress,
      queuePosition: record.status === 'pending' ? this.queue.positionOf(record.taskId) : undefined,
      retryCount: record.retryCount,
      result: record.result,
      error: record.error,
      createdAt: record.createdAt,
      startedAt: record.startedAt,
      finishedAt: record.finishedAt,
    }
  }
}

/** 活跃 = 尚未进入终态 */
function isActive(status: TaskStatus): boolean {
  return status === 'pending' || status === 'running' || status === 'retrying'
}
