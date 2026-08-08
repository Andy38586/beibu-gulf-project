import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { ApiError, ErrorCode } from '../../composables/useApiRequest'
import { showError } from '../errorHandler'

// 2026-08-08 打磨：errorHandler 反馈层从 ElMessage/ElMessageBox 换成 GCS 单例
// （showModal/showToast），测试 mock gcsFeedback 断言调用。
const mockShowModal = vi.fn()
const mockShowToast = vi.fn()

vi.mock('../gcsFeedback', () => ({
  showModal: (...args: unknown[]) => mockShowModal(...args),
  showToast: (...args: unknown[]) => mockShowToast(...args),
}))

beforeEach(() => {
  vi.clearAllMocks()
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('showError (d073 取消静默 + toast/modal 分级)', () => {
  it('用户取消类 ApiError（REQUEST_FAILED + 请求已取消）→ 静默，不弹任何提示', () => {
    // d073 根因场景：滑块拖动时新请求 abort 旧请求，useApiRequest 抛此错误
    showError(new ApiError('请求已取消', ErrorCode.REQUEST_FAILED))
    expect(mockShowToast).not.toHaveBeenCalled()
    expect(mockShowModal).not.toHaveBeenCalled()
  })

  it('普通 Error → GCS toast（error 类型）', () => {
    showError(new Error('网络异常'))
    expect(mockShowToast).toHaveBeenCalledTimes(1)
    expect(mockShowToast).toHaveBeenCalledWith('网络异常', 'error')
  })

  it('字符串错误 → GCS toast（error 类型）', () => {
    showError('加载失败')
    expect(mockShowToast).toHaveBeenCalledWith('加载失败', 'error')
  })

  it('带 retry 回调 → GCS modal（error 模式，onConfirm 为重试回调）', () => {
    const retry = vi.fn()
    showError(new Error('服务器错误'), { retry })
    expect(mockShowModal).toHaveBeenCalledTimes(1)
    expect(mockShowToast).not.toHaveBeenCalled()
    expect(mockShowModal).toHaveBeenCalledWith(
      expect.objectContaining({
        message: '服务器错误',
        mode: 'error',
        onConfirm: retry,
      })
    )
  })

  it('原生 AbortError → 静默（原有过滤保留）', () => {
    const abortErr = new Error('The operation was aborted')
    abortErr.name = 'AbortError'
    showError(abortErr)
    expect(mockShowToast).not.toHaveBeenCalled()
    expect(mockShowModal).not.toHaveBeenCalled()
  })

  it('silent: true → 不弹窗', () => {
    showError(new Error('静默错误'), { silent: true })
    expect(mockShowToast).not.toHaveBeenCalled()
    expect(mockShowModal).not.toHaveBeenCalled()
  })
})
