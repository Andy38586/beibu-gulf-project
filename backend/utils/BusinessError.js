/**
 * 统一业务错误码与错误类
 * 规范 6.2：service 层不直接 throw new Error('xxx')，用 BusinessError 携带
 * 标准化 code + status，controller 层统一 instanceof 判断后返回对应 HTTP 状态码。
 * 错误码命名约定：<HTTP status><业务序号>，例如 400001 = 400 + 0001
 */

export const ErrorCode = {
  INVALID_PARAMS: { code: 400001, status: 400, message: '参数验证失败' },
  UNAUTHORIZED: { code: 401001, status: 401, message: '认证令牌无效或已过期' },
  FORBIDDEN: { code: 403001, status: 403, message: '无权访问此资源' },
  NOT_FOUND: { code: 404001, status: 404, message: '资源不存在' },
  DUPLICATE_USERNAME: { code: 409001, status: 409, message: '用户名已存在' },
  DUPLICATE_RESOURCE: { code: 409002, status: 409, message: '资源已存在' },
  ANALYSIS_FAILED: { code: 422001, status: 422, message: '分析计算失败' },
}

export class BusinessError extends Error {
  constructor(errorCode, detail = '') {
    super(detail || errorCode.message)
    this.name = 'BusinessError'
    this.code = errorCode.code
    this.status = errorCode.status
  }
}
