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
  <div class="map-feature-bubble">
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

<style scoped>
.map-feature-bubble {
  position: relative;
  min-width: 170px;
  padding: 8px 10px;
  background: var(--GCS-bg-panel);
  border: 1px solid var(--GCS-border-default);
  border-radius: var(--GCS-radius-md);
  box-shadow: 0 2px 8px rgb(0 0 0 / 18%);
  box-sizing: border-box;
  font-size: var(--GCS-font-size-xs);
  color: var(--GCS-text-primary);
}

.bubble-header {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-bottom: 4px;
}

.bubble-title {
  font-weight: 600;
  color: var(--GCS-text-primary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.bubble-type {
  flex-shrink: 0;
  padding: 0 4px;
  background: var(--GCS-bg-hover);
  border-radius: var(--GCS-radius-sm);
  color: var(--GCS-text-secondary);
}

.bubble-close {
  flex-shrink: 0;
  margin-left: auto;
  padding: 0 2px;
  border: none;
  background: transparent;
  color: var(--GCS-text-secondary);
  font-size: var(--GCS-font-size-body);
  line-height: 1;
  cursor: pointer;
}

.bubble-close:hover {
  color: var(--GCS-text-primary);
}

.bubble-row {
  display: flex;
  gap: 6px;
  line-height: 1.6;
}

.bubble-label {
  flex-shrink: 0;
  color: var(--GCS-text-secondary);
}

.bubble-value {
  color: var(--GCS-text-primary);
  word-break: break-all;
}

.bubble-tail {
  position: absolute;
  bottom: -8px;
  left: 50%;
  transform: translateX(-50%);
  width: 0;
  height: 0;
  border-left: 8px solid transparent;
  border-right: 8px solid transparent;
  border-top: 9px solid var(--GCS-border-default);
}

.bubble-tail::after {
  content: '';
  position: absolute;
  left: -7px;
  top: -10px;
  width: 0;
  height: 0;
  border-left: 7px solid transparent;
  border-right: 7px solid transparent;
  border-top: 8px solid var(--GCS-bg-panel);
}
</style>
