import { ArgumentsHost, Catch, ExceptionFilter, HttpException } from '@nestjs/common'
import { Logger } from '@nestjs/common'
import type { Response } from 'express'

import { BusinessError } from '../errors/business-error'

// 全局错误过滤：信封形状 { code, error, data: null }，逐项对齐老 Express 全局错误中间件
//（app.js）——BusinessError 按码返回；404 固定文案；429 限流裸 {error}；未知错误 500001
@Catch()
export class BusinessErrorFilter implements ExceptionFilter {
  private readonly logger = new Logger(BusinessErrorFilter.name)

  catch(exception: unknown, host: ArgumentsHost): void {
    const res = host.switchToHttp().getResponse<Response>()

    if (exception instanceof BusinessError) {
      // 预期业务错误落 warn（不记堆栈，防噪音），对齐 Express logger.warn 口径
      this.logger.warn(
        `[BusinessError] ${exception.status} ${exception.bizCode}: ${exception.message}`
      )
      res
        .status(exception.status)
        .json({ code: exception.bizCode, error: exception.message, data: null })
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
        // 限流响应对齐 express-rate-limit 的 message 形状（裸 {error}，无 code/data）
        res.status(429).json({ error: '请求过于频繁，请稍后再试' })
        return
      }
      res.status(status).json({ code: status * 1000 + 1, error: exception.message, data: null })
      return
    }

    // 未捕获异常不泄露堆栈；生产隐藏 detail，仅 dev 显示——对齐 Express 口径
    const message = exception instanceof Error ? exception.message : String(exception)
    this.logger.error(`未捕获的服务器错误: ${message}`)
    res.status(500).json({
      code: 500001,
      error: process.env.NODE_ENV === 'production' ? '服务器内部错误' : message,
      data: null,
    })
  }
}
