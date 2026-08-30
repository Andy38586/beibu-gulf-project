import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { ApiError, ErrorCode } from '../../composables/useApiRequest'
import { describeError, showError } from '../errorHandler'

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

describe('describeError（错误码 → 成因文案，用户提示与日志分工）', () => {
  it('NETWORK_ERROR/TIMEOUT →「服务器无响应」，不透传原始技术串', () => {
    expect(describeError(new ApiError('网络异常，请检查网络连接', ErrorCode.NETWORK_ERROR))).toBe(
      '服务器无响应，请检查网络后重试'
    )
    expect(describeError(new ApiError('请求超时，请检查网络后重试', ErrorCode.TIMEOUT))).toBe(
      '服务器无响应，请检查网络后重试'
    )
  })

  it('SERVER_ERROR：可读中文透传（描述具体情况），技术串/HTML 回退服务器无响应', () => {
    expect(describeError(new ApiError('方案保存失败：名称重复', ErrorCode.SERVER_ERROR))).toBe(
      '方案保存失败：名称重复'
    )
    expect(
      describeError(
        new ApiError('<html>Error occured while trying to proxy</html>', ErrorCode.SERVER_ERROR)
      )
    ).toBe('服务器无响应，请检查网络后重试')
  })

  it('UNAUTHORIZED/REQUEST_FAILED：透传可读消息，fallback 兜底', () => {
    // 登录失败细分文案（后端 401003）按原样透传，不覆盖不笼统化
    expect(describeError(new ApiError('密码错误', ErrorCode.UNAUTHORIZED), '登录已失效')).toBe(
      '密码错误'
    )
    expect(
      describeError(new ApiError('请求失败 HTTP 404', ErrorCode.REQUEST_FAILED), '操作失败')
    ).toBe('请求失败 HTTP 404')
  })

  it('非 ApiError 的 Error 经 sanitizeMessage 无害化', () => {
    expect(describeError(new Error('方案列表加载失败'))).toBe('方案列表加载失败')
    expect(describeError(new Error('fetch failed: ECONNREFUSED'))).toBe('操作失败，请稍后重试')
  })

  it('showError 对 ApiError 也走 describeError（服务器无响应不笼统化为 fallback）', () => {
    showError(new ApiError('网络异常，请检查网络连接', ErrorCode.NETWORK_ERROR), {
      fallback: '方案列表加载失败，请稍后重试',
    })
    expect(mockShowToast).toHaveBeenCalledWith('服务器无响应，请检查网络后重试', 'error')
  })
})
