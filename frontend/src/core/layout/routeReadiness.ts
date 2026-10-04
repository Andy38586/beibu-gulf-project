/**
 * routeReadiness — 「该路由的页面还在准备中」向 core 层的注入机制（2026-10-02，Cesium ②）
 *
 * 与 taskIndicator 同款（core 不引 stores，铁律 L3）：根入口 App.vue 注入取值函数 +
 * 数据变化时 notify()，core 侧只读版本号重算，不把 Pinia 拖进 core 的类型面。
 *
 * ## 为什么需要它
 *
 * 3D 路由首进要下载 Cesium.js（5.8MB）并建首帧——真机限速实测 10–16s，用户体感是
 * "点了没反应/点不进去"（台账 z037）。用户 2026-10-02 定：**不新增 UI 形态**，复用
 * 导航进度环表达「这个页面还在准备」，就绪即熄灭；且**所有 3D 路由都适用**。
 *
 * 判据由路由 meta.engine 派生（不写死路由清单）⇒ 新增 3D 模块自动纳入。
 */
import { readonly, ref } from 'vue'

/** 页面准备态：某路由当前是否仍在准备（渲染器尚未切到该路由要求的引擎） */
export interface RouteReadinessState {
  preparing: boolean
}

/** 默认空态（未注入 / 该路由不在准备时的唯一真相） */
export const EMPTY_ROUTE_READINESS: RouteReadinessState = Object.freeze({ preparing: false })

/** 取值函数签名：给定路由路径 → 该路由的准备态 */
type RouteReadinessGetter = (route: string) => RouteReadinessState

const getter = ref<RouteReadinessGetter>(() => EMPTY_ROUTE_READINESS)

/** 版本号：注入方每次数据变化后 notify() 递增；core 侧 watch 它重算 */
const version = ref(0)

/** core 侧消费：读取版本号（watch 它触发重算） */
export const routeReadinessVersion = readonly(version)

/** core 侧消费：按路由取准备态 */
export function getRouteReadiness(route: string): RouteReadinessState {
  return getter.value(route)
}

/** 根入口注入（App.vue setup 内一次性调用） */
export function registerRouteReadiness(fn: RouteReadinessGetter): void {
  getter.value = fn
  version.value += 1
}

/** 注入方通知数据已变（触发 core 侧重算） */
export function notifyRouteReadiness(): void {
  version.value += 1
}

/**
 * 「准备中」判据（纯函数：App.vue 与测试共用同一份口径，不各写一份）。
 *
 * @param engine        路由声明的引擎（route.meta.engine）
 * @param rendererType  当前渲染器实际类型（renderer.getType()）；null = 尚未建
 * @param requestedType 期望引擎（mapStore.mapType，由 App 路由守卫写入）
 *
 * 三个条件同时成立才算准备中：
 *   ① 该路由要 3D —— **只对 3D 路由生效**（2D 路由恒 false，用户 2026-10-02 定）
 *   ② 渲染器还不是 3D —— 已是 3D（缓存命中/二次进入）⇒ false，不闪一下
 *   ③ 期望引擎仍是 3D —— 切换失败时 UnifiedMap 会回滚 mapStore.mapType 到旧值
 *      （UnifiedMap.vue 的 switchMapType catch 分支）⇒ 此处立刻 false，
 *      **环不会在失败后永远呼吸**（那是"永远在准备"的假象）
 */
export function isRoutePreparing(
  engine: unknown,
  rendererType: string | null | undefined,
  requestedType: string | null | undefined
): boolean {
  return engine === '3d' && rendererType !== '3d' && requestedType === '3d'
}
