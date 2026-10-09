/**
 * 呼吸动效的**引擎无关脉动参数**。
 *
 * ## 为什么单独收敛到这一处
 *
 * 这套公式此前在两个渲染器里**逐行复制了 6 处**（OL 的 `startBreathing` /
 * `startFacilityBreathing` + Cesium 的同一对，各含尺寸与亮度两式）。后果不是"看着不雅"，
 * 而是：**改一次脉动曲线要同步 6 处，漏一处就会出现「同一个界面两种呼吸节奏」** ——
 * 而那种错只有在两条链路同屏时才看得见。
 *
 * 收敛口径与 `core/config/map.ts` 的 `zoomToHeight` 一致：**引擎无关的参数推导放这里，
 * 引擎相关的绘制留在各自渲染器**（OL 画 `Circle`+`Style`，Cesium 用 `point`+
 * `CallbackProperty`，二者只负责把这里的数值塞进自己的 API）。
 *
 * ## 尺寸的语义
 *
 * 同为像素口径：OL 用作 `Circle.radius`，Cesium 用作 `point.pixelSize`。
 * 名字取中性 `breathingSize` 而不是 `radius`/`pixelSize` —— 那两个名字都是引擎侧的。
 */

/** 呼吸周期（秒）。两条链路共用，保证同屏时相位一致 */
const BREATHING_PERIOD_SEC = 1

/** 尺寸脉动：基准 10 ± 5（px） */
export function breathingSize(elapsedSec: number): number {
  return 10 + Math.sin((elapsedSec / BREATHING_PERIOD_SEC) * Math.PI * 2) * 5
}

/** 亮度脉动：alpha 0.5 ± 0.3（下限 0.2、上限 0.8，两端都不透明/不消失） */
export function breathingAlpha(elapsedSec: number): number {
  return 0.5 + Math.sin((elapsedSec / BREATHING_PERIOD_SEC) * Math.PI * 2) * 0.3
}

/** 从起算时刻到现在的秒数（两条链路的 `startTime` 都用 `Date.now()`） */
export function elapsedSeconds(startTime: number, now: number = Date.now()): number {
  return (now - startTime) / 1000
}
