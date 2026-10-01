<!--
  分流分析页（W10-11）：年份滑块 + 西江转移量分解卡 + 桑基图。
  数据经 diversionAdapter（schema 校验在 HTTP 边界）；年份本地状态（无跨页需求）。
-->
<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'

import { AppLayout, GCSPanel } from '@/core'
import { logger, showError } from '@/shared'
import { SankeyChart } from '@/visualization'
import { diversionAdapter, type DiversionResult } from '@/services'

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

function onYearInput(e: Event): void {
  year.value = Number((e.target as HTMLInputElement).value)
  void load()
}

const commodityRows = computed(() => {
  const t = result.value?.transfer
  if (!t) return []
  return [
    { label: '煤炭', value: t.coal },
    { label: '粮食', value: t.grain },
    { label: '铁矿石', value: t.ironOre },
    { label: '砂石水泥（不可转移）', value: t.sandCement },
  ]
})

onMounted(() => {
  void load()
})
</script>

<template>
  <div class="div-page">
    <AppLayout>
      <template #left>
        <GCSPanel :w="4" :h="4" anchor="top-left" :offset-x="0" :offset-y="1.25">
          <div class="info-panel">
            <div class="info-title">西江→运河转移量（{{ year }} 年）</div>
            <div v-for="row in commodityRows" :key="row.label" class="info-row">
              <span>{{ row.label }}</span>
              <span>{{ row.value.toFixed(2) }} 万吨/年</span>
            </div>
            <div v-if="result" class="info-note">
              数据口径：罗淳（2024）分货类锚点线性插值；砂石水泥经西江-珠江运输直接且
              效率高，不可转移（恒 0）。
            </div>
          </div>
        </GCSPanel>
      </template>
      <template #right>
        <GCSPanel :w="4" :h="3" anchor="top-right" :offset-x="0" :offset-y="1.25">
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
        <GCSPanel :w="4" :h="5" anchor="top-right" :offset-x="0" :offset-y="4.5">
          <SankeyChart
            v-if="nodes.length"
            :nodes="nodes"
            :links="links"
            title="西江上行货 → 平陆运河 → 三港"
          />
          <div v-else-if="!loading" class="empty">暂无数据</div>
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

.info-panel {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 8px;
  height: 100%;
  overflow-y: auto;
}

.info-title {
  font-size: 14px;
  font-weight: 600;
  color: var(--GCS-color-primary);
}

.info-row {
  display: flex;
  justify-content: space-between;
  font-size: 12px;
  color: var(--GCS-text-regular);
}

.info-note {
  font-size: 11px;
  color: var(--GCS-text-muted);
  line-height: 1.6;
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
