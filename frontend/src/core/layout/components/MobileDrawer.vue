<script setup lang="ts">
/**
 * MobileDrawer - 业务面板侧滑抽屉（仅抽屉模式即窄屏渲染）
 * 复用 AppLayout 注入的 left/right slot（Vue 插槽）内容，内部 GCSPanel 的绝对定位
 * 由 style.css 全局规则强制改为正常流布局。role="dialog" + aria-modal，Esc/遮罩关闭。
 */
import { onUnmounted, watch } from 'vue'

interface Props {
  open: boolean
}
const props = defineProps<Props>()
const emit = defineEmits<{ close: [] }>()

function onKeydown(e: KeyboardEvent): void {
  if (e.key === 'Escape') emit('close')
}

watch(
  () => props.open,
  (open) => {
    if (open) document.addEventListener('keydown', onKeydown)
    else document.removeEventListener('keydown', onKeydown)
  }
)

onUnmounted(() => document.removeEventListener('keydown', onKeydown))
</script>

<template>
  <Teleport to="body">
    <Transition name="drawer">
      <div v-if="open" class="GCS-drawer" role="dialog" aria-modal="true" aria-label="业务面板">
        <div class="GCS-drawer__backdrop" @click="emit('close')"></div>
        <aside class="GCS-drawer__sheet">
          <header class="GCS-drawer__header">
            <span>业务面板</span>
            <button
              type="button"
              class="GCS-drawer__close"
              aria-label="关闭面板"
              @click="emit('close')"
            >
              ✕
            </button>
          </header>
          <div class="GCS-drawer__body">
            <slot />
          </div>
        </aside>
      </div>
    </Transition>
  </Teleport>
</template>
