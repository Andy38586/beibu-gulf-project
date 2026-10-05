/**
 * F8 回归：失败类（warn 级）采样日志不得被生产采样率吞掉。
 * 修前 `sampled` 对 warn/info 同走 `Math.random() < PROD_SAMPLE_RATE(1%)`
 * ⇒ 「重试耗尽/不可重试」的失败日志在生产 99% 的情况下不输出。
 * 口径钉在纯函数 shouldEmitSampled（dev 参数显式传入：测试环境本身 DEV=true，
 * 直接数 console 调用会把「dev 全量」误当成分级生效）。
 */
import { describe, expect, it } from 'vitest'

import { shouldEmitSampled } from '../logger'

const PROD = false
const DEV = true

describe('logger 采样分级口径（F8）', () => {
  it('🔴 warn 不受采样率约束：生产 random=0.999 仍输出（删分级即红）', () => {
    // 修前公式 `isDev || random < 0.01` ⇒ false
    expect(shouldEmitSampled('warn', PROD, 0.999)).toBe(true)
    expect(shouldEmitSampled('warn', PROD, 0.5)).toBe(true)
  })

  it('info 仍按采样率低噪：生产 random=0.999 不输出、random=0.001 输出', () => {
    expect(shouldEmitSampled('info', PROD, 0.999)).toBe(false)
    expect(shouldEmitSampled('info', PROD, 0.001)).toBe(true)
  })

  it('dev 环境全量输出（warn/info 都发）', () => {
    expect(shouldEmitSampled('info', DEV, 0.999)).toBe(true)
    expect(shouldEmitSampled('warn', DEV, 0.999)).toBe(true)
  })
})
