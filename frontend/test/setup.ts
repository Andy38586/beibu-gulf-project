// 全局测试环境补丁：jsdom 缺失的浏览器 API
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

// @ts-expect-error 测试环境全局补丁（jsdom 未定义）
globalThis.ResizeObserver = globalThis.ResizeObserver || MockResizeObserver
