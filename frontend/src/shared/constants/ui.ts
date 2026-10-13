/**
 * 通用 UI 交互共享常量。
 * 2026-10-13 修失实注释：原文称「确认延迟为**预测与选址**控制面板共用」，
 * 实测仅 `business/forecast/components/ForecastControlPanel.vue` **一个**消费者
 * （选址控制面板已不再消费）⇒ 原「共用」陈述不成立。
 * 不内联回组件：把 `3000` 直接写回去是魔法数回潮，具名常量本身仍有价值。
 */

/** 操作确认按钮自动确认延迟（毫秒） */
export const CONFIRM_DELAY = 3000
