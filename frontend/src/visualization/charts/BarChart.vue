<script setup lang="ts">
import { computed } from 'vue'

import EmptyState from '@/shared/components/EmptyState.vue'

import { useChartBase } from './composables/useChartBase'

interface Props {
  title?: string
  xData?: string[]
  series?: Array<{ name: string; data: number[] }>
}

const props = withDefaults(defineProps<Props>(), {
  title: '港口吞吐量对比',
  xData: () => ['钦州港', '北海港', '防城港'],
  series: () => [
    { name: '2023年', data: [190, 140, 150] },
    { name: '2024年', data: [230, 180, 170] },
  ],
})

const emit = defineEmits<{
  select: [dataIndex: number]
}>()

const { chartRef } = useChartBase(props, emit, 'bar', {
  barWidth: '30%',
  itemStyle: { borderRadius: [4, 4, 0, 0] },
})

/** 无数据时以 absolute 浮层显示空态（chartRef 始终挂载） */
const hasData = computed(() => {
  if (!props.series || props.series.length === 0) return false
  return props.series.some((s) => s.data && s.data.length > 0)
})

defineExpose({ chartRef })
</script>

<template>
  <div class="bar-chart-container">
    <div ref="chartRef" class="bar-chart"></div>
    <EmptyState v-if="!hasData" class="bar-chart-empty" />
  </div>
</template>

<style scoped>
.bar-chart-container {
  position: relative;
  width: 100%;
  height: 100%;
}

.bar-chart {
  width: 100%;
  height: 100%;
}

.bar-chart-empty {
  position: absolute;
  inset: 0;
}
</style>
