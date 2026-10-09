import { Body, Controller, Delete, Get, HttpCode, Param, Post, Req } from '@nestjs/common'
import { ApiTags } from '@nestjs/swagger'
import { SkipThrottle } from '@nestjs/throttler'
import type { Request } from 'express'

import { SKIP_AUTH_NAMED_THROTTLERS } from '../../../common/constants/throttling.constants'
import { DtoPipe } from '../../../common/pipes/dto.pipe'
import { TaskSubmitBody } from '../dto/task.dto'
import { TaskService } from '../services/task.service'
import { resolveRequestOwner } from '../utils/request-owner'

/**
 * 异步任务 API（v4 系统 B）。
 *
 * 契约（总纲 §四）：
 *   POST   /nest-api/task       → 提交，立即返回 taskId（< 100ms）
 *   GET    /nest-api/task/:id   → 查询（前端轮询入口）
 *   DELETE /nest-api/task/:id   → 取消
 *
 * 🔴 三个端点都**免鉴权**（与 flood/route 同口径：纯计算不读用户数据）。
 * 如果将来任务要携带用户私有参数，必须先在 controller 上补 @UseGuards——
 * 现在没有，因为参数来自公开的地图交互（坐标/水位/筛选键）。
 *
 * @SkipThrottle 必需：命名桶（login/register 50/15min）默认套用**所有**路由，
 * 不 skip 会被误伤 —— 任务提交是用户主动的短时动作，前端还会 500ms 轮询 GET，
 * 15 分钟进出十几次即 429（同 flood.controller 的事故）。
 */
@SkipThrottle(SKIP_AUTH_NAMED_THROTTLERS)
@Controller('task')
@ApiTags('task')
export class TaskController {
  constructor(private readonly taskService: TaskService) {}

  /** 提交任务。@HttpCode(200)：非资源创建端点，回报 taskId 属查询语义 */
  @Post()
  @HttpCode(200)
  submit(@Body(new DtoPipe(TaskSubmitBody.parse)) body: TaskSubmitBody, @Req() req: Request) {
    // 参数校验在 TaskSubmitBody.parse（边界统一入口）；本方法只做编排
    return this.taskService.submit({
      domain: body.domain,
      route: body.route,
      ownerId: resolveRequestOwner(req),
      priority: body.priority,
      params: body.params,
    })
  }

  /** 查询任务（前端 500ms 轮询）。任务被回收后返回 404 业务码，前端据此停止轮询 */
  @Get(':id')
  get(@Param('id') id: string, @Req() req: Request) {
    return this.taskService.get(id, resolveRequestOwner(req))
  }

  /** 取消任务。幂等：已终态返回当前状态而非报错；非属主按 404 处理（不暴露存在性） */
  @Delete(':id')
  cancel(@Param('id') id: string, @Req() req: Request) {
    return this.taskService.cancel(id, resolveRequestOwner(req))
  }
}
