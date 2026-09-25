import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// SDK 以 vi.hoisted 提前定义（vi.mock 的工厂会被提升到文件首，直接引用普通 const 会落 TDZ）
const sentryMock = vi.hoisted(() => ({
  init: vi.fn(),
  captureException: vi.fn(),
}))

vi.mock('@sentry/vue', () => sentryMock)

const DSN = 'https://public@example.ingest.sentry.io/1'

describe('errorReporting（z021 错误上报收口）', () => {
  beforeEach(() => {
    vi.resetModules()
    sentryMock.init.mockReset()
    sentryMock.captureException.mockReset()
    delete import.meta.env.VITE_SENTRY_DSN
  })

  afterEach(() => {
    delete import.meta.env.VITE_SENTRY_DSN
    vi.resetModules()
  })

  it('未配置 VITE_SENTRY_DSN → 不初始化 SDK；captureError 静默 no-op（本地/CI 零影响）', async () => {
    const mod = await import('../errorReporting')
    await mod.initErrorReporting()

    expect(sentryMock.init).not.toHaveBeenCalled()
    expect(() => mod.captureError(new Error('boom'), { source: 'vue.errorHandler' })).not.toThrow()
    expect(sentryMock.captureException).not.toHaveBeenCalled()
  })

  it('配置 DSN → 用该 DSN 初始化；captureError 上报异常并携带 extra 上下文', async () => {
    import.meta.env.VITE_SENTRY_DSN = DSN
    const mod = await import('../errorReporting')
    await mod.initErrorReporting()

    expect(sentryMock.init).toHaveBeenCalledTimes(1)
    expect(sentryMock.init.mock.calls[0][0]).toMatchObject({ dsn: DSN })

    const err = new Error('boom')
    mod.captureError(err, { source: 'vue.errorHandler', info: 'render' })
    expect(sentryMock.captureException).toHaveBeenCalledWith(err, {
      extra: { source: 'vue.errorHandler', info: 'render' },
    })

    // 无上下文：不应造出空的 extra（否则 Sentry 事件多一层噪声字段）
    mod.captureError(err)
    expect(sentryMock.captureException).toHaveBeenLastCalledWith(err, undefined)
  })

  it('初始化的 integrations 过滤掉 GlobalHandlers，保留其余默认集成（防与 main.ts 钩子重复上报）', async () => {
    import.meta.env.VITE_SENTRY_DSN = DSN
    const mod = await import('../errorReporting')
    await mod.initErrorReporting()

    const { integrations } = sentryMock.init.mock.calls[0][0]
    expect(typeof integrations).toBe('function')
    expect(
      integrations([{ name: 'GlobalHandlers' }, { name: 'Breadcrumbs' }, { name: 'Dedupe' }])
    ).toEqual([{ name: 'Breadcrumbs' }, { name: 'Dedupe' }])
  })

  it('SDK 初始化抛错 → initErrorReporting 不上抛，captureError 保持 no-op', async () => {
    import.meta.env.VITE_SENTRY_DSN = DSN
    sentryMock.init.mockImplementationOnce(() => {
      throw new Error('bad dsn')
    })
    const mod = await import('../errorReporting')

    await expect(mod.initErrorReporting()).resolves.toBeUndefined()
    mod.captureError(new Error('boom'))
    expect(sentryMock.captureException).not.toHaveBeenCalled()
  })

  it('SDK 动态 import 失败 → initErrorReporting 不上抛，captureError 保持 no-op', async () => {
    import.meta.env.VITE_SENTRY_DSN = DSN
    vi.resetModules()
    vi.doMock('@sentry/vue', () => {
      throw new Error('chunk load failed')
    })
    const mod = await import('../errorReporting')

    await expect(mod.initErrorReporting()).resolves.toBeUndefined()
    mod.captureError(new Error('boom'))
    expect(sentryMock.captureException).not.toHaveBeenCalled()
  })
})
