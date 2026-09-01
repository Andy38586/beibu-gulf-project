import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Post,
  Put,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common'
import type { Request, Response } from 'express'

import { BusinessError, ErrorCode } from '../../../common/errors/business-error'
import { DtoPipe } from '../../../common/pipes/dto.pipe'
import { AuthGuard } from '../../auth/guards/auth.guard'
import { PlanCreateBody, PlanUpdateBody, PlanXiaoquBody } from '../dto/plans.dto'
import { PlansService } from '../services/plans.service'

// 方案属于用户数据，全路由需登录（对齐 Express router.use(authenticate)）；
// 属主校验在 controller 层（对齐 Express plansController 分工），文案逐字节一致
@Controller('plans')
@UseGuards(AuthGuard)
export class PlansController {
  constructor(private readonly plansService: PlansService) {}

  @Get()
  list(@Req() req: Request & { user?: { id: string } }) {
    return this.plansService.listByUser(req.user!.id)
  }

  @Get(':id')
  async getOne(@Param('id') id: string, @Req() req: Request & { user?: { id: string } }) {
    const plan = await this.plansService.getById(id)
    if (!plan) {
      throw new BusinessError(ErrorCode.NOT_FOUND, '方案不存在')
    }
    if (plan.userId !== req.user!.id) {
      throw new BusinessError(ErrorCode.FORBIDDEN, '无权访问该方案')
    }
    return plan
  }

  // POST 默认 201，对齐 Express sendSuccess(res, newPlan, 201)
  @Post()
  async create(
    @Body(new DtoPipe(PlanCreateBody.parse)) body: PlanCreateBody,
    @Req() req: Request & { user?: { id: string } }
  ) {
    const existing = await this.plansService.listByUser(req.user!.id)
    if (existing.some((p) => p.name === body.name)) {
      throw new BusinessError(ErrorCode.DUPLICATE_RESOURCE, '方案名称已存在')
    }
    return this.plansService.create({
      userId: req.user!.id,
      name: body.name,
      selectedKeys: body.selectedKeys,
      typeSettings: body.typeSettings,
      weights: body.weights,
    })
  }

  @Put(':id')
  async update(
    @Param('id') id: string,
    @Body(new DtoPipe(PlanUpdateBody.parse)) body: Record<string, unknown>,
    @Req() req: Request & { user?: { id: string } }
  ) {
    const plan = await this.plansService.getById(id)
    if (!plan) {
      throw new BusinessError(ErrorCode.NOT_FOUND, '方案不存在')
    }
    if (plan.userId !== req.user!.id) {
      throw new BusinessError(ErrorCode.FORBIDDEN, '无权修改该方案')
    }
    if (body.name !== undefined) {
      const all = await this.plansService.listByUser(req.user!.id)
      if (all.some((p) => p.name === body.name && p.id !== id)) {
        throw new BusinessError(ErrorCode.DUPLICATE_RESOURCE, '方案名称已存在')
      }
    }
    return this.plansService.update(id, { ...body })
  }

  // 204 无响应体（对齐 Express res.status(204).send()）：@Res 直操绕过信封拦截器
  @Delete(':id')
  @HttpCode(204)
  async deleteOne(
    @Param('id') id: string,
    @Req() req: Request & { user?: { id: string } },
    @Res() res: Response
  ): Promise<void> {
    const plan = await this.plansService.getById(id)
    if (!plan) {
      throw new BusinessError(ErrorCode.NOT_FOUND, '方案不存在')
    }
    if (plan.userId !== req.user!.id) {
      throw new BusinessError(ErrorCode.FORBIDDEN, '无权删除该方案')
    }
    const success = await this.plansService.remove(id)
    if (!success) {
      throw new BusinessError(ErrorCode.NOT_FOUND, '方案不存在')
    }
    res.status(204).send()
  }

  // 200 对齐 Express saveXiaoquToOne 的 sendSuccess 默认码（非资源创建语义）
  @Post(':id/xiaoqu')
  @HttpCode(200)
  async saveXiaoqu(
    @Param('id') id: string,
    @Body(new DtoPipe(PlanXiaoquBody.parse)) body: PlanXiaoquBody,
    @Req() req: Request & { user?: { id: string } }
  ) {
    const plan = await this.plansService.getById(id)
    if (!plan) {
      throw new BusinessError(ErrorCode.NOT_FOUND, '方案不存在')
    }
    if (plan.userId !== req.user!.id) {
      throw new BusinessError(ErrorCode.FORBIDDEN, '无权修改该方案')
    }
    return this.plansService.saveXiaoqu(id, body.xiaoqu)
  }

  @Delete(':id/xiaoqu/:xiaoquId')
  async removeXiaoqu(
    @Param('id') id: string,
    @Param('xiaoquId') xiaoquId: string,
    @Req() req: Request & { user?: { id: string } }
  ) {
    const plan = await this.plansService.getById(id)
    if (!plan) {
      throw new BusinessError(ErrorCode.NOT_FOUND, '方案不存在')
    }
    if (plan.userId !== req.user!.id) {
      throw new BusinessError(ErrorCode.FORBIDDEN, '无权修改该方案')
    }
    return this.plansService.removeXiaoqu(id, xiaoquId)
  }
}
