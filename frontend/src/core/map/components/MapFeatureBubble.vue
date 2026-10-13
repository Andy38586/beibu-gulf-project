<script setup lang="ts">
/**
 * MapFeatureBubble - 要素信息气泡（2D）
 * 聊天气泡形态：圆角矩形 + 底部三角尾针对准 POI（锚点定位由 OLRenderer 的 Overlay 负责）。
 * 悬浮模式：UnifiedMap 在 pointer-move 命中港口时驱动，移开即隐藏；
 * 点击钉住模式：随地图平移缩放跟随 POI，显示关闭按钮；同一时刻全图仅一个气泡。
 */
import type { Port } from '@/types'

interface Props {
  port: Port
  /** 钉住态（点击产生）：显示关闭按钮；悬浮态无 */
  pinned?: boolean
}

withDefaults(defineProps<Props>(), {
  pinned: false,
})

const emit = defineEmits<{
  (_e: 'close'): void
}>()

function handleClose(): void {
  emit('close')
}
</script>

<template>
  <div class="map-bubble map-feature-bubble">
    <div class="bubble-header">
      <span class="bubble-title">{{ port.name }}</span>
      <span v-if="port.type" class="bubble-type">{{ port.type }}</span>
      <button v-if="pinned" class="bubble-close" aria-label="关闭气泡" @click.stop="handleClose">
        ×
      </button>
    </div>
    <div class="bubble-row">
      <span class="bubble-label">地址</span>
      <span class="bubble-value">{{ port.address || '暂无' }}</span>
    </div>
    <div class="bubble-row">
      <span class="bubble-label">电话</span>
      <span class="bubble-value">{{ port.phone || '暂无' }}</span>
    </div>
    <div class="bubble-row">
      <span class="bubble-label">坐标</span>
      <span class="bubble-value">{{ port.lng.toFixed(4) }}, {{ port.lat.toFixed(4) }}</span>
    </div>
    <!-- 尾针：指向 POI（双层三角描边+填充，与气泡体同色） -->
    <div class="bubble-tail"></div>
  </div>
</template>

<style scoped src="./bubble.css"></style>
