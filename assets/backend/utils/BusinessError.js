/**
 * 业务错误类（BusinessError）：service 层禁止直接 throw Error，
 * 统一携带 code + status，controller 按 instanceof 返回对应 HTTP 状态码。
 * 错误码命名：<HTTP status><业务序号>（400001 = 400 + 0001）
 */

export const ErrorCode = {
  INVALID_PARAMS: { code: 400001, status: 400, message: '参数验证失败' },
  UNAUTHORIZED: { code: 401001, status: 401, message: '认证令牌无效或已过期' },
  // 登录失败细分（前端按 bizCode 分语义提示：401002 引导注册，401003 仅提示密码错误）
  USER_NOT_FOUND: { code: 401002, status: 401, message: '账号不存在，请先注册' },
  WRONG_PASSWORD: { code: 401003, status: 401, message: '密码错误' },
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
