import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { effectScope } from 'vue'

import { closeModal, confirmModal, gcsModalState } from '../../utils/gcsFeedback'
import { useSlowRequestOffer, type UseSlowRequestOfferReturn } from '../useSlowRequestOffer'

// 方案 A 的触发器：超阈值才问，阈值内零打扰。
// 🔴 两条对照缺一不可：只测「慢必弹」的话，一个恒弹的实现（删掉计时判断）照样绿；
//    只测「快不弹」的话，一个永不弹的实现照样绿。

describe('useSlowRequestOffer', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    closeModal()
  })
  afterEach(() => {
    closeModal()
    vi.useRealTimers()
  })

  it('阴性对照：请求在阈值内返回 ⇒ 全程不弹提示，且原样返回结果', async () => {
    const onAccept = vi.fn()
    const offer = useSlowRequestOffer({ thresholdMs: 100, onAccept })

    await expect(offer.track(async () => 'fast')).resolves.toBe('fast')
    await vi.advanceTimersByTimeAsync(500)

    expect(gcsModalState.visible).toBe(false)
    expect(onAccept).not.toHaveBeenCalled()
  })

  it('阳性对照：请求超过阈值仍在途 ⇒ 弹提示（confirm 模式 + 一键文案）', async () => {
    const onAccept = vi.fn()
    const offer = useSlowRequestOffer({ thresholdMs: 100, onAccept })

    let release: (v: string) => void = () => undefined
    const pending = offer.track(() => new Promise<string>((r) => (release = r)))

    await vi.advanceTimersByTimeAsync(60)
    expect(gcsModalState.visible).toBe(false) // 未到阈值不打扰

    await vi.advanceTimersByTimeAsync(60)
    expect(gcsModalState.visible).toBe(true)
    expect(gcsModalState.mode).toBe('confirm')
    expect(gcsModalState.confirmText).toBe('转到后台')
    expect(gcsModalState.message).toContain('转到后台继续')

    release('done')
    await expect(pending).resolves.toBe('done')
    expect(onAccept).not.toHaveBeenCalled() // 只是弹了，没点就不该动手
  })

  it('点主按钮 ⇒ 执行注入的 onAccept（一键转后台），且弹窗关闭', async () => {
    const onAccept = vi.fn()
    const offer = useSlowRequestOffer({ thresholdMs: 100, onAccept })

    let release: (v: string) => void = () => undefined
    const pending = offer.track(() => new Promise<string>((r) => (release = r)))
    await vi.advanceTimersByTimeAsync(150)
    expect(gcsModalState.visible).toBe(true)

    confirmModal()
    expect(onAccept).toHaveBeenCalledTimes(1)
    expect(gcsModalState.visible).toBe(false)

    release('done')
    await pending
  })

  it('阈值内已返回的请求：即使计时器还差一点到期也不弹（用户已拿到结果）', async () => {
    const onAccept = vi.fn()
    const offer = useSlowRequestOffer({ thresholdMs: 1000, onAccept })

    await offer.track(async () => 1)
    await vi.advanceTimersByTimeAsync(2000)
    expect(gcsModalState.visible).toBe(false)
  })

  it('作用域销毁即注销计时器（不留悬挂 setTimeout 弹窗）', async () => {
    const onAccept = vi.fn()
    let offer!: UseSlowRequestOfferReturn
    const scope = effectScope()
    scope.run(() => {
      offer = useSlowRequestOffer({ thresholdMs: 100, onAccept })
    })

    let release: (v: string) => void = () => undefined
    void offer.track(() => new Promise<string>((r) => (release = r)))
    scope.stop()

    await vi.advanceTimersByTimeAsync(500)
    expect(gcsModalState.visible).toBe(false)

    release('done')
  })

  it('默认阈值是 3000ms（常量即口径，改它要有实测依据）——经默认路径行为钉住', async () => {
    // SLOW_REQUEST_THRESHOLD_MS 已收为模块内部（不再直调）；改走不传 thresholdMs 的默认路径：
    // 2999ms 不弹（近失）、3000ms 弹（达线）。
    const onAccept = vi.fn()
    const offer = useSlowRequestOffer({ onAccept })
    let release: (v: string) => void = () => undefined
    const pending = offer.track(() => new Promise<string>((r) => (release = r)))

    await vi.advanceTimersByTimeAsync(2999)
    expect(gcsModalState.visible).toBe(false)
    await vi.advanceTimersByTimeAsync(1)
    expect(gcsModalState.visible).toBe(true)

    release('done')
    await pending
  })
})
// D3 去 export：SLOW_REQUEST_THRESHOLD_MS 已收为模块内部；本组是「公开面收窄」本身的判据。
describe('公开面收窄 — SLOW_REQUEST_THRESHOLD_MS 不得再导出', () => {
  const INTERNAL = ['SLOW_REQUEST_THRESHOLD_MS']

  it('内部符号不在模块公开面；公开符号仍在（阳性对照）', async () => {
    const mod = (await import('../useSlowRequestOffer')) as unknown as Record<string, unknown>
    for (const k of INTERNAL) expect(mod[k], k + ' 应已收为模块内部').toBeUndefined()
    expect(typeof mod.useSlowRequestOffer).toBe('function')
  })
})
