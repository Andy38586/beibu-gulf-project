<script setup lang="ts">
/**
 * MobileDrawer - 移动端业务面板抽屉
 *
 * 仅在 <768px（AppLayout 的 showPanels=false）渲染。
 * 复用 AppLayout 注入的 left/right slot 内容（图表 / 图层控制 / 分析结果），
 * 通过 style.css 中的全局规则把内部 GCSPanel 的内联绝对定位强制改为正常流布局。
 *
 * 可访问性：
 * - role="dialog" + aria-modal，Esc 关闭，点击遮罩关闭
 * - 图表 resize 由 useECharts 的 ResizeObserver 自动处理（抽屉展开即触发）
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
