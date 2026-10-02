/**
 * useSlowRequestOffer — 慢请求自动提议转后台（方案 A，2026-10-02 用户批准）。
 *
 * 定位：**只做触发器，不碰任务机制**。排队 / 重试 / 属主 / 分槽(I8) / 进度环全部沿用
 * taskStore 与后端既有实现；本 composable 只负责三件事：
 *   ① 给一次在途请求计时；② 超过阈值就问「要不要转后台」；③ 用户点主按钮时执行注入的 onAccept。
 *
 * 🔴 为什么 onAccept 是注入而不是在这里直接调 taskStore：
 *    · shared 层对 stores 零依赖（现状如此，分层不破）；
 *    · 「同一份参数」只有发起方拿得到 —— 提交的参数必须与**已经发出的那次**逐字相同，
 *      在这里重建一份就会长出第二个参数源（禁忌 7）。
 *
 * 🔴 提示形态的口径（实测 GCS 反馈层现状，非自选）：项目已用 GCS 单例替代
 *    ElMessage/ElMessageBox，而它只有两种形态 ——
 *      · showToast：非阻塞，但**没有按钮**（固定 3×0.5 cell 胶囊，3s 自动消失）；
 *      · showModal：有主按钮可一键，但带全屏遮罩（**会挡住地图**）。
 *    方案原文写的是「非阻塞提示 + 一键」。二者不可兼得 ⇒ 这里选 showModal 保住「一键」，
 *    偏差已记入交付说明的待裁项（要严格非阻塞需给 GCS 增第三种形态，属设计系统变更）。
 *
 * 🔴 常态不触发是**预期**：选址聚合后 ~1s、分流 ~0.1s（2026-10-02 实测）。
 *    本机制是冷启动 / 细分辨率 / 未来重活的兜底，不是主路径；因此它的用例必须含
 *    「慢必弹 + 快必不弹」两条对照，否则等于没测。
 */
import { getCurrentScope, onScopeDispose } from 'vue'

import { showModal } from '../utils/gcsFeedback'

/** 默认阈值（毫秒）。3s：短于它的等待不算「卡」，长于它的等待用户已经在干等 */
export const SLOW_REQUEST_THRESHOLD_MS = 3000

const DEFAULT_MESSAGE = '这次分析较慢，转到后台继续？'
const DEFAULT_CONFIRM_TEXT = '转到后台'

export interface SlowRequestOfferOptions {
  /** 用户点主按钮时执行（通常是「用同一份参数提交 task」）。抛错由调用方自己兜，本层不吞 */
  onAccept: () => void
  /** 阈值（毫秒），缺省 SLOW_REQUEST_THRESHOLD_MS */
  thresholdMs?: number
  message?: string
  confirmText?: string
}

export interface UseSlowRequestOfferReturn {
  /** 包住一次请求：返回原 promise；阈值内返回则零打扰，超阈值才弹提示 */
  track: <T>(run: () => Promise<T>) => Promise<T>
}

export function useSlowRequestOffer(options: SlowRequestOfferOptions): UseSlowRequestOfferReturn {
  const thresholdMs = options.thresholdMs ?? SLOW_REQUEST_THRESHOLD_MS
  let timer: ReturnType<typeof setTimeout> | null = null
  let settled = false

  function clearTimer(): void {
    if (timer !== null) {
      clearTimeout(timer)
      timer = null
    }
  }

  async function track<T>(run: () => Promise<T>): Promise<T> {
    clearTimer()
    settled = false
    timer = setTimeout(() => {
      timer = null
      // 请求在计时期间已返回 ⇒ 不该再问（用户已经拿到结果了）
      if (settled) return
      showModal({
        message: options.message ?? DEFAULT_MESSAGE,
        mode: 'confirm',
        confirmText: options.confirmText ?? DEFAULT_CONFIRM_TEXT,
        onConfirm: options.onAccept,
      })
    }, thresholdMs)

    try {
      return await run()
    } finally {
      settled = true
      clearTimer()
    }
  }

  // 作用域销毁即注销计时器（04-C：注册与注销同作用域）。无活动作用域时跳过，
  // 使本 composable 可在无组件上下文的用例里直接构造。
  if (getCurrentScope()) onScopeDispose(clearTimer)

  return { track }
}
