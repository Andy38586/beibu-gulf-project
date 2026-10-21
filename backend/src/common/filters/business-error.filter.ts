import { ArgumentsHost, Catch, ExceptionFilter, HttpException } from '@nestjs/common'
import { Logger } from '@nestjs/common'
import type { Request, Response } from 'express'

import { BusinessError } from '../errors/business-error'
// 详情净化统一走 common/utils（本件原为唯一实现，2026-09-23 起 task-queue / csp-report /
// task.service 三处同类 sink 一并复用，避免"哪一处漏了就等于那条通道没设防"）
import { sanitizeDetail } from '../utils/sanitize-detail'

/** 前端 useApiRequest 每次请求写入的关联 id 头（同名常量在
 *  frontend/src/shared/composables/useApiRequest.ts）。后端此前不读它，一条用户报障
 *  只能拿到前端控制台里的 rid，服务端日志里没有任何可对齐的键。头名没有机器对账
 *  判据——改一侧另一侧会静默失配（在册待裁）。 */
export const REQUEST_ID_HEADER = 'x-request-id'

/** 从请求头取关联 id 并净化：头值来自客户端，直接拼进日志等于把换行注入面
 *  从 message 搬到 header（本文件下方三条净化断言治的是同一类问题）。 */
function requestIdOf(host: ArgumentsHost): string {
  const raw = host.switchToHttp().getRequest<Request>().headers[REQUEST_ID_HEADER]
  const value = Array.isArray(raw) ? raw[0] : raw
  const flat = sanitizeDetail(value ?? '')
  return flat === '' ? '-' : flat
}

// 全局错误过滤：信封形状 { code, error, data: null }，逐项对齐老 Express 全局错误中间件
//（app.js）——BusinessError 按码返回；404 固定文案；429 限流裸 {error}；未知错误 500001
@Catch()
export class BusinessErrorFilter implements ExceptionFilter {
  private readonly logger = new Logger(BusinessErrorFilter.name)

  catch(exception: unknown, host: ArgumentsHost): void {
    const res = host.switchToHttp().getResponse<Response>()
    const rid = requestIdOf(host)

    if (exception instanceof BusinessError) {
      // 预期业务错误落 warn（不记堆栈，防噪音），对齐 Express logger.warn 口径
      const detail = sanitizeDetail(exception.message)
      this.logger.warn(
        `[${rid}] [BusinessError] ${exception.status} ${exception.bizCode}: ${detail}`
      )
      res.status(exception.status).json({ code: exception.bizCode, error: detail, data: null })
      return
    }

    if (exception instanceof HttpException) {
      const status = exception.getStatus()
      // 404 对齐 Express 兜底中间件文案；其余内建异常（如校验 400）映射同状态码
      if (status === 404) {
        res.status(404).json({ code: 404001, error: '接口不存在', data: null })
        return
      }
      if (status === 429) {
        // 限流响应对齐 express-rate-limit 的 message 形状（裸 {error}，无 code/data）；
        // 文案由 EnvelopeThrottlerGuard 按路由给出，缺省回落全局文案
        const response = exception.getResponse()
        const message =
          typeof response === 'string'
            ? response
            : ((response as { error?: string }).error ?? '请求过于频繁，请稍后再试')
        res.status(429).json({ error: message })
        return
      }
      res.status(status).json({ code: status * 1000 + 1, error: exception.message, data: null })
      return
    }

    // 未捕获异常不泄露堆栈；生产隐藏 detail，仅 dev 显示——对齐 Express 口径
    const message = exception instanceof Error ? exception.message : String(exception)
    this.logger.error(`[${rid}] 未捕获的服务器错误: ${sanitizeDetail(message)}`)
    res.status(500).json({
      code: 500001,
      error: process.env.NODE_ENV === 'production' ? '服务器内部错误' : message,
      data: null,
    })
  }
}
