/**
 * 通用 UI 交互共享常量（单一事实源）
 * CONFIRM_DELAY 由预测控制面板与选址控制面板共用（原两处各自 const 3000 重复），
 * 上提 shared 消除重复定义。
 */

/** 操作确认按钮自动确认延迟（毫秒） */
export const CONFIRM_DELAY = 3000
