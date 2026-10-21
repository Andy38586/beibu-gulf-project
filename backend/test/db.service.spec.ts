import { Logger } from '@nestjs/common'
import type { Pool } from 'pg'
import { afterAll, describe, expect, it, vi } from 'vitest'

import { DbService } from '../src/infra/db/db.service'

/** 直连构造（无 ConfigService 注入 → 回落 process.env 解析）；Pool 惰性连接，不触真库 */
const service = new DbService()

afterAll(async () => {
  await service.onModuleDestroy()
})

describe('DbService 连接池 error 监听（断库进程存活回归）', () => {
  it('空闲连接错误被池级监听吸收：不再作为未处理 error 击穿进程', () => {
    const pool = (service as unknown as { pool: Pool }).pool
    const logger = (service as unknown as { logger: Logger }).logger
    const spy = vi.spyOn(logger, 'error')
    // 模拟 DB 管理员终止连接（docker stop / 故障转移的真实错误形态）
    const fatal = Object.assign(new Error('terminating connection due to administrator command'), {
      code: '57P01',
    })
    // 修复前：Pool 无 'error' 监听 → EventEmitter 抛 "Unhandled 'error' event" → 进程退出
    expect(() => pool.emit('error', fatal)).not.toThrow()
    expect(spy).toHaveBeenCalledTimes(1)
    expect(String(spy.mock.calls[0]?.[0])).toContain('连接池空闲连接错误')
    expect(String(spy.mock.calls[0]?.[0])).toContain(
      'terminating connection due to administrator command'
    )
  })

  it('onModuleDestroy 关闭连接池（pool.end 被真正调用）', async () => {
    // W41：此前 afterAll 只"调用" onModuleDestroy 无任何 expect ⇒ 把
    // `await this.pool.end()` 删掉测试仍全绿（"只被调用、从未被断言的钩子"）。
    // 自建局部实例，避免干扰上面那条用例共享的 service 单例。
    // Pool 惰性连接，无连接时 end() 也正常 resolve，无需真库。
    const local = new DbService()
    const pool = (local as unknown as { pool: Pool }).pool
    const endSpy = vi.spyOn(pool, 'end').mockResolvedValue()
    await local.onModuleDestroy()
    expect(endSpy).toHaveBeenCalledTimes(1)
  })
})
