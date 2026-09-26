/**
 * 错误上报收口（z021）——`@sentry/vue` 接入。
 *
 * 设计约束（对应台账 z021「预期思路-方案B：直接接 SDK，不动 logger」）：
 * - 门控开关 = `VITE_SENTRY_DSN`。**未配置（本地/CI 默认）时不加载 SDK、不初始化、不报错**。
 *   且这是**构建期**门控：Vite 把 `import.meta.env.VITE_SENTRY_DSN` 静态替换为 `undefined`，
 *   压缩器随即判定 `if (!dsn) return` 之后是死代码、连 `import()` 一起消除 ⇒
 *   未配置 DSN 时产物里**完全没有 Sentry**（实测 grep `sentry`/`GlobalHandlers` 零命中）。
 * - DSN 由部署方经环境变量注入，不入库（`.env.example` 只留说明）。
 * - ⚠️ **必须用命名导入**。`const Sentry = await import('@sentry/vue')` 这种命名空间形态
 *   会让打包器保留 `@sentry/browser` 的**整个导出面**：旧判据下实测（Sentry 被并入首屏
 *   vue-vendor）gzip 48.3KB → 152.6KB，4.6 倍；下面这种解构命名导入是唯一正确形态，
 *   命名空间写法只是"看起来等价"——重构时别改回去。
 * - Sentry 落在**独立异步 chunk**（z021，2026-09-26 收窄）：`vite.config.js` 的
 *   manualChunks 判据已按**包边界**匹配（`/node_modules/(vue|@vue|vue-router|pinia)/`），
 *   不再命中 `node_modules/@sentry/vue/`。本模块只经动态 `import()` 引用 SDK ⇒ 配置 DSN 后
 *   Sentry 仍在**首次上报时机**才加载、不进首屏：实测新判据 vue-vendor gzip 11.72KB（0 处
 *   Sentry 代码），Sentry 落在未预载的异步 chunk `esm-*.js`（gzip 37.5KB）；旧判据
 *   vue-vendor gzip 48.87KB 且含 Sentry 代码。
 * - 摘掉 Sentry 默认的 `GlobalHandlers` 集成：`main.ts` 已自管 `window.onerror` /
 *   `window.onunhandledrejection`（还要做 perf 分类计数），两套全局钩子会互相覆盖并重复上报；
 *   故统一由本模块 `captureError` 显式上报，谁是唯一上报入口是确定的。
 * - **CSP 待办**：`nginx.conf` 的 `connect-src` 仍是 `'self'`，填入真实 DSN 后浏览器上报会被
 *   Report-Only 记为违规、切强制后会被拦截——填 DSN 时须同步放行 Sentry 上报域。
 */

/** 结构最小化：只要求集成有 name，避免为一行 filter 引入 SDK 类型依赖 */
interface NamedIntegration {
  name: string
}

/** 上报上下文（进 event.extra，不参与分组） */
type ErrorContext = Record<string, unknown>

type CaptureFn = (error: unknown, context?: ErrorContext) => void

/** 非空 = 已初始化；为 null 时 `captureError` 是 no-op */
let capture: CaptureFn | null = null

/**
 * 从默认集成里摘掉 `GlobalHandlers`（避免与 main.ts 的 window 钩子互相覆盖/重复上报）。
 * 名字取自 `@sentry/browser` 的 `INTEGRATION_NAME = 'GlobalHandlers'`（v11.0.0 实测）。
 */
function withoutGlobalHandlers<T extends NamedIntegration>(integrations: T[]): T[] {
  return integrations.filter((integration) => integration.name !== 'GlobalHandlers')
}

/**
 * 按 `VITE_SENTRY_DSN` 决定是否接入上报。未配置即静默返回（不抛、不告警）。
 * 加载/初始化失败同样吞掉——上报通道不得成为启动失败源。
 */
export async function initErrorReporting(): Promise<void> {
  const dsn = import.meta.env.VITE_SENTRY_DSN
  if (!dsn) return
  try {
    const { init, captureException } = await import('@sentry/vue')
    init({
      dsn,
      environment: import.meta.env.MODE,
      integrations: withoutGlobalHandlers,
    })
    capture = (error, context) => {
      captureException(error, context ? { extra: context } : undefined)
    }
  } catch {
    // 静默：未接入不等于出错（本地/CI 零影响）
  }
}

/** 上报一条错误；未配置 DSN（未初始化）或 SDK 加载失败时为 no-op */
export function captureError(error: unknown, context?: ErrorContext): void {
  if (!capture) return
  capture(error, context)
}
