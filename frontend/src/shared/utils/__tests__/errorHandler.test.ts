import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { ApiError, ErrorCode } from '../../composables/useApiRequest'
import { showError } from '../errorHandler'

// Element Plus 全局在 vitest 环境无自动导入（unplugin-auto-import 仅 vite 构建时生效），
// 这里 stub 全局，模拟生产环境 ElMessage/ElMessageBox 可用。
const elMessageError = vi.fn()
// errorHandler 内 ElMessageBox.confirm(...).then(...) 链式调用，mock 必须返回 Promise；
// 显式声明可变参数类型，避免 calls 推断为空元组导致 TS2493
const elMessageBoxConfirm = vi.fn((..._args: unknown[]) => Promise.resolve('confirm'))

beforeEach(() => {
  ;(globalThis as Record<string, unknown>).ElMessage = { error: elMessageError }
  ;(globalThis as Record<string, unknown>).ElMessageBox = { confirm: elMessageBoxConfirm }
  vi.clearAllMocks()
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('showError (d073 取消静默 + toast/modal 分级)', () => {
  it('用户取消类 ApiError（REQUEST_FAILED + 请求已取消）→ 静默，不弹任何提示', () => {
    // d073 根因场景：滑块拖动时新请求 abort 旧请求，useApiRequest 抛此错误
    showError(new ApiError('请求已取消', ErrorCode.REQUEST_FAILED))
    expect(elMessageError).not.toHaveBeenCalled()
    expect(elMessageBoxConfirm).not.toHaveBeenCalled()
  })

  it('普通 Error → ElMessage.error（toast）', () => {
    showError(new Error('网络异常'))
    expect(elMessageError).toHaveBeenCalledTimes(1)
    expect(elMessageError).toHaveBeenCalledWith('网络异常')
  })

  it('字符串错误 → ElMessage.error（toast）', () => {
    showError('加载失败')
    expect(elMessageError).toHaveBeenCalledWith('加载失败')
  })

  it('带 retry 回调 → ElMessageBox.confirm（modal，保留用户决策场景）', () => {
    const retry = vi.fn()
    showError(new Error('服务器错误'), { retry })
    expect(elMessageBoxConfirm).toHaveBeenCalledTimes(1)
    expect(elMessageError).not.toHaveBeenCalled()
    // 确认弹窗的"重试"按钮触发回调
    const confirmOptions = elMessageBoxConfirm.mock.calls[0]?.[2] as
      | { confirmButtonText?: string }
      | undefined
    expect(confirmOptions?.confirmButtonText).toBe('重试')
  })

  it('原生 AbortError → 静默（原有过滤保留）', () => {
    const abortErr = new Error('The operation was aborted')
    abortErr.name = 'AbortError'
    showError(abortErr)
    expect(elMessageError).not.toHaveBeenCalled()
  })

  it('silent: true → 不弹窗', () => {
    showError(new Error('静默错误'), { silent: true })
    expect(elMessageError).not.toHaveBeenCalled()
  })
})
