/**
 * 后端业务码（bizCode）前端唯一消费表。
 * 与 backend/src/common/errors/business-error.ts 的 ErrorCode 同源——
 * 双侧一致性由 tools/v3-guard/constants-audit.mjs 断言（guard:v3 拦截漂移）。
 * 消费方按码分语义反馈（如登录失败 401002 引导注册 / 401003 仅提示密码错误），
 * 禁止在组件内手抄数字（漂移即静默失效）。
 */

/** 登录/注册失败的业务码细分 */
export const AUTH_BIZ_CODE = {
  USER_NOT_FOUND: 401002,
  WRONG_PASSWORD: 401003,
} as const
