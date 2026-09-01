// 业务错误类与错误码表：逐字节对齐老 Express backend/utils/BusinessError.js
//（错误码命名 <HTTP status><业务序号>，如 400001 = 400 + 0001）
// 注意：实际码表为 9 项（含登录细分的 401002/401003），API 契约文档 §1.3 的"7 项"已过期，
// 以代码为权威（契约文档 §5 自身约定"接口清单以代码为准"）

export interface ErrorCodeEntry {
  code: number
  status: number
  message: string
}

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
} satisfies Record<string, ErrorCodeEntry>

export type ErrorCodeKey = keyof typeof ErrorCode

export class BusinessError extends Error {
  readonly bizCode: number
  readonly status: number

  constructor(errorCode: ErrorCodeEntry, detail = '') {
    super(detail || errorCode.message)
    this.name = 'BusinessError'
    this.bizCode = errorCode.code
    this.status = errorCode.status
  }
}
