<script lang="ts">
export default { name: 'GCSNavButton' }
</script>
<script setup lang="ts">
/**
 * NavButton - 1×1 导航按钮
 * 底部导航条/顶部功能区的最小导航单元：文字在上、图标在下，支持
 * normal/active/disabled 三态；复用 GCSButton 视觉逻辑，仅固定尺寸。
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
