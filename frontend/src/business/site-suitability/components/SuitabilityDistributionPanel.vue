<script setup lang="ts">
/**
 * 左上得分分布面板：0..1 十档直方图 + 关键统计行
 * （格数 / 最高分 / 平均分 / score≥0.8 格数）。
 *
 * 只读展示（面板禁滑块，用户 2026-09-30 规则）；数据来自 store 的
 * /site-suitability/map 解析响应（页面 props 透传），面板不自行发请求。
 */
import { computed } from 'vue'

import { EmptyState } from '@/shared'
import type { SiteSuitabilityResponseParsed } from '@/types/schemas'
import { BarChart, ChartLoading } from '@/visualization'

interface Props {
  /** /site-suitability/map 解析响应；null = 尚未取到数据 */
  data?: SiteSuitabilityResponseParsed | null
  /** 请求进行态：true 时只显示 ChartLoading，不显示「暂无数据」 */
  loading?: boolean
}

const props = withDefaults(defineProps<Props>(), {
  data: null,
  loading: false,
})

/** 0..1 均分十档；最后一档包含 score=1.0 */
const BUCKET_COUNT = 10
/** score≥0.8 计为高分（与左下 Top-N 面板同阈值口径） */
const HIGH_SCORE = 0.8

/** x 轴标签取每档下界（0.0 … 0.9），标题已注明 0..1 十档口径 */
const bucketLabels = Array.from({ length: BUCKET_COUNT }, (_, i) => (i / BUCKET_COUNT).toFixed(1))

/**
 * 单趟遍历完成分桶 + 统计：格网可达万级，避免多次 map/spread 展开；
 * 非有限 score 跳过（脏数据不参与统计，也不落错桶）。
 */
const summary = computed(() => {
  const features = props.data?.features ?? []
  const buckets = new Array<number>(BUCKET_COUNT).fill(0)
  let valid = 0
  let max = Number.NEGATIVE_INFINITY
  let sum = 0
  let high = 0

  for (const feature of features) {
    const score = feature.properties.score
    if (!Number.isFinite(score)) continue
    valid += 1
    if (score > max) max = score
    sum += score
    if (score >= HIGH_SCORE) high += 1
    const index = Math.min(BUCKET_COUNT - 1, Math.max(0, Math.floor(score * BUCKET_COUNT)))
    buckets[index] += 1
  }

  return {
    buckets,
    // 格数优先取响应元数据 count（业务口径），缺失时回退到实际参与统计的格数
    count: props.data?.metadata.count ?? valid,
    max: valid > 0 ? max : null,
    avg: valid > 0 ? sum / valid : null,
    high,
  }
})

const hasData = computed(() => (props.data?.features.length ?? 0) > 0)

const series = computed(() => [{ name: '格数', data: summary.value.buckets }])

function formatScore(value: number | null): string {
  return value === null ? '—' : value.toFixed(3)
}
</script>

<template>
  <div class="ss-dist">
    <div class="ss-dist__chart">
      <BarChart
        v-if="hasData"
        title="得分分布（0–1，10 档）"
        :x-data="bucketLabels"
        :series="series"
      />
      <EmptyState v-else-if="!loading" message="暂无数据" />
      <ChartLoading v-if="loading" />
    </div>
    <div class="ss-dist__stats">
      <div class="stat-item" data-stat="count">
        <span class="stat-label">格数</span>
        <span class="stat-value">{{ summary.count }}</span>
      </div>
      <div class="stat-item" data-stat="max">
        <span class="stat-label">最高分</span>
        <span class="stat-value">{{ formatScore(summary.max) }}</span>
      </div>
      <div class="stat-item" data-stat="avg">
        <span class="stat-label">平均分</span>
        <span class="stat-value">{{ formatScore(summary.avg) }}</span>
      </div>
      <div class="stat-item" data-stat="high">
        <span class="stat-label">score≥0.8</span>
        <span class="stat-value">{{ summary.high }}</span>
      </div>
    </div>
  </div>
</template>

<style scoped>
.ss-dist {
  display: flex;
  flex-direction: column;
  width: 100%;
  height: 100%;
  padding: 8px;
  box-sizing: border-box;
  gap: 6px;
}

.ss-dist__chart {
  position: relative;
  flex: 1;
  min-height: 0;
}

.ss-dist__stats {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 4px;
  flex-shrink: 0;
  padding: 0 2px;
}

.stat-item {
  display: flex;
  align-items: baseline;
  gap: 4px;
  white-space: nowrap;
}

.stat-label {
  font-size: 12px;
  color: var(--GCS-text-muted);
}

.stat-value {
  font-size: 13px;
  font-weight: 600;
  color: var(--GCS-color-primary);
  font-variant-numeric: tabular-nums;
}
</style>
