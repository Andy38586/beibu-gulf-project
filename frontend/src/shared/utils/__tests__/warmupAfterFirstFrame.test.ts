import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { warmupAfterFirstFrame } from '../warmupAfterFirstFrame'

// 🔴 这条判据钉的是**时机**，不是"有没有调用"：
//    把 rAF 门摘掉直接执行必须红 —— 那正是"首屏还在忙就先抢 5.8MB 带宽"的形态；
//    只断言"最终会调用"的话，恒立刻调用的实现照样绿（等于没测）。
//
// ⚠️ 假定时器只 fake setTimeout：vitest 的 useFakeTimers 默认也会接管 rAF，
//    那会把本用例的 rAF 桩悄悄换掉（第一版就踩了，表现为 rafCbs[0] is not a function）。

type RafCb = (t: number) => void
let rafCbs: RafCb[] = []
let idleCbs: Array<() => void> = []
const g = globalThis as unknown as Record<string, unknown>
let savedRaf: unknown
let savedRic: unknown

const install = (): void => {
  g.requestAnimationFrame = (cb: RafCb) => {
    rafCbs.push(cb)
    return rafCbs.length
  }
  g.requestIdleCallback = (cb: () => void) => {
    idleCbs.push(cb)
    return idleCbs.length
  }
}

describe('warmupAfterFirstFrame（首帧后空闲预热调度）', () => {
  beforeEach(() => {
    rafCbs = []
    idleCbs = []
    savedRaf = g.requestAnimationFrame
    savedRic = g.requestIdleCallback
  })
  afterEach(() => {
    if (savedRaf === undefined) delete g.requestAnimationFrame
    else g.requestAnimationFrame = savedRaf
    if (savedRic === undefined) delete g.requestIdleCallback
    else g.requestIdleCallback = savedRic
    vi.useRealTimers()
  })

  it('🔴 首帧前不执行、空闲回调前也不执行，idle 才执行一次（不抢首屏）', () => {
    install()
    const task = vi.fn()
    warmupAfterFirstFrame(task)

    expect(rafCbs).toHaveLength(1) // 排了一帧，不是立刻跑
    expect(task).not.toHaveBeenCalled()

    rafCbs[0](0)
    expect(idleCbs).toHaveLength(1) // 画完只是转交空闲队列
    expect(task).not.toHaveBeenCalled()

    idleCbs[0]()
    expect(task).toHaveBeenCalledTimes(1)
  })

  it('无 requestIdleCallback（老 Safari）：画完后经宏任务执行，不丢预热', () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    install()
    delete g.requestIdleCallback
    const task = vi.fn()
    warmupAfterFirstFrame(task)

    expect(rafCbs).toHaveLength(1)
    rafCbs[0](0)
    expect(task).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1)
    expect(task).toHaveBeenCalledTimes(1)
  })

  it('两个 API 都没有（极老环境）：退化为宏任务，仍会执行（不静默丢预热）', () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    install()
    delete g.requestAnimationFrame
    delete g.requestIdleCallback
    const task = vi.fn()
    warmupAfterFirstFrame(task)

    expect(task).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1)
    expect(task).toHaveBeenCalledTimes(1)
  })

  it('task 抛错被吞掉：预热失败不得冒泡打断启动链路', () => {
    install()
    const boom = vi.fn(() => {
      throw new Error('preload failed')
    })
    warmupAfterFirstFrame(boom)
    rafCbs[0](0)
    expect(() => idleCbs[0]()).not.toThrow()
    expect(boom).toHaveBeenCalledTimes(1)
  })
})
