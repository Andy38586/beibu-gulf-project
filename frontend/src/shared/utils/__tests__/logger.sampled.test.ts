/**
 * F8 回归：失败类（warn 级）采样日志不得被生产采样率吞掉。
 * 修前 `sampled` 对 warn/info 同走 `Math.random() < PROD_SAMPLE_RATE(1%)`
 * ⇒ 「重试耗尽/不可重试」的失败日志在生产 99% 的情况下不输出。
 *
 * shouldEmitSampled 已收为模块内部（唯一消费者 = logger.sampled）；本组改走公开面：
 * 以 `vi.stubEnv('DEV', false)` 造生产态 + 动态 import + 钉 Math.random 与 console。
 */
import { afterEach, describe, expect, it, vi } from 'vitest'

afterEach(() => {
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
  vi.resetModules()
})

/** 装好桩并取回 logger：dev=false 造生产态，random 钉死采样掷点 */
async function prodLogger(random: number): Promise<typeof import('../logger').logger> {
  vi.stubEnv('DEV', false)
  vi.resetModules()
  vi.spyOn(Math, 'random').mockReturnValue(random)
  const { logger } = await import('../logger')
  return logger
}

describe('logger 采样分级口径（F8）', () => {
  it('🔴 warn 不受采样率约束：生产 random=0.999 仍输出（删分级即红）', async () => {
    // 修前公式 `isDev || random < 0.01` ⇒ 不输出
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    for (const r of [0.999, 0.5]) {
      const logger = await prodLogger(r)
      logger.sampled('warn', 'retry-exhausted')
    }
    expect(warnSpy).toHaveBeenCalledTimes(2)
  })

  it('info 仍按采样率低噪：生产 random=0.999 不输出、random=0.001 输出', async () => {
    // emit() 对 info 走 console.info（level==='debug' 才走 console.log）
    const infoSpy = vi.spyOn(console, 'info').mockImplementation(() => undefined)
    const miss = await prodLogger(0.999)
    miss.sampled('info', 'noise')
    expect(infoSpy).not.toHaveBeenCalled()
    const hit = await prodLogger(0.001)
    hit.sampled('info', 'noise')
    expect(infoSpy).toHaveBeenCalledTimes(1)
  })

  it('dev 环境全量输出（warn/info 都发）', async () => {
    const infoSpy = vi.spyOn(console, 'info').mockImplementation(() => undefined)
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    vi.stubEnv('DEV', true)
    vi.resetModules()
    vi.spyOn(Math, 'random').mockReturnValue(0.999)
    const { logger } = await import('../logger')
    logger.sampled('info', 'dev-info')
    logger.sampled('warn', 'dev-warn')
    expect(infoSpy).toHaveBeenCalledTimes(1)
    expect(warnSpy).toHaveBeenCalledTimes(1)
  })
})
// D3 去 export：shouldEmitSampled 已收为模块内部；本组是「公开面收窄」本身的判据。
describe('公开面收窄 — shouldEmitSampled 不得再导出', () => {
  const INTERNAL = ['shouldEmitSampled']

  it('内部符号不在模块公开面；公开符号仍在（阳性对照）', async () => {
    const mod = (await import('../logger')) as unknown as Record<string, unknown>
    for (const k of INTERNAL) expect(mod[k], k + ' 应已收为模块内部').toBeUndefined()
    expect(typeof mod.logger).toBe('object')
  })
})
