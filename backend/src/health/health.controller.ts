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

  // 镜像身份自证端点：部署链用它判定「线上跑的到底是哪个 tag」，**不依赖 SSH**。
  //
  // 为什么需要：CI deploy 阶段三原先用 `ssh docker inspect beibu-nest` 校镜像身份，
  // SSH 不可用时降级为「HTTP 200 即成功」——而**旧容器同样返回 200**，
  // 于是部署判定退化成「服务活着」而非「新版本已上线」（run#183 实证：20 秒假成功）。
  // 跨境 SSH 抖动是常态（22 端口 banner 丢失，d117），所以身份证据不能只押在 SSH 上。
  //
  // 口径：APP_IMAGE_TAG 由 docker-compose 从 IMAGE_TAG 注入（容器级环境变量）。
  // 未注入时返回 'unknown'——调用方必须把 unknown 视为「身份未证实」而非通过。
  @Get('version')
  version(@Res() res: Response): void {
    const raw = process.env.APP_IMAGE_TAG || ''
    // 只回显约定形状（nest-<run_number>），避免把任意环境变量反射出去
    const tag = /^[A-Za-z0-9._-]{1,64}$/.test(raw) ? raw : 'unknown'
    res.status(200).json({ status: 'ok', imageTag: tag })
  }
}
