// 全局测试环境补丁：jsdom 缺失的浏览器 API + 测试环境 env 兜底
//
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

// VITE_USE_NEST_MODULES 测试环境兜底 —— **已随 D1a 收口删除**（2026-10-12）：
// 该变量曾用于「逐模块前缀切换」，只写在 gitignored 的 frontend/.env.local，CI fresh
// checkout 下为 undefined ⇒ 域清单空集 ⇒ 回退 /api 前缀 ⇒ 环境依赖型假绿/假红
// （2026-09-12 CI run#169/#170 实锤），故当时在测试侧 stub 生产同口径清单。
// 收口为**单前缀**后，该变量与域清单整体退役 ⇒ 本 stub 的断言对象不存在，一并删除。
// 前缀解析现在只依赖 VITE_NEST_API_BASE（见 vitest.config.js 的 env）。
