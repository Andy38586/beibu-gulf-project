<!--
  分流分析页（W10-11）：四面板全 4×4 —— 左上转移量 BarChart（图 + 一行口径脚注合并为一面板，
  替代原文字清单）、左下桑基图（自右下迁入）、右上 年份滑块、右下 图层面板（LayerControlPanel）。
  数据经 diversionAdapter（schema 校验在 HTTP 边界）；年份本地状态（无跨页需求）。
-->
<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue'

import { AppLayout, GCSPanel, LayerControlPanel } from '@/core'
import { diversionAdapter, type DiversionResult } from '@/services'
import { logger, showError } from '@/shared'
import { BarChart, ChartLoading, SankeyChart } from '@/visualization'

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
const result = ref<DiversionResult | null>(null)
const loading = ref(false)

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
  } catch (e) {
    logger.error('[DiversionPage] load error:', e)
    showError(e, { fallback: '加载分流数据失败' })
  } finally {
    loading.value = false
  }
}

/** 年份滑块防抖 300ms（复刻预测页模式）：拖动过程连续触发只发末次请求 */
let debounceTimer: ReturnType<typeof setTimeout> | null = null
const DEBOUNCE_DELAY = 300

function onYearInput(e: Event): void {
  year.value = Number((e.target as HTMLInputElement).value)
  if (debounceTimer) clearTimeout(debounceTimer)
  debounceTimer = setTimeout(() => void load(), DEBOUNCE_DELAY)
}

onMounted(() => {
  void load()
})

onUnmounted(() => {
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
          />
          <div v-else-if="!loading" class="empty">暂无数据</div>
        </GCSPanel>
      </template>
      <template #right>
        <!-- 右上 4×4：年份控制（滑块 + 标签；300ms 防抖逻辑不动） -->
        <GCSPanel :w="4" :h="4" anchor="top-right" :offset-x="0" :offset-y="1.25">
          <div class="year-panel">
            <span class="year-label">年份 {{ year }}</span>
            <input
              type="range"
              :min="YEAR_MIN"
              :max="YEAR_MAX"
              :value="year"
              step="1"
              class="year-slider"
              @input="onYearInput"
            />
          </div>
        </GCSPanel>
        <!-- 右下 4×4：图层控制面板（本页无自有图层，按 LayerControlPanel 默认用法渲染） -->
        <GCSPanel :w="4" :h="4" anchor="top-right" :offset-x="0" :offset-y="5.5">
          <LayerControlPanel />
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

.year-panel {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px;
  height: 100%;
  box-sizing: border-box;
}

.year-label {
  font-size: 14px;
  font-weight: 600;
  color: var(--GCS-color-primary);
  white-space: nowrap;
}

.year-slider {
  flex: 1;
  height: var(--GCS-slider-thumb-size);
  appearance: none;
  background: linear-gradient(to right, var(--GCS-border-default), var(--GCS-color-primary));
  border-radius: calc(var(--GCS-slider-thumb-size) / 2);
  outline: none;
  cursor: pointer;
}

.year-slider::-webkit-slider-thumb {
  appearance: none;
  width: var(--GCS-slider-thumb-size);
  height: var(--GCS-slider-thumb-size);
  border-radius: 50%;
  background: var(--GCS-color-primary);
  cursor: pointer;
  border: 2px solid var(--GCS-bg-panel);
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
