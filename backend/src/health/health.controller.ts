import { Controller, Get, Res } from '@nestjs/common'
import { SkipThrottle } from '@nestjs/throttler'
import type { Response } from 'express'

import { DbService } from '../infra/db/db.service'

// 探针全桶豁免（对齐老 Express「探针置于限流器之前」）：多命名桶限流器默认把
// login/register 桶（50 次/15min）也套在全部路由上，编排层健康探针 10s 间隔
// ≈90 次/15min 会耗尽认证桶 → 探针自 429 → 容器永久 unhealthy（v3 首次整栈
// 实跑实证）。@SkipThrottle 的 ESM interop 顾虑已被 auth 模块同装饰器线上用法推翻。
@SkipThrottle()
@Controller('health')
export class HealthController {
  constructor(private readonly db: DbService) {}

  @Get()
  check(@Res() res: Response): void {
    res.status(200).json({ code: 200, data: { status: 'ok' } })
  }

  // readiness 返回裸 JSON（{status,checks}），对齐老 Express /api/health/ready 形状
  //（探针契约，非业务信封）；SELECT 1 探活库连接，库不可达即 503 degraded
  @Get('ready')
  async ready(@Res() res: Response): Promise<void> {
    let dbOk = false
    try {
      await this.db.query('SELECT 1')
      dbOk = true
    } catch {
      dbOk = false
    }
    res.status(dbOk ? 200 : 503).json({ status: dbOk ? 'ready' : 'degraded', checks: { db: dbOk } })
  }
}
