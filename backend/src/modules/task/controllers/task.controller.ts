import { Body, Controller, Delete, Get, HttpCode, Param, Post } from '@nestjs/common'
import { ApiTags } from '@nestjs/swagger'
import { SkipThrottle } from '@nestjs/throttler'

import { BusinessError, ErrorCode } from '../../../common/errors/business-error'
import { HTTP_TASK_DOMAINS, TASK_PRIORITIES } from '../dto/task.dto'
import { TaskService } from '../services/task.service'
import type { TaskDomain, TaskPriority } from '../types/task'

/**
 * 异步任务 API（v4 系统 B）。
 *
 * 契约（总纲 §四）：
 *   POST   /nest-api/task       → 提交，立即返回 taskId（< 100ms）
 *   GET    /nest-api/task/:id   → 查询（前端轮询入口）
 *   DELETE /nest-api/task/:id   → 取消
 *
 * 🔴 三个端点都**免鉴权**（与 flood/route/site-analysis 同口径：纯计算不读用户数据）。
 * 如果将来任务要携带用户私有参数，必须先在 controller 上补 @UseGuards——
 * 现在没有，因为参数来自公开的地图交互（坐标/水位/筛选键）。
 *
 * @SkipThrottle 必需：命名桶（login/register 50/15min）默认套用**所有**路由，
 * 不 skip 会被误伤 —— 任务提交是用户主动的短时动作，前端还会 500ms 轮询 GET，
 * 15 分钟进出十几次即 429（同 flood.controller 的事故）。
 */
@SkipThrottle({ login: true, register: true })
@Controller('task')
@ApiTags('task')
export class TaskController {
  constructor(private readonly taskService: TaskService) {}

  /** 提交任务。@HttpCode(200)：非资源创建端点，回报 taskId 属查询语义 */
  @Post()
  @HttpCode(200)
  submit(
    @Body() body?: { domain?: unknown; route?: unknown; priority?: unknown; params?: unknown }
  ) {
    const { domain, route, priority, params } = body ?? {}

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
    const priorityValue: TaskPriority =
      priority === undefined
        ? 'normal'
        : TASK_PRIORITIES.includes(priority as TaskPriority)
          ? (priority as TaskPriority)
          : (() => {
              throw new BusinessError(
                ErrorCode.INVALID_PARAMS,
                `priority 必须为 ${TASK_PRIORITIES.join(' / ')}`
              )
            })()
    if (
      params !== undefined &&
      (typeof params !== 'object' || params === null || Array.isArray(params))
    ) {
      throw new BusinessError(ErrorCode.INVALID_PARAMS, 'params 应为对象')
    }

    return this.taskService.submit({
      domain: domain as TaskDomain,
      route,
      priority: priorityValue,
      params: (params as Record<string, unknown> | undefined) ?? {},
    })
  }

  /** 查询任务（前端 500ms 轮询）。任务被回收后返回 404 业务码，前端据此停止轮询 */
  @Get(':id')
  get(@Param('id') id: string) {
    return this.taskService.get(id)
  }

  /** 取消任务。幂等：已终态返回当前状态而非报错 */
  @Delete(':id')
  cancel(@Param('id') id: string) {
    return this.taskService.cancel(id)
  }
}
