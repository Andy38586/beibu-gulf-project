/**
 * taskIndicator — 任务状态向 core 层的注入机制（v4-S6）
 *
 * ## 为什么需要它
 *
 * 进度环长在 `NavButton`（core/layout）上，而任务状态住在 `taskStore`（stores 层，
 * 且业务域语义）。core 不能 import stores（铁律 L3），否则分层塌陷、core 被绑死
 * 在具体业务状态上。
 *
 * 解法与 `navConfig` 同款：**由根入口（App.vue）注入一个只读取值函数**，
 * core 侧只认函数签名、不认数据来源。
 *
 * ## 契约为什么只用「纯函数 + 手动触发」
 *
 * core 侧不订阅响应式对象（那会把 Pinia 实例拖进 core 的类型面），
 * 而是由注入方在数据变化时调用 `notify()`。core 内部持有一个 `version` 计数，
 * 消费方 `watch(version)` 即可重算 —— 依赖方向仍然是 core←App，不倒置。
 */

import type { TaskStatus } from '@/types/task'

import { createInjectedRouteState } from './injectedRouteState'

/** 导航指示状态：某路由当前是否有任务、什么状态、进度多少 */
export interface TaskIndicatorState {
  /** 是否有活跃任务（pending/running/retrying） */
  active: boolean
  /** 是否有任何任务（含终态，用于显示结果待查看标记） */
  occupied: boolean
  status: TaskStatus | null
  /** 进度 0~1（阶段式：0 / 0.1 / 1） */
  progress: number
}

/** 默认空态（未注入 / 该路由无任务时的唯一真相） */
export const EMPTY_TASK_INDICATOR: TaskIndicatorState = Object.freeze({
  active: false,
  occupied: false,
  status: null,
  progress: 0,
})

const source = createInjectedRouteState<TaskIndicatorState>(EMPTY_TASK_INDICATOR)

/** core 侧消费：读取版本号（watch 它触发重算） */
export const taskIndicatorVersion = source.version

/** core 侧消费：按路由取指示态 */
export const getTaskIndicator = source.get

/**
 * 根入口注入（App.vue setup 内一次性调用）。
 * `notify` 需在任务状态变化时调用——App.vue 侧 watch taskStore 驱动。
 */
export const registerTaskIndicator = source.register

/** 注入方通知数据已变（触发 core 侧重算） */
export const notifyTaskIndicator = source.notify
