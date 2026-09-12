// 全局测试环境补丁：jsdom 缺失的浏览器 API + 测试环境 env 兜底
//
import { vi } from 'vitest'
// ResizeObserver —— UnifiedMap.vue watchContainerSize（a043）依赖它观察地图容器尺寸。
// jsdom 未实现 ResizeObserver，直接 `new ResizeObserver(...)` 会抛 ReferenceError，
// 且抛错发生在赋值语句上导致变量保持 null、后续 watch 反复重试 →
// unhandled rejection → vitest worker 进程挂起（整个测试套件"跑不完"）。
// 这里用空实现模拟真实浏览器行为（observe/unobserve/disconnect 无副作用），
// 与浏览器语义一致：注册回调但不触发，测试不依赖真实布局尺寸。
class MockResizeObserver {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}

// DOM lib 已定义 ResizeObserver，赋值类型兼容（运行时 jsdom 缺失才需补丁）
globalThis.ResizeObserver = globalThis.ResizeObserver || MockResizeObserver

// VITE_USE_NEST_MODULES 测试环境兜底（2026-09-12，CI run#169/#170 复现定位）：
// 该变量只写在 gitignored 的 frontend/.env.local，CI fresh checkout 下为 undefined →
// useApiRequest 的 NEST_ENABLED_MODULES 空集 → route 域回退 /api 前缀 →
// useRouteApi.test.ts「直连 /nest-api」断言本地恒绿、CI 必红（环境依赖型假绿/假红）。
// 此处 stub 生产同口径清单——生产镜像由 ci.yml build-args 注入同一串值（单一事实源），
// setupFiles 先于测试模块加载执行，stub 对模块顶层求值的 Set 生效。
// 回滚开关与 .env.local 同口径：清空字符串即恢复全回退 /api 语义。
vi.stubEnv('VITE_USE_NEST_MODULES', 'auth,plans,favorites,forecast,flood,site-analysis,route')
