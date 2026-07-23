<script setup>
import { useChartBase } from './composables/useChartBase'

const props = defineProps({
  title: { type: String, default: '港口吞吐量对比' },
  xData: { type: Array, default: () => ['钦州港', '北海港', '防城港'] },
  series: {
    type: Array,
    default: () => [
      { name: '2023年', data: [190, 140, 150] },
      { name: '2024年', data: [230, 180, 170] },
    ],
  },
})

const emit = defineEmits(['select'])

const { chartRef } = useChartBase(props, emit, 'bar', {
  barWidth: '30%',
  itemStyle: { borderRadius: [4, 4, 0, 0] },
})
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
