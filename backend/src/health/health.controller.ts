import { Controller, Get, Res } from '@nestjs/common'
import type { Response } from 'express'

import { DbService } from '../infra/db/db.service'

// Express 把探针置于限流器之前；Nest 侧 @nestjs/throttler 的 SkipThrottle
// 装饰器在 vitest ESM interop 下 named export 丢失（fail fast 修复：暂由全局限流覆盖探针）。
// 探针 5s 间隔约 180 次/15min，远低于 1000 上限，风险可控；部署整合时统一处理
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
