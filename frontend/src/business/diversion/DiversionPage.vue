<!--
  分流分析页（W10-11）：四面板全 4×4 —— 左上转移量 BarChart（图 + 一行口径脚注合并为一面板，
  替代原文字清单）、左下桑基图（自右下迁入）、右上 年份卡片（点击才展开滑块）、右下 图层面板
  （LayerControlPanel）。
  数据经 diversionAdapter（schema 校验在 HTTP 边界）；年份本地状态（无跨页需求）。
-->
<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue'

import { AppLayout, GCSPanel, LayerControlPanel } from '@/core'
import { diversionAdapter, mapDataService, type DiversionResult } from '@/services'
import { DEFAULT_LAYER_ORDER, PORT_PORTS, logger, showError, SliderSelectCard } from '@/shared'
import { diversionArcLayerId } from '@/shared'
import { BarChart, ChartLoading, SankeyChart, type SankeyClickPayload } from '@/visualization'

import { PORT_JSON_NAMES, resolvePortEndpoints, type LngLat } from './constants/diversionMap'
import {
  DIVERSION_CANAL_LAYER_ID,
  useDiversionLayer,
  type DiversionArcSpec,
} from './composables/useDiversionLayer'

/** 节点/连线形状（与 SankeyChart props 结构化兼容，本地声明免跨层类型导出） */
interface SankeyNode {
  name: string
}

interface SankeyLink {
  source: string
  target: string
  value: number
}

const YEAR_MIN = 2027
const YEAR_MAX = 2050
const year = ref(2035)
/** 年份卡片展开态：默认收起（无 range），点击卡片进入选择态才渲染滑块；点面板外回到已选态 */
const yearCardOpen = ref(false)
const yearPanelRef = ref<HTMLElement | null>(null)
const result = ref<DiversionResult | null>(null)
const loading = ref(false)

// ── 3D 弧线可视化（Cesium ③）──
const { updateCanalLayer, updateArcLayers } = useDiversionLayer()
/** 弧线起点 = 运河线位末点（示意线止于茅尾海）；几何一次加载，年份数据变化只重算弧值 */
let canalEnd: [number, number] | null = null
let canalLines: Array<Array<[number, number]>> = []
let portEndpoints: Record<string, LngLat> = {}
/** 桑基联动高亮（A3）：点三港节点/「平陆运河→某港」边 → 高亮对应弧；点「平陆运河」→ 高亮运河线 */
const highlightPortId = ref<string | null>(null)
const highlightCanal = ref(false)
/** 面板 layer-order/组开关：运河线单行，三弧收进「分流弧线」组行（一钮控多层） */
const ARC_LAYER_IDS = PORT_PORTS.map((p) => diversionArcLayerId(p.key))
const diversionLayerGroups = [
  { key: 'diversion-arcs', label: '分流弧线', memberKeys: ARC_LAYER_IDS },
]

/** 转移量图 x 轴：四个货类（顺序与 result.transfer 字段一致） */
const transferXData = ['煤炭', '粮食', '铁矿石', '砂石水泥']

/** 转移量图 series：唯一数据源是本页已加载的 result.transfer（不新增接口调用） */
const transferSeries = computed<Array<{ name: string; data: number[] }>>(() => {
  const t = result.value?.transfer
  return [{ name: '转移量（万吨/年）', data: t ? [t.coal, t.grain, t.ironOre, t.sandCement] : [] }]
})

const nodes = computed<SankeyNode[]>(() => {
  if (!result.value) return []
  const set = new Set<string>()
  for (const f of result.value.sankeyFlows) {
    set.add(f.from)
    set.add(f.to)
  }
  return [...set].map((name) => ({ name }))
})

const links = computed<SankeyLink[]>(() =>
  result.value
    ? result.value.sankeyFlows.map((f) => ({ source: f.from, target: f.to, value: f.value }))
    : []
)

async function load(): Promise<void> {
  loading.value = true
  try {
    result.value = await diversionAdapter.getBreakdown(year.value)
    refreshArcs()
  } catch (e) {
    logger.error('[DiversionPage] load error:', e)
    showError(e, { fallback: '加载分流数据失败' })
  } finally {
    loading.value = false
  }
}

/** 由当前 result 的桑基出边重建三弧（宽度=相对编码；端点/运河线为静态几何） */
function refreshArcs(): void {
  if (!canalEnd || !result.value) return
  const specs: DiversionArcSpec[] = []
  for (const flow of result.value.sankeyFlows) {
    if (flow.from !== '平陆运河') continue
    const entry = PORT_PORTS.find((p) => p.name === flow.to)
    const end = entry ? portEndpoints[entry.key] : undefined
    if (!entry || !end) continue
    specs.push({
      portId: entry.key,
      portName: flow.to,
      start: canalEnd,
      end: [end.lng, end.lat],
      value: flow.value,
    })
  }
  updateArcLayers(specs, highlightPortId.value)
}

/**
 * 桑基点击 → 3D 高亮（A3）：三港节点/「平陆运河→某港」边 = 高亮对应弧；
 * 「平陆运河」节点 = 高亮运河线；其余（西江上行货等）= 全灭。同者再点 = 取消。
 */
function handleSankeyClick(payload: SankeyClickPayload): void {
  const portKeyOf = (name: string): string | null =>
    PORT_PORTS.find((p) => p.name === name)?.key ?? null
  if (payload.kind === 'edge') {
    const key = payload.target ? portKeyOf(payload.target) : null
    highlightCanal.value = false
    highlightPortId.value = key && key !== highlightPortId.value ? key : null
  } else if (payload.name === '平陆运河') {
    highlightPortId.value = null
    highlightCanal.value = !highlightCanal.value
  } else {
    const key = portKeyOf(payload.name)
    highlightCanal.value = false
    highlightPortId.value = key && key !== highlightPortId.value ? key : null
  }
  updateCanalLayer(canalLines, highlightCanal.value)
  refreshArcs()
}

/** 几何底座一次加载：运河线位（canal 表）+ 港口端点（ports.json）；失败只降弧线不拦面板 */
async function loadGeometry(): Promise<void> {
  try {
    const [canal, ports] = await Promise.all([
      diversionAdapter.getCanalLine(),
      mapDataService.getPorts(),
    ])
    portEndpoints = resolvePortEndpoints(ports)
    const missing = PORT_PORTS.filter((p) => !(p.key in portEndpoints)).map(
      (p) => PORT_JSON_NAMES[p.key]
    )
    if (missing.length)
      logger.warn(`[DiversionPage] ports.json 缺条目，弧线跳过: ${missing.join('、')}`)
    const lines = canal.lines.map((l) => l.coordinates)
    canalLines = lines
    updateCanalLayer(lines, highlightCanal.value)
    const last = lines.length ? lines[lines.length - 1] : undefined
    canalEnd = last && last.length ? last[last.length - 1] : null
    if (!canalEnd) logger.warn('[DiversionPage] 运河线位为空，弧线跳过')
    refreshArcs()
  } catch (e) {
    logger.error('[DiversionPage] 运河几何加载失败（弧线层缺席，面板功能不受影响）:', e)
  }
}

/** 年份滑块防抖 300ms（复刻预测页模式）：拖动过程连续触发只发末次请求 */
let debounceTimer: ReturnType<typeof setTimeout> | null = null
const DEBOUNCE_DELAY = 300

/** 年份写入 + 300ms 防抖（滑块收进 SliderSelectCard 后由组件抽出 number，防抖语义不变） */
function onYearInput(value: number): void {
  year.value = value
  if (debounceTimer) clearTimeout(debounceTimer)
  debounceTimer = setTimeout(() => void load(), DEBOUNCE_DELAY)
}

/** 点年份面板外部回到已选态（卡片自身 click.stop，点卡片不会走到这里） */
function handleGlobalClick(e: MouseEvent): void {
  if (yearPanelRef.value && !yearPanelRef.value.contains(e.target as Node)) {
    yearCardOpen.value = false
  }
}

onMounted(() => {
  void load()
  void loadGeometry()
  document.addEventListener('click', handleGlobalClick)
})

onUnmounted(() => {
  document.removeEventListener('click', handleGlobalClick)
  if (debounceTimer) {
    clearTimeout(debounceTimer)
    debounceTimer = null
  }
})
</script>

<template>
  <div class="div-page">
    <AppLayout>
      <template #left>
        <!-- 左上 4×4：转移量可视化（BarChart）；原文字清单 + 数据口径说明合并为本面板图 + 一行脚注 -->
        <GCSPanel :w="4" :h="4" anchor="top-left" :offset-x="0" :offset-y="1.25">
          <div class="transfer-panel">
            <div class="transfer-chart">
              <BarChart
                :title="`西江→运河转移量（${year} 年）`"
                :x-data="transferXData"
                :series="transferSeries"
              />
            </div>
            <div class="transfer-note">
              数据口径：罗淳（2024）分货类锚点线性插值；砂石水泥不可转移（恒 0）。
            </div>
            <ChartLoading v-if="loading" />
          </div>
        </GCSPanel>
        <!-- 左下 4×4：桑基图（自原右下迁入，props 与空态语义不变） -->
        <GCSPanel :w="4" :h="4" anchor="top-left" :offset-x="0" :offset-y="5.5">
          <SankeyChart
            v-if="nodes.length"
            :nodes="nodes"
            :links="links"
            title="西江上行货 → 平陆运河 → 三港"
            @sankey-click="handleSankeyClick"
          />
          <div v-else-if="!loading" class="empty">暂无数据</div>
        </GCSPanel>
      </template>
      <template #right>
        <!-- 右上 4×4：年份控制（滑块收进统一卡片，点击才展开；300ms 防抖逻辑不动） -->
        <GCSPanel :w="4" :h="4" anchor="top-right" :offset-x="0" :offset-y="1.25">
          <div ref="yearPanelRef" class="year-panel">
            <!-- 三态选择卡片（公共组件 SliderSelectCard）：默认=按钮，点击进入选择态才渲染滑块 -->
            <SliderSelectCard
              :selecting="yearCardOpen"
              :selected="true"
              label="年份"
              :status-text="String(year)"
              :slider-value="yearCardOpen ? year : null"
              :slider-min="YEAR_MIN"
              :slider-max="YEAR_MAX"
              :slider-step="1"
              @toggle="yearCardOpen = true"
              @update:slider-value="onYearInput"
            />
          </div>
        </GCSPanel>
        <!-- 右下 4×4：图层控制面板（本页域图层 = 运河线位 + 三弧；三弧收进「分流弧线」组行） -->
        <GCSPanel :w="4" :h="4" anchor="top-right" :offset-x="0" :offset-y="5.5">
          <LayerControlPanel
            :layer-order="[...DEFAULT_LAYER_ORDER, DIVERSION_CANAL_LAYER_ID, ...ARC_LAYER_IDS]"
            :layer-groups="diversionLayerGroups"
          />
        </GCSPanel>
      </template>
    </AppLayout>
  </div>
</template>

<style scoped>
.div-page {
  width: 100%;
  height: 100%;
  pointer-events: none;
}

.div-page :deep(.GCS-panel) {
  pointer-events: auto;
}

.transfer-panel {
  position: relative;
  display: flex;
  flex-direction: column;
  height: 100%;
  box-sizing: border-box;
}

/* 图表占满面板剩余高度；脚注固定底部一行 */
.transfer-chart {
  flex: 1;
  min-height: 0;
}

.transfer-note {
  flex-shrink: 0;
  padding: 4px 8px 6px;
  font-size: 11px;
  line-height: 1.4;
  color: var(--GCS-text-muted);
}

/* 年份卡片填满 4×4 面板：滑块默认收进卡片，点击才展开 */
.year-panel {
  height: 100%;
  padding: 8px;
  box-sizing: border-box;
}

.empty {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 100%;
  color: var(--GCS-text-muted);
  font-size: 13px;
}
</style>
