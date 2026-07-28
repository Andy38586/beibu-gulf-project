<script setup lang="ts">
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
  'select': [dataIndex: number]
}>()

const { chartRef } = useChartBase(props, emit, 'bar', {
  barWidth: '30%',
  itemStyle: { borderRadius: [4, 4, 0, 0] },
})

defineExpose({ chartRef })
</script>

<template>
  <div ref="chartRef" class="bar-chart"></div>
</template>

<style scoped>
.bar-chart {
  width: 100%;
  height: 100%;
}
</style>
