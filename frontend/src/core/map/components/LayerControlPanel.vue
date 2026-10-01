<script setup lang="ts">
/**
 * 通用图层控制面板：2 列网格按钮展示图层目录（layerCatalog），
 * 业务图层经 BusinessLayerManager（BLM，registry 为权威源）切换显隐，
 * 底图互斥单选（baseLayerKey 为权威源）；显示顺序由 props.layerOrder 注入。
 */

import { computed } from 'vue'

import { resolveLayerPanelState } from '@/core/map/layerAdapters'
import { useBusinessLayers } from '@/core/map/composables/useBusinessLayers'
import { DEFAULT_LAYER_ORDER, ROW_HEIGHT_CELL, useGCS } from '@/shared'
import { useMapStore } from '@/stores'
import type { LayerEntry } from '@/types'
import { DEFAULT_ENGINES, ENGINE_LABELS } from '@/types'
import type { LayerType } from '@/types/core/layerManager'

/** 图层组规格：多个图层共用面板上的**一个**开关（层级可分、控制合一）。
 * 成员必须是有 layerType 的业务图层（base 类互斥单选不可入组）。 */
export interface LayerGroupSpec {
  key: string
  label: string
  memberKeys: string[]
}

interface Props {
  /** 图层显示顺序（由业务页注入，core 不硬编码业务 key） */
  layerOrder?: string[]
  /** 图层组（一钮控多层的合并行，渲染在单层行之后） */
  layerGroups?: LayerGroupSpec[]
  /** 从面板隐藏的 key（组内成员/自动管理层；隐藏≠删除，BLM 条目仍在） */
  excludeKeys?: string[]
}

const props = withDefaults(defineProps<Props>(), {
  // 默认仅核心常驻层顺序；业务图层未列出的追加到末尾（按 catalog 注册序）。
  // 顺序表来自 shared/constants/layers（唯一权威表）——原先这里手抄了 4 个字面量。
  layerOrder: () => [...DEFAULT_LAYER_ORDER],
  layerGroups: () => [],
  excludeKeys: () => [],
})

/**
 * 面板行数硬上限（用户 2026-09-30 规则：上限就是 8，不允许再多、不滚动）。
 * ⚠ 决策反转留痕：c043 时代的口径是「容量公式+滚动出口」，已按新规则废止——
 * 超限时本组件截断到 8 并在 DEV 下 console.error（红样见
 * LayerControlPanel.capacity.test.ts 的 12 条注入用例）。
 */
const PANEL_MAX_ROWS = 8

// layerCatalog 直连 mapStore，底图切换走 setBaseLayer
const mapStore = useMapStore()

/** 引擎徽标仅 DEV 构建/测试模式展示：后台能力标号不进生产 UI */
const isDev = import.meta.env.DEV
const layerCatalog = computed(() => mapStore.layerCatalog)
const { manager: businessLayerManager } = useBusinessLayers()
const { cellPixel, css } = useGCS()
// 解构出 CSS 变量供 v-bind() 使用（cell8px=0.1cell 面板边缘；cell16px=0.2cell 按钮间间隙）
const { cell8px, cell16px } = css

/** 按钮高度：网格行高，系数取自 panelGridCapacity 的 ROW_HEIGHT_CELL —— 容量公式与本网格
 *  必须共用同一份比例，否则「按公式算出的容量」与实际能放的行数各说各话。 */
const btnHeightCss = computed(() => `${cellPixel.value * ROW_HEIGHT_CELL}px`) // cell=80 时 64px
/** 字体大小：0.175cell = 14px（基准），0.1cell = 8px（小字） */
const labelFontSizeCss = computed(() => `${cellPixel.value * 0.175}px`) // 14px
const iconFontSizeCss = computed(() => `${cellPixel.value * 0.2}px`) // 16px

/**
 * 图层按钮列表（按显示顺序）：业务条目以 BLM（业务图层管理器）registry 的
 * visible 为唯一权威源，catalog 仅作响应式触发器（引擎切换清空后由 reapplyAll
 * 按 registry 重建，杜绝双副本失步）；底图条目以 baseLayerKey 为权威源。
 */
const excluded = computed(() => new Set(props.excludeKeys))
const groupMembers = computed(() => new Set(props.layerGroups.flatMap((g) => g.memberKeys)))

const layerButtons = computed(() => {
  // 显示顺序由 props 注入
  const order = props.layerOrder
  // listed=false 的条目（基础能力层，如地形山影）登记在目录里但不在面板呈现——
  // 过滤放在排序之前，否则未列出的 key 会占掉 layerOrder 里的位置留下空洞
  const presentable = layerCatalog.value.filter((l: LayerEntry) => l.listed !== false)
  const ordered = order
    .map((key) => presentable.find((l: LayerEntry) => l.key === key))
    .filter((l): l is LayerEntry => l !== undefined)
  const orderedKeys = new Set(ordered.map((l: LayerEntry) => l.key))
  const extra = presentable.filter(
    (l: LayerEntry) =>
      !orderedKeys.has(l.key) && !excluded.value.has(l.key) && !groupMembers.value.has(l.key)
  )
  return [...ordered, ...extra]
    .filter((l: LayerEntry) => !excluded.value.has(l.key) && !groupMembers.value.has(l.key))
    .map((layer) => {
      const engines =
        layer.engines ?? businessLayerManager.getMeta(layer.key)?.engines ?? DEFAULT_ENGINES
      // 单变量原则：按钮状态即 registry.visible（BLM 唯一权威），蓝 = 图层在显示
      const active = layer.layerType
        ? (businessLayerManager.getMeta(layer.key)?.visible ?? layer.visible)
        : mapStore.baseLayerKey === layer.key
      // 锁定层不可关：按钮置灰禁用（当前恒为「开」态）。呈现层也判一次，
      // 不依赖 BLM 的 setVisible 拒绝兜底——禁用态要提前告知用户，而非点了没反应
      const locked = layer.layerType
        ? (businessLayerManager.getMeta(layer.key)?.locked ?? layer.locked)
        : false
      return {
        key: layer.key,
        label: layer.label,
        // 透传 layerType 供图标数据驱动（core 不解析业务 label 语义）
        layerType: layer.layerType,
        // 引擎适用标记：registry meta 优先，目录镜像兜底；仅单引擎图层显示角标（双引擎保持干净）
        engines,
        active,
        locked,
        // 三态（a035）：单引擎特化图层遇另一引擎 ⇒ unsupported，按钮不可点亮
        //（原先只看 on/off，这类条目在 3D 下照样可点，点了什么也不会发生）
        // 四态（a029）：+ not-mounted —— 开关想显示但 BLM 重绘后没上屏（data 未就绪），标灰提示
        state: resolveLayerPanelState(
          engines,
          active,
          mapStore.currentEngineName,
          businessLayerManager.isNotMounted(layer.key)
        ),
      }
    })
})

/** 图层组行：任一成员可见即亮；点击对全部成员 setVisible(统一值)。
 * 成员里不支持当前引擎的跳过（单成员层同行逻辑），锁定成员跳过。 */
const groupButtons = computed(() => {
  return props.layerGroups.map((g) => {
    const members = g.memberKeys.map((k) => ({
      key: k,
      visible: businessLayerManager.getMeta(k)?.visible ?? false,
      unsupported:
        businessLayerManager.getMeta(k)?.engines?.includes(mapStore.currentEngineName as never) ===
        false,
      locked: businessLayerManager.getMeta(k)?.locked ?? false,
    }))
    const usable = members.filter((m) => !m.unsupported && !m.locked)
    const active = usable.some((m) => m.visible)
    return {
      key: g.key,
      label: g.label,
      memberKeys: usable.map((m) => m.key),
      active,
      // 全部成员不可用 ⇒ 组不可点（罕见：整组单引擎层遇另一引擎）
      disabled: usable.length === 0,
    }
  })
})

/** 面板最终行（单层行+组行），硬上限 8 截断 + DEV 报错（规则见 PANEL_MAX_ROWS 注） */
const panelRows = computed(() => {
  const singleRows = layerButtons.value.map((l) => ({
    kind: 'layer' as const,
    ...l,
  }))
  const groupRows = groupButtons.value.map((g) => ({
    kind: 'group' as const,
    key: g.key,
    label: g.label,
    active: g.active,
    locked: false,
    disabled: g.disabled,
    state: 'ok' as const,
    engines: [] as string[],
    layerType: undefined,
  }))
  const rows = [...singleRows, ...groupRows]
  if (rows.length > PANEL_MAX_ROWS && import.meta.env.DEV) {
    console.error(
      `[LayerControlPanel] 面板行数 ${rows.length} 超上限 ${PANEL_MAX_ROWS}——已截断。` +
        `归并图层组或减少注册（用户规则 2026-09-30：上限 8、不滚动）。溢出项：` +
        rows
          .slice(PANEL_MAX_ROWS)
          .map((r) => r.label)
          .join('、')
    )
  }
  return rows.slice(0, PANEL_MAX_ROWS)
})

function handleToggleGroup(key: string): void {
  const g = groupButtons.value.find((x) => x.key === key)
  if (!g || g.disabled) return
  const next = !g.active
  for (const mk of g.memberKeys) {
    if (businessLayerManager.getMeta(mk)?.locked) continue
    businessLayerManager.setVisible(mk, next)
  }
}

/**
 * 图层图标映射（core 层不再"必须"理解业务 label 语义）。
 * 优先按 layerType 数据驱动——新图层注册时给对 layerType 即自动有图标；
 * label 业务关键词仅作历史兜底（存量图层），新增业务勿扩展此链。
 * 形参收窄为 LayerType（曾放宽成 string）：LayerType 没有 boundary 成员，
 * 放宽后拼错的 layerType 编译通过、运行时静默无图标——收窄后 TS 对拼错即报错。
 */
function getLayerIcon(label: string, layerType?: LayerType): string {
  if (layerType === 'waterSurface') return ''
  if (layerType === 'geotiff') return '⛰'
  if (layerType === 'heatmap') return '📈'
  if (layerType === '3dtiles') return '🏗'
  if (layerType === 'imageOverlay') return '🛰'
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
    // 锁定层（基础能力，如地形山影）：按钮已禁用，此处再挡一道，防其它路径误调
    if (businessLayerManager.getMeta(key)?.locked) return
    // 引擎不适用（单引擎特化层遇另一引擎）：按钮已禁用，此处再挡一道——
    // BLM.setVisible 不做引擎判定，误调会让它在不适用的引擎上尝试创建
    if (layerButtons.value.find((i) => i.key === key)?.state === 'unsupported') return
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
    <div class="layer-grid" data-overflow-exit="scroll">
      <template v-for="item in panelRows" :key="item.key">
        <button
          v-if="item.kind === 'layer'"
          class="layer-btn"
          :class="{
            active: item.active,
            locked: item.locked,
            unsupported: item.state === 'unsupported',
            'not-mounted': item.state === 'not-mounted',
          }"
          :disabled="item.locked || item.state === 'unsupported'"
          :title="
            item.locked
              ? `${item.label}（随底图默认加载，不可关闭）`
              : item.state === 'unsupported'
                ? `${item.label}（当前引擎不支持该图层）`
                : item.state === 'not-mounted'
                  ? `${item.label}（数据未就绪，图层暂未显示；数据到达后自动显示）`
                  : undefined
          "
          @click="handleToggle(item.key)"
        >
          <span class="layer-icon">{{ getLayerIcon(item.label, item.layerType) }}</span>
          <span class="layer-label">{{ item.label }}</span>
          <!-- 引擎角标：仅 DEV+调试模式、且为单引擎特化图层时显示（双引擎保持干净） -->
          <span
            v-if="isDev && mapStore.debugMode && item.engines && item.engines.length === 1"
            class="engine-corner"
            :title="item.engines.join(' / ')"
          >
            {{ ENGINE_LABELS[item.engines[0]] }}
          </span>
        </button>
        <button
          v-else
          class="layer-btn"
          :class="{ active: item.active }"
          :disabled="item.disabled"
          :title="`${item.label}（一钮控制组内全部图层）`"
          @click="handleToggleGroup(item.key)"
        >
          <span class="layer-icon">🏗</span>
          <span class="layer-label">{{ item.label }}</span>
        </button>
      </template>
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
   按钮 1.8×0.8cell 占满网格单元：4×4 面板 2列×4行 = 8 条。容量不在组件里钉常数——
   按 `panelGridCapacity` 公式算（见 shared/layout/panelCapacity.ts），因为目录条目是
   **运行期派生**的（首屏 12 项、航线页 14 项），钉 8/13/14 都会随目录变化失效。
   超出容量时条目不再被 GCSPanel 的 overflow:hidden 静默裁掉：本容器自带滚动出口
   （`overflow-y:auto` + `data-overflow-exit="scroll"`），判据见 LayerControlPanel.capacity.test.ts。
   列用 1.8fr 均分（1.8fr×2 + gap 0.2cell = 内容宽 3.8cell，精确等于 1.8cell/按钮）；
   行高固定 0.8cell，不足容量时从顶部排、底部留白（边缘 0.1cell 仍保持）。 */
.layer-grid {
  display: grid;
  grid-template-columns: repeat(2, 1.8fr);
  grid-auto-rows: v-bind(btnHeightCss);
  gap: v-bind(cell16px);
  height: 100%;
  align-content: start;
  overflow-y: auto;
}

.layer-btn {
  position: relative; /* 引擎角标锚点 */
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

/* 引擎角标：单引擎特化图层的右上角标（DEV+调试模式可见） */
.engine-corner {
  position: absolute;
  top: 2px;
  right: 4px;
  font-size: 8px;
  line-height: 1.1;
  color: var(--GCS-text-muted);
  background: var(--GCS-bg-container);
  border-radius: var(--GCS-radius-sm);
  padding: 0 3px;
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

/* 锁定层（随底图默认加载的基础能力）：保持 active 配色但不可交互，
   用默认光标与降饱和告知"这不是可操作按钮"，避免用户反复点击 */
.layer-btn.locked {
  cursor: default;
  opacity: 0.85;
}

/* 当前引擎不支持的图层（单引擎特化层遇另一引擎）：比 locked 更弱，
   明确"不可用"而非"不可关"（点了不做任何事，故不允许 hover 高亮） */
.layer-btn.unsupported {
  cursor: not-allowed;
  opacity: 0.45;
}

.layer-btn.unsupported:hover {
  border-color: var(--GCS-border-default);
  background: transparent;
}

/* 想显示但没上屏（a029：data 未就绪）：虚框 + 降饱和，与 locked/unsupported 区分开。
   放在 .active 之后——它要盖掉"开关亮着"的蓝底，否则标灰等于没标；
   仍保持可点（点一次是"关掉它"，数据到位后会自动变蓝），故不用 not-allowed。 */
.layer-btn.not-mounted {
  background: transparent;
  color: var(--GCS-text-muted);
  border-style: dashed;
}

.layer-btn.not-mounted:hover {
  border-color: var(--GCS-color-primary);
  background: var(--GCS-bg-hover);
}

.layer-btn.locked:hover {
  border-color: var(--GCS-color-primary);
  background: var(--GCS-color-primary);
}

.layer-icon {
  font-size: v-bind(iconFontSizeCss);
  line-height: 1;
}

.layer-label {
  font-weight: 500;
  line-height: 1.2;
  letter-spacing: -0.5px; /* 字距收紧 */
  text-align: center;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 100%;
}
</style>
