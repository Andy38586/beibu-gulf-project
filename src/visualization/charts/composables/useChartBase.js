import { useECharts } from '@/visualization/composables/useECharts'

export function useChartBase(props, emit, chartType, seriesConfig) {
  function handleClick(params) {
    if (params.dataIndex == null) return
    emit('select', params.dataIndex)
  }

  /**
   * P0-01-FIX: option 必须在每次调用时现取 props 构建。
   * 修复前 baseOption 为 setup 时的一次性快照，导致 props 更新后图表永不刷新。
   * 注意：watch 为浅监听，父组件更新数据时必须替换数组/对象引用（不可变更新），
   * 不要原地 push/splice，否则不会触发更新。
   */
  function buildOption() {
    return {
      backgroundColor: 'transparent',
      grid: { top: 40, right: 16, bottom: 40, left: 40 },
      title: {
        text: props.title,
        left: 'center',
        textStyle: { color: '#303133', fontSize: 16, fontWeight: 600 },
      },
      tooltip: { trigger: 'axis' },
      legend: {
        bottom: 0,
        textStyle: { color: '#666', fontSize: 10 },
        itemWidth: 10,
        itemHeight: 6,
      },
      xAxis: {
        type: 'category',
        data: props.xData || [],
        axisLine: { lineStyle: { color: '#ddd' } },
        axisLabel: { color: '#666', fontSize: 10 },
        ...(props.xMin ? { min: props.xMin } : {}),
        ...(props.xMax ? { max: props.xMax } : {}),
      },
      yAxis: {
        type: 'value',
        splitLine: { lineStyle: { color: '#eee' } },
        axisLabel: { color: '#666', fontSize: 10 },
      },
      series: (props.series || []).map((s) => ({
        name: s.name,
        type: chartType,
        data: s.data || [],
        ...seriesConfig,
      })),
    }
  }

  return useECharts({
    getOption: buildOption,
    watchSources: [() => props.title, () => props.xData, () => props.series, () => props.xMin, () => props.xMax],
    onClick: handleClick,
  })
}
