<script lang="ts">
export default { name: 'GCSNavButton' }
</script>
<script setup lang="ts">
/**
 * NavButton - 1×1 导航按钮
 * 职责：
 * 1. 作为底部导航条或顶部功能区的最小导航单元
 * 2. 默认占 1×1 Panel，文字在上，图标在下
 * 3. 支持 normal / active / disabled 三种状态
 * 设计说明：
 * - 本组件复用 GCSButton 的视觉与交互逻辑，仅固定尺寸为 1×1
 * - 避免与 GCSButton 重复实现样式，保持平台按钮风格统一
 * Props:
 * - label: 按钮文字
 * - icon: 图标字符（可选）
 * - disabled: 是否禁用
 * - active: 是否处于激活/选中态
 */

import GCSButton from './GCSButton.vue'

interface Props {
  label?: string
  icon?: string
  disabled?: boolean
  active?: boolean
}
withDefaults(defineProps<Props>(), {
  label: '',
  icon: '',
  disabled: false,
  active: false,
})

defineEmits<{ click: [] }>()
</script>

<template>
  <GCSButton
    :w="0.8"
    :h="0.8"
    :label="label"
    :icon="icon"
    :disabled="disabled"
    :active="active"
    @click="$emit('click')"
  />
</template>
