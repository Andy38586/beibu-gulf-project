<script setup lang="ts">
/**
 * 通用图层控制面板：2 列网格按钮展示图层目录（layerCatalog），
 * 业务图层经 BusinessLayerManager（BLM，registry 为权威源）切换显隐，
 * 底图互斥单选（baseLayerKey 为权威源）；显示顺序由 props.layerOrder 注入。
 */

import { computed } from 'vue'

import { useBusinessLayers } from '@/core/map/composables/useBusinessLayers'
import { useGCS } from '@/shared'
import { useMapStore } from '@/stores'
import type { LayerEntry } from '@/types'

interface Props {
  /** 图层显示顺序（由业务页注入，core 不硬编码业务 key） */
  layerOrder?: string[]
}

const props = withDefaults(defineProps<Props>(), {
  // 默认仅核心常驻层顺序；业务图层未列出的追加到末尾（按 catalog 注册序）
  layerOrder: () => ['base-image', 'base-vector', 'boundary', 'ports'],
})

// layerCatalog 直连 mapStore，底图切换走 setBaseLayer
const mapStore = useMapStore()

/** 引擎徽标仅 DEV 构建/测试模式展示：后台能力标号不进生产 UI */
const isDev = import.meta.env.DEV
const layerCatalog = computed(() => mapStore.layerCatalog)
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
 * 图层按钮列表（按显示顺序）：业务条目以 BLM（业务图层管理器）registry 的
 * visible 为唯一权威源，catalog 仅作响应式触发器（引擎切换清空后由 reapplyAll
 * 按 registry 重建，杜绝双副本失步）；底图条目以 baseLayerKey 为权威源。
 */
const layerButtons = computed(() => {
  // 显示顺序由 props 注入
  const order = props.layerOrder
  const ordered = order
    .map((key) => layerCatalog.value.find((l: LayerEntry) => l.key === key))
    .filter((l): l is LayerEntry => l !== undefined)
  const orderedKeys = new Set(ordered.map((l: LayerEntry) => l.key))
  const extra = layerCatalog.value.filter((l: LayerEntry) => !orderedKeys.has(l.key))
  return [...ordered, ...extra].map((layer) => ({
    key: layer.key,
    label: layer.label,
    // z118：透传 layerType 供图标数据驱动（core 不解析业务 label 语义）
    layerType: layer.layerType,
    // 引擎适用标记：registry meta 优先，目录镜像兜底（缺省视为双引擎通用）
    engines:
      layer.engines ??
      businessLayerManager.getMeta(layer.key)?.engines ??
      (['openlayers', 'cesium'] as const),
    // 单变量原则：按钮状态即 registry.visible（BLM 唯一权威），蓝 = 图层在显示
    active: layer.layerType
      ? (businessLayerManager.getMeta(layer.key)?.visible ?? layer.visible)
      : mapStore.baseLayerKey === layer.key,
  }))
})

/**
 * 图层图标映射（z118：core 层不再"必须"理解业务 label 语义）。
 * 优先按 layerType 数据驱动——新图层注册时给对 layerType 即自动有图标；
 * label 业务关键词仅作历史兜底（存量图层），新增业务勿扩展此链。
 */
function getLayerIcon(label: string, layerType?: string): string {
  if (layerType === 'waterSurface') return ''
  if (layerType === 'geotiff') return '⛰'
  if (layerType === 'heatmap') return '📈'
  if (layerType === 'boundary') return ''
  // 历史兜底：按 label 业务关键词（存量图层的业务语义在此收口，不扩散）
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
  // 业务图层（有 layerType 字段）→ 走 Manager.setVisible
  const catalogEntry = layerCatalog.value.find((e: LayerEntry) => e.key === key)
  if (catalogEntry && catalogEntry.layerType) {
    // 单变量原则：读 registry 状态再取反，一次生效（不读实例状态避免错位）
    const registryVisible = businessLayerManager.getMeta(key)?.visible
    const currentVisible = registryVisible ?? catalogEntry.visible
    businessLayerManager.setVisible(key, !currentVisible)
    return
  }
  // 底图等 base 类条目（无 layerType）→ 走 setBaseLayer（互斥单选）
  mapStore.setBaseLayer(key)
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
        <span class="layer-icon">{{ getLayerIcon(item.label, item.layerType) }}</span>
        <span class="layer-label">{{ item.label }}</span>
        <!-- 引擎适用徽标：仅开发/测试模式展示（后台能力标号，不进生产 UI） -->
        <span v-if="isDev" class="layer-engines" :title="item.engines?.join(' / ')">
          {{ (item.engines ?? []).join('·') }}
        </span>
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

/* 图层按钮网格：GCS（网格化布局系统）规格 —— 面板边缘 0.1cell(padding)，按钮间 0.2cell(gap)，
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
  transition:
    background-color 0.2s ease,
    border-color 0.2s ease;
  padding: v-bind(cell8px) 4px;
  box-sizing: border-box;
}

/* 引擎适用徽标：8px 小字置于按钮底部（非默认引擎组合才具信息量） */
.layer-engines {
  font-size: 8px;
  line-height: 1;
  color: var(--GCS-text-muted);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 90%;
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
