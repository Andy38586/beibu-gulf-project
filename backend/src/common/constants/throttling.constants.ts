// 限流桶参数：逐值对齐 Express express-rate-limit（命名桶 global/login/register 共用 15min 窗口）；
// forecast 为合法高频交互（时间轴轮播）整体豁免，不在此列
export const THROTTLER_TTL_MS = 15 * 60 * 1000
export const THROTTLER_GLOBAL_LIMIT = 1000
export const THROTTLER_AUTH_LIMIT = 50

// 非认证路由共用：跳过 login/register 命名桶（两桶只服务认证端点；
// 命名桶默认套用全部路由，漏挂会被 50/15min 误伤）
export const SKIP_AUTH_NAMED_THROTTLERS = { login: true, register: true }
