/**
 * usePanelDrag — 面板拖拽（Pointer Events，非 HTML5 DnD）
 *
 * 用途：把「主控制面板」拖到底部 dock，表示「丢到后台继续跑」。
 * 拖拽期间面板脱离 PPS（面板定位系统）绝对定位，改用 transform 跟随指针；
 * 落点命中 dock 投递区（`[data-task-dock-zone]`）才触发提交，否则回滚原位。
 *
 * 设计取舍：
 * - **4px 阈值**：低于阈值视为点击，避免「想点按钮却把面板拖走」。
 * - **transform 而非 left/top**：拖拽期不触发布局重排，且原 PPS 定位值不丢，
 *   回滚只需清 transform。
 * - **几何矩形落点判定**：不用 `elementFromPoint` —— 投递区常态 `pointer-events:none`，
 *   而命中测试会**忽略**这类元素 ⇒ 拖拽期永远命不中（详见 `findDropZone` 注释）。
 *   改为取 `getBoundingClientRect()` 做点包含测试。
 * - **setPointerCapture**：指针移出窗口仍收得到 pointermove/pointerup，不丢事件。
 *
 * 该 composable 不依赖任何业务模块（L3：core/shared 不得 import business）。
 */

import { onUnmounted, readonly, ref } from 'vue'

/** 拖拽状态机 */
export type PanelDragPhase = 'idle' | 'pending' | 'dragging'

/** 落点判定：命中该属性的元素即视为投递区 */
export const TASK_DOCK_ZONE_ATTR = 'data-task-dock-zone'

/** 触发拖拽的最小位移（px）。低于此值视为点击，防误触 */
export const DRAG_THRESHOLD_PX = 4

/**
 * 全局拖拽态（模块级单例）。
 *
 * 🔴 为什么需要它：dock 投递区在空态下不渲染（布局铁律），
 *    于是 `elementFromPoint` 反查不到 zone ⇒ **第一次拖拽永远落空**。
 *    需要有人告诉 App 层"现在有人在拖"，好让投递区显形。
 *
 * 用模块级单例而非 Pinia：拖拽是纯 UI 瞬时态、不跨路由、不需持久化，
 * 且 `usePanelDrag` 位于 shared 层、不应依赖 stores（L3）。
 */
const globalDragActive = ref(false)

/**
 * 拖拽中的 composable 实例计数。
 * 理论上同一刻只有一个面板被拖（指针只有一个），用计数是为了
 * 容错"异常卸载未清理"的情况 —— 计数归零才认为拖拽结束。
 */
let activeDragCount = 0

function setGlobalDragActive(active: boolean): void {
  activeDragCount = Math.max(0, activeDragCount + (active ? 1 : -1))
  globalDragActive.value = activeDragCount > 0
}

/** 是否有任意面板正在拖拽（只读） */
export function useGlobalPanelDragActive() {
  return readonly(globalDragActive)
}

export interface UsePanelDragOptions {
  /** 拖拽开始时回调（用于挂 dragging class / 暂停内部动画等） */
  onDragStart?: () => void
  /** 拖拽结束（无论投递成功与否）回调 */
  onDragEnd?: () => void
  /** 命中投递区时回调，参数为命中的投递区元素 */
  onDrop?: (zone: HTMLElement) => void
  /** 投递失败（未命中 / 取消）时回调，用于显示回滚提示 */
  onCancel?: () => void
  /** 指针按下即判定为「不拖拽」的区域选择器（如输入框、按钮） */
  ignoreSelector?: string
  /** 是否启用（默认 true）；false 时 pointerdown 直接放行，行为与普通面板一致 */
  enabled?: () => boolean
}

export interface UsePanelDragReturn {
  /** 当前拖拽阶段（只读） */
  phase: Readonly<ReturnType<typeof ref<PanelDragPhase>>>
  /** 拖拽位移（px），供宿主绑定 transform */
  offsetX: ReturnType<typeof ref<number>>
  offsetY: ReturnType<typeof ref<number>>
  /** 指针是否正悬停在投递区上方（用于投递区高亮） */
  overZone: ReturnType<typeof ref<boolean>>
  /** 绑定到拖拽手柄的 pointerdown */
  onPointerDown: (e: PointerEvent) => void
  /** 手动中止拖拽（回滚） */
  abort: () => void
}

/**
 * 从指针坐标反查命中的投递区元素。
 *
 * ## 🔴 为什么不用 `elementFromPoint`（2026-09-19 实测重写）
 *
 * 旧实现是 `document.elementFromPoint(x, y)?.closest('[data-task-dock-zone]')`，
 * 它有一个**结构性死锁**，导致"拖到底部完全无响应"：
 *
 * - 投递区必须在非拖拽期 `pointer-events: none`，否则它会成为一整条
 *   拦截带，挡住底部导航条与地图的指针交互（用户点不到导航按钮）。
 * - 而 `elementFromPoint` 按**规范定义**会忽略 `pointer-events: none` 的元素
 *   —— 它模拟的是"命中测试"，不参与命中测试的元素永不返回。
 * - ⇒ 投递区在自己唯一该被命中的时刻（拖拽期），恰恰对 `elementFromPoint` 隐形。
 *
 * 于是无论 z-index 调到多高都无效（曾误判为 z-index 冲突、手柄遮挡，
 * 均已排除）。正确做法是**不依赖命中测试**，改用几何矩形判定：
 * 遍历 DOM 里所有投递区，取 `getBoundingClientRect()` 做点包含测试。
 *
 * 代价：投递区数量通常为 1，遍历成本可忽略。
 *
 * ## 为什么仍保留 `elementFromPoint` 作为**兜底**
 *
 * 若将来出现多个投递区需要按层叠顺序取最上的那个，几何判定无法表达优先级。
 * 目前只有一个投递区，故以几何判定为主；一旦命中多个，仍用 elementFromPoint
 * 决定"最上面那个"，两条路径互补。
 */
function findDropZone(x: number, y: number): HTMLElement | null {
  if (typeof document === 'undefined') return null

  const zones = Array.from(document.querySelectorAll<HTMLElement>(`[${TASK_DOCK_ZONE_ATTR}]`))
  if (zones.length === 0) return null

  // 点包含测试：矩形内即命中（含边界，避免 1px 抖动丢命中）
  const contained = zones.filter((zone) => {
    const r = zone.getBoundingClientRect()
    // 尺寸为 0 的元素（未布局/被折叠）不参与判定，否则会误吞整个视口之外的点
    if (r.width === 0 || r.height === 0) return false
    return x >= r.left && x <= r.right && y >= r.top && y <= r.bottom
  })

  if (contained.length === 0) return null
  if (contained.length === 1) return contained[0]

  // 多投递区：用命中测试选最上层那个（此时投递区自身通常是 auto，能参与命中）
  const hit = document.elementFromPoint(x, y) as HTMLElement | null
  const topmost = hit?.closest(`[${TASK_DOCK_ZONE_ATTR}]`) as HTMLElement | null
  return topmost ?? contained[contained.length - 1]
}

export function usePanelDrag(options: UsePanelDragOptions = {}): UsePanelDragReturn {
  const { onDragStart, onDragEnd, onDrop, onCancel, ignoreSelector, enabled = () => true } = options

  const phase = ref<PanelDragPhase>('idle')
  const offsetX = ref(0)
  const offsetY = ref(0)
  const overZone = ref(false)

  // 起点与当前指针位置（非响应式：拖拽期高频写入，无需驱动渲染）
  let startX = 0
  let startY = 0
  let pointerId: number | null = null
  let target: HTMLElement | null = null

  /** 本实例是否已上报「全局拖拽中」（保证 setGlobalDragActive 成对调用） */
  let reportedGlobal = false

  function markGlobalDrag(active: boolean): void {
    if (active === reportedGlobal) return
    reportedGlobal = active
    setGlobalDragActive(active)
  }

  function reset(): void {
    // 兜底：任何路径的结束都要撤销全局拖拽标记，否则 dock 投递区会永久显形
    markGlobalDrag(false)
    phase.value = 'idle'
    offsetX.value = 0
    offsetY.value = 0
    overZone.value = false
    pointerId = null
    target = null
  }

  /** 释放指针捕获（幂等） */
  function releaseCapture(): void {
    if (target && pointerId !== null && target.hasPointerCapture?.(pointerId)) {
      target.releasePointerCapture(pointerId)
    }
  }

  function handleMove(e: PointerEvent): void {
    if (pointerId === null || e.pointerId !== pointerId) return

    const dx = e.clientX - startX
    const dy = e.clientY - startY

    // 阈值前：仍处待定态，未越过阈值不进入拖拽（防误触）
    if (phase.value === 'pending') {
      if (Math.hypot(dx, dy) < DRAG_THRESHOLD_PX) return
      phase.value = 'dragging'
      // 🔴 上报「全局拖拽中」⇒ dock 投递区显形。
      //    这是**首次**拖拽能成功的前提：dock 空态默认不渲染，
      //    投递区元素不存在则 elementFromPoint 永远命不中。
      //    ⚠️ 本帧的 overZone 可能还没命中（DOM 更新在 microtask 后），
      //    但 handleUp 发生在拖拽**末尾**、DOM 早已更新，故落点判定可靠。
      markGlobalDrag(true)
      onDragStart?.()
    }

    offsetX.value = dx
    offsetY.value = dy

    // 落点判定用**几何矩形**反查（见 findDropZone 注释）：
    // 被拖面板自身在指针下方也无妨 —— 几何判定不看命中测试，只看坐标是否落在投递区矩形内。
    overZone.value = findDropZone(e.clientX, e.clientY) !== null
  }

  function handleUp(e: PointerEvent): void {
    if (pointerId === null || e.pointerId !== pointerId) return

    const wasDragging = phase.value === 'dragging'
    const zone = wasDragging ? findDropZone(e.clientX, e.clientY) : null

    releaseCapture()

    if (wasDragging) {
      if (zone) {
        onDrop?.(zone)
      } else {
        onCancel?.()
      }
      onDragEnd?.()
    }

    reset()
  }

  /** 浏览器原生取消（如手势被系统接管）：无条件回滚 */
  function handleCancel(e: PointerEvent): void {
    if (pointerId === null || e.pointerId !== pointerId) return
    releaseCapture()
    if (phase.value === 'dragging') {
      onCancel?.()
      onDragEnd?.()
    }
    reset()
  }

  function onPointerDown(e: PointerEvent): void {
    // 仅左键 / 主指针；右键与中键放行
    if (e.button !== 0) return
    if (!enabled()) return
    if (phase.value !== 'idle') return

    // 忽略区（输入框、按钮、滚动区等）：不启动拖拽
    if (ignoreSelector) {
      const el = e.target as HTMLElement | null
      if (el && el.closest(ignoreSelector)) return
    }

    startX = e.clientX
    startY = e.clientY
    pointerId = e.pointerId
    target = e.currentTarget as HTMLElement | null
    phase.value = 'pending'

    // 捕获指针：移出窗口仍收得到 move/up，避免「拖着拖着事件没了」
    target?.setPointerCapture?.(e.pointerId)
  }

  function abort(): void {
    releaseCapture()
    if (phase.value === 'dragging') {
      onCancel?.()
      onDragEnd?.()
    }
    reset()
  }

  const stop = (): void => {
    window.removeEventListener('pointermove', handleMove)
    window.removeEventListener('pointerup', handleUp)
    window.removeEventListener('pointercancel', handleCancel)
    // 🔴 卸载时必须复位全局拖拽态：否则组件在拖拽中被销毁（如拖拽中切路由）
    //    会让计数永远 > 0 ⇒ dock 投递区永久显形、空态不再隐藏（破铁律 ②）。
    markGlobalDrag(false)
  }

  if (typeof window !== 'undefined') {
    // 监听挂 window：setPointerCapture 后事件仍会冒泡到 window，
    // 且组件内重渲染不影响监听（不依赖 DOM 结构）
    window.addEventListener('pointermove', handleMove)
    window.addEventListener('pointerup', handleUp)
    window.addEventListener('pointercancel', handleCancel)
  }

  onUnmounted(stop)

  return {
    phase: readonly(phase) as UsePanelDragReturn['phase'],
    offsetX,
    offsetY,
    overZone,
    onPointerDown,
    abort,
  }
}
