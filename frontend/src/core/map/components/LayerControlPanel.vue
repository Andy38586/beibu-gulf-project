<script setup lang="ts">
/**
 * LayerControlPanel - 通用图层控制面板（公共组件）
 *
 * 职责：
 * 1. 显示图层按钮（2列网格布局）
 * 2. 接入真实图层管理（useLayerManager）
 * 3. 底图互斥（影像/矢量只能选一个）
 * 4. 业务图层无互斥（可多选）
 *
 * 被引用：首页、选址分析、浸没分析
 *
 * c024：图层显示顺序由 props.layerOrder 注入，core 不再硬编码业务图层 key。
 * 默认仅含核心常驻层顺序，业务页通过 :layer-order 传入业务图层排序。
 */

import { computed } from 'vue'

import { useBusinessLayers } from '@/core/map/composables/useBusinessLayers'
import { useLayerManager } from '@/core/map/composables/useLayerManager'
import { useGCS } from '@/shared'
import type { LayerEntry } from '@/types'

interface Props {
  /** 图层显示顺序（c024：由业务页注入，core 不再硬编码业务 key） */
  layerOrder?: string[]
}

const props = withDefaults(defineProps<Props>(), {
  // 默认仅核心常驻层顺序；业务图层未列出的追加到末尾（按 catalog 注册序）
  layerOrder: () => ['base-image', 'base-vector', 'boundary', 'ports'],
})

const { layerCatalog, toggleLayer } = useLayerManager()
const { manager: businessLayerManager } = useBusinessLayers()
const { cellPixel, css } = useGCS()
// 解构出 CSS 变量供 v-bind() 使用（cell8px=0.1cell 面板边缘；cell16px=0.2cell 按钮间间隙）
const { cell8px, cell16px } = css

/** 按钮高度：0.8 cell（网格行高，按钮 width 100% 填充列） */
const btnHeightCss = computed(() => `${cellPixel.value * 0.8}px`) // 64px
/** 字体大小：0.175cell = 14px（基准），0.1cell = 8px（小字） */
const labelFontSizeCss = computed(() => `${cellPixel.value * 0.175}px`) // 14px
const iconFontSizeCss = computed(() => `${cellPixel.value * 0.2}px`) // 16px

/**
 * 图层按钮列表（按显示顺序）
 *
 * @arch-note a030 (D-11=A): business 类条目（layerType 非空）的可见性以
 * BusinessLayerManager._registry 为唯一权威源，catalog 仅作 reactivity 触发器。
 * 切换引擎时 clearLayerCatalog 清空 catalog，reapplyAll 重建条目时 visible
 * 从 registry 读取，杜绝双副本失步。base 类条目无 registry 副本，仍读 catalog。
 */
const layerButtons = computed(() => {
  // c024: order 由 props 注入，core 不再硬编码业务图层 key
  const order = props.layerOrder
  const ordered = order
    .map((key) => layerCatalog.value.find((l: LayerEntry) => l.key === key))
    .filter((l): l is LayerEntry => l !== undefined)
  const orderedKeys = new Set(ordered.map((l: LayerEntry) => l.key))
  const extra = layerCatalog.value.filter((l: LayerEntry) => !orderedKeys.has(l.key))
  return [...ordered, ...extra].map((layer) => ({
    key: layer.key,
    label: layer.label,
    // a030: business 类条目读 registry 权威源；base 类读 catalog
    active: layer.layerType
      ? (businessLayerManager.getMeta(layer.key)?.visible ?? layer.visible)
      : layer.visible,
  }))
})

/** 图层图标映射 */
function getLayerIcon(label: string): string {
  if (label.includes('底图') || label.includes('影像') || label.includes('矢量')) return '🗺'
  if (label.includes('港口')) return ''
  if (label.includes('行政')) return ''
  if (label.includes('覆盖') || label.includes('缓冲')) return '◎'
  if (label.includes('匹配') || label.includes('结果')) return '◈'
  if (label.includes('水面')) return ''
  if (label.includes('淹没')) return '🌊'
  if (label.includes('设施')) return '🏭'
  if (label.includes('地形')) return '⛰'
  if (
    label.includes('预测') ||
    label.includes('吞吐') ||
    label.includes('泊位') ||
    label.includes('流量') ||
    label.includes('压力')
  )
    return '📈'
  return ''
}

/** 点击图层按钮 */
function handleToggle(key: string) {
  // 业务图层（有 layerType 字段，无 show/hide 回调）→ 走 Manager.setVisible
  const catalogEntry = layerCatalog.value.find((e: LayerEntry) => e.key === key)
  if (catalogEntry && catalogEntry.layerType) {
    // a030: 可见性以 registry 为权威源（catalog 可能与 registry 失步），
    // 从 registry 读当前值再取反，避免 catalog 滞后导致 toggle 方向错误
    const registryVisible = businessLayerManager.getMeta(key)?.visible
    const currentVisible = registryVisible ?? catalogEntry.visible
    businessLayerManager.setVisible(key, !currentVisible)
    return
  }
  // 底图等旧机制图层 → 走原来的 toggleLayer
  toggleLayer(key)
}
</script>

<template>
  <div class="layer-panel">
    <div class="layer-grid">
      <button
        v-for="item in layerButtons"
        :key="item.key"
        class="layer-btn"
        :class="{ active: item.active }"
        @click="handleToggle(item.key)"
      >
        <span class="layer-icon">{{ getLayerIcon(item.label) }}</span>
        <span class="layer-label">{{ item.label }}</span>
      </button>
    </div>
  </div>
</template>

<style scoped>
.layer-panel {
  width: 100%;
  height: 100%;
  padding: v-bind(cell8px);
  box-sizing: border-box;
}

/* 图层按钮网格：GCS 规格 —— 面板边缘 0.1cell(padding)，按钮间 0.2cell(gap)，
   按钮 1.8×0.8cell 占满网格单元：4×4 面板内 2列×4行共 8 按钮正好填满。
   列用 1.8fr 均分（1.8fr×2 + gap 0.2cell = 内容宽 3.8cell，精确等于 1.8cell/按钮）；
   行高固定 0.8cell，不足 8 个按钮时从顶部排、底部留白（边缘 0.1cell 仍保持）。 */
.layer-grid {
  display: grid;
  grid-template-columns: repeat(2, 1.8fr);
  grid-auto-rows: v-bind(btnHeightCss);
  gap: v-bind(cell16px);
  height: 100%;
  align-content: start;
}

.layer-btn {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: v-bind(cell8px);
  width: 100%;
  height: 100%;
  border: 1px solid var(--GCS-border-default);
  border-radius: var(--GCS-radius-lg);
  background: var(--GCS-bg-panel);
  color: var(--GCS-text-regular);
  cursor: pointer;
  font-size: v-bind(labelFontSizeCss);
  transition: all 0.2s ease;
  padding: v-bind(cell8px) 4px;
  box-sizing: border-box;
}

.layer-btn:hover {
  border-color: var(--GCS-color-primary);
  background: var(--GCS-bg-hover);
}

.layer-btn.active {
  background: var(--GCS-color-primary);
  color: var(--GCS-text-inverse);
  border-color: var(--GCS-color-primary);
}

.layer-icon {
  font-size: v-bind(iconFontSizeCss);
  line-height: 1;
}

.layer-label {
  font-weight: 500;
  line-height: 1.2;
  text-align: center;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 100%;
}
</style>
