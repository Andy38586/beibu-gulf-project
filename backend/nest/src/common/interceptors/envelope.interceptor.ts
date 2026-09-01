import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common'
import type { Response } from 'express'
import { Observable } from 'rxjs'
import { map } from 'rxjs/operators'

// 统一成功信封拦截器：{ code: <同HTTP状态>, data } —— 对齐老 Express sendSuccess
//（201 创建资源同样携带 code=201）。controller 返回纯业务 data，信封在此收口；
// 用 @Res() 直操响应的路由（health 探针等）自然绕过本拦截器，与 Express 行为一致
@Injectable()
export class EnvelopeInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    return next.handle().pipe(
      map((data) => {
        const res = context.switchToHttp().getResponse<Response>()
        return { code: res.statusCode, data }
      })
    )
  }
}
