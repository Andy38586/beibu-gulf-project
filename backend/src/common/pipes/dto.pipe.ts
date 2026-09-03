import { Injectable, type PipeTransform } from '@nestjs/common'

// DTO 白名单校验统一管道：controller 入参一律经 DTO.parse 收口（d051 思路），
// 不留裸 body 透传。校验失败由 DTO 抛 BusinessError，全局错误过滤统一出信封
@Injectable()
export class DtoPipe<T> implements PipeTransform {
  constructor(private readonly parse: (raw: unknown) => T) {}

  transform(value: unknown): T {
    return this.parse(value)
  }
}
