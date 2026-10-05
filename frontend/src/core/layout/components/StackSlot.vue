<script setup lang="ts">
/**
 * StackSlot — 可视化面板的堆叠固定槽位（v4-S9 系统 D，总纲 §八）。
 *
 * ## 形态（iOS Stack，口径 #10：固定槽位，不做任意目标叠加）
 *
 * - 空：仅在**拖拽期**显形虚线命中框（"叠到这里"），常态零占位（L1：不加可见布局）。
 * - 堆叠态：只露卡头（标题条按堆叠层级负偏移叠放），点击卡头展开成完整列表。
 * - 展开态：全部卡头平铺 + 每项「还原」按钮（面板放回页面原锚位）。
 *
 * ## 落点
 *
 * 根元素带 `data-stack-slot-zone`（usePanelDrag 的第二落点属性）——可视化面板
 * 拖到这里 = 叠入；主控制面板误拖到此，页面侧按属性分流后忽略（面板回滚原位）。
 * 命中判定走 usePanelDrag 的几何矩形扫描（与 dock 投递区同一条路径）。
 */
import { computed, ref } from 'vue'

import { IR_FALLBACK_COLOR, STACK_SLOT_ZONE_ATTR, useGlobalPanelDragActive } from '@/shared'

interface StackSlotItem {
  id: string
  label: string
  color?: string
}

const props = withDefaults(
  defineProps<{
    items: StackSlotItem[]
    /** 覆盖全局拖拽态（测试/页面控制用；缺省读全局单例） */
    dragActive?: boolean
  }>(),
  { dragActive: undefined }
)

const emit = defineEmits<{
  (e: 'restore', id: string): void
}>()

const globalDragActive = useGlobalPanelDragActive()
const expanded = ref(false)

/** 有内容或拖拽期才渲染（空态零占位；拖拽期空槽显形为命中目标） */
const visible = computed(
  () => props.items.length > 0 || (props.dragActive ?? globalDragActive.value)
)
</script>

<template>
  <div
    v-if="visible"
    :class="$attrs.class"
    class="stack-slot"
    v-bind="{ [STACK_SLOT_ZONE_ATTR]: 'stack' }"
  >
    <div v-if="items.length === 0" class="stack-empty-hint">叠到这里</div>
    <template v-else>
      <div class="stack-head-row">
        <button type="button" class="stack-expand-btn" @click="expanded = !expanded">
          堆叠（{{ items.length }}）
        </button>
      </div>
      <div v-show="expanded" class="stack-list">
        <div
          v-for="item in items"
          :key="item.id"
          class="stack-card"
          :style="{ '--stack-color': item.color ?? IR_FALLBACK_COLOR }"
        >
          <span class="stack-card-label">{{ item.label }}</span>
          <button
            type="button"
            class="stack-restore-btn"
            title="还原到页面原位"
            @click="emit('restore', item.id)"
          >
            还原
          </button>
        </div>
      </div>
    </template>
  </div>
</template>

<style scoped>
.stack-slot {
  position: absolute;
  top: 96px;
  right: 12px;
  width: 220px;
  z-index: var(--GCS-z-nav);
  display: flex;
  flex-direction: column;
  gap: 6px;
  pointer-events: auto;
}

.stack-empty-hint {
  padding: 14px 10px;
  border: 1px dashed var(--GCS-color-primary);
  border-radius: 8px;
  text-align: center;
  font-size: 12px;
  color: var(--GCS-text-secondary);
  background: var(--GCS-bg-panel-translucent);
}

.stack-head-row {
  display: flex;
  justify-content: flex-end;
}

.stack-expand-btn {
  padding: 4px 10px;
  border: 1px solid var(--GCS-border-default);
  border-radius: 8px;
  background: var(--GCS-bg-panel-translucent);
  font-size: 12px;
  cursor: pointer;
}

/* 堆叠感：卡头负外边距层叠（只露每张卡的上沿），展开态取消 */
.stack-card {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 6px 10px;
  border: 1px solid var(--stack-color);
  border-left: 4px solid var(--stack-color);
  border-radius: 6px;
  background: var(--GCS-bg-panel-translucent);
  font-size: 12px;
}

.stack-card + .stack-card {
  margin-top: -1px;
}

.stack-card-label {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.stack-restore-btn {
  flex: none;
  padding: 2px 8px;
  border: 1px solid var(--GCS-border-default);
  border-radius: 4px;
  background: transparent;
  font-size: 11px;
  cursor: pointer;
}
</style>
