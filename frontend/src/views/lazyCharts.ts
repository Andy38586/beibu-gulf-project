import { defineAsyncComponent } from 'vue'
import { ChartLoading } from '@/visualization'

/**
 * 首页/个人页共用的懒加载图表：echarts 移出首屏关键路径，
 * 就绪后替换 ChartLoading 占位。重复定义集中于此，避免 dup 棘轮上涨。
 */
export const LazyLineChart = defineAsyncComponent({
  loader: () => import('@/visualization').then((m) => m.LineChart),
  loadingComponent: ChartLoading,
})

export const LazyBarChart = defineAsyncComponent({
  loader: () => import('@/visualization').then((m) => m.BarChart),
  loadingComponent: ChartLoading,
})
