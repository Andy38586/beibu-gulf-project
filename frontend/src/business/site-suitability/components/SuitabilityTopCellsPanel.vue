<script setup lang="ts">
/**
 * 左下高分候选 Top-N 面板：按 score 降序最多 8 行，
 * 每行 = 排名 / 经纬度（4 位小数）/ score（3 位）/ 横向得分条。
 *
 * 点击行复用既有地图通道 useMapControls.flyTo（同 AffectedFacilityListPanel /
 * SiteSelectionPage），不新造地图 API；面板只读、不自行发请求（数据由页面从 store 透传）。
 * 行数上限 8 与用户 2026-09-30「面板裸行数上限」规则同口径（LayerControlPanel.PANEL_MAX_ROWS）。
 */
import { computed } from 'vue'

import { useMapControls } from '@/core'
import { EmptyState } from '@/shared'
import type { SiteSuitabilityResponseParsed } from '@/types/schemas'

interface Props {
  /** /site-suitability/map 解析响应；null = 尚未取到数据 */
  data?: SiteSuitabilityResponseParsed | null
  /** 请求进行态：无数据时显示「计算中…」而非空态 */
  loading?: boolean
}

interface CellRow {
  key: string
  rank: number
  lng: number
  lat: number
  score: number
}

interface ScoredCell {
  key: string
  /** 原响应序号：score 相同时保持后端返回顺序（稳定排序不把同分格随机洗牌） */
  index: number
  lng: number
  lat: number
  score: number
}

const props = withDefaults(defineProps<Props>(), {
  data: null,
  loading: false,
})

/** 面板裸行数上限 8（用户 2026-09-30 规则：上限就是 8，不滚动） */
const TOP_N = 8

const { flyTo } = useMapControls()

const rows = computed<CellRow[]>(() => {
  const scored: ScoredCell[] = []
  const features = props.data?.features ?? []

  features.forEach((feature, index) => {
    const lng = feature.geometry.coordinates[0]
    const lat = feature.geometry.coordinates[1]
    const score = feature.properties.score
    // crs.ts 禁令：坐标非有限值不落哨兵，直接不进候选列表
    if (!Number.isFinite(lng) || !Number.isFinite(lat) || !Number.isFinite(score)) return
    scored.push({ key: `${feature.properties.id}-${index}`, index, lng, lat, score })
  })

  scored.sort((a, b) => b.score - a.score || a.index - b.index)

  return scored.slice(0, TOP_N).map((cell, i) => ({
    key: cell.key,
    rank: i + 1,
    lng: cell.lng,
    lat: cell.lat,
    score: cell.score,
  }))
})

/** 横向得分条宽度：score 即 0..1，越界截断避免脏数据画出面板 */
function barWidth(score: number): string {
  const pct = Math.round(Math.min(1, Math.max(0, score)) * 100)
  return `${pct}%`
}

function handleRowClick(row: CellRow): void {
  flyTo({ lng: row.lng, lat: row.lat }, { height: 1000 })
}
</script>

<template>
  <div class="ss-top">
    <div class="ss-top__title">高分候选（Top {{ TOP_N }}）</div>
    <div class="ss-top__body">
      <div v-if="rows.length > 0" class="ss-top__rows">
        <div
          v-for="row in rows"
          :key="row.key"
          class="cell-row"
          :data-rank="row.rank"
          @click="handleRowClick(row)"
        >
          <span class="cell-rank">{{ row.rank }}</span>
          <span class="cell-coord">{{ row.lng.toFixed(4) }}, {{ row.lat.toFixed(4) }}</span>
          <span class="cell-score">{{ row.score.toFixed(3) }}</span>
          <span class="cell-bar">
            <span class="cell-bar__fill" :style="{ width: barWidth(row.score) }"></span>
          </span>
        </div>
      </div>
      <div v-else-if="loading" class="ss-top__loading">计算中…</div>
      <EmptyState v-else message="暂无数据" />
    </div>
  </div>
</template>

<style scoped>
.ss-top {
  display: flex;
  flex-direction: column;
  width: 100%;
  height: 100%;
  padding: 8px;
  box-sizing: border-box;
  gap: 6px;
  overflow: hidden;
}

.ss-top__title {
  flex-shrink: 0;
  text-align: center;
  font-size: 14px;
  font-weight: 600;
  color: var(--GCS-color-primary);
}

.ss-top__body {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-height: 0;
}

/* EmptyState 自带 height:100%；作为 flex 子项补 flex:1，窄高面板下也能撑满剩余区 */
.ss-top__body :deep(.empty-state) {
  flex: 1;
}

.ss-top__rows {
  display: flex;
  flex-direction: column;
  gap: 4px;
  flex: 1;
  min-height: 0;
  overflow: hidden;
}

.cell-row {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 3px 6px;
  background: var(--GCS-bg-container);
  border-radius: var(--GCS-radius-sm);
  white-space: nowrap;
  flex-shrink: 0;
  cursor: pointer;
  transition: background 0.2s;
}

.cell-row:hover {
  background: var(--GCS-bg-hover);
}

.cell-rank {
  width: 1.2em;
  flex-shrink: 0;
  text-align: center;
  font-size: 12px;
  color: var(--GCS-text-muted);
}

.cell-coord {
  flex-shrink: 0;
  font-size: 12px;
  color: var(--GCS-text-regular);
  font-variant-numeric: tabular-nums;
}

.cell-score {
  min-width: 3.4em;
  margin-left: auto;
  text-align: right;
  font-size: 12px;
  font-weight: 600;
  color: var(--GCS-color-primary);
  font-variant-numeric: tabular-nums;
}

.cell-bar {
  flex: 1;
  min-width: 36px;
  height: 6px;
  border-radius: 3px;
  background: var(--GCS-bg-panel);
  overflow: hidden;
}

.cell-bar__fill {
  display: block;
  height: 100%;
  border-radius: 3px;
  background: var(--GCS-color-primary);
}

.ss-top__loading {
  display: flex;
  flex: 1;
  align-items: center;
  justify-content: center;
  font-size: 12px;
  color: var(--GCS-text-muted);
}
</style>
