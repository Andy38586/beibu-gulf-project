// 实测 ECharts 标题渲染位置（与 useChartBase 相同配置）
// 用法: node scripts/measure-title.mjs
import { LineChart } from 'echarts/charts'
import {
  GridComponent,
  LegendComponent,
  TitleComponent,
  TooltipComponent,
} from 'echarts/components'
import * as echarts from 'echarts/core'
import { SVGRenderer } from 'echarts/renderers'

echarts.use([
  LineChart,
  GridComponent,
  TitleComponent,
  TooltipComponent,
  LegendComponent,
  SVGRenderer,
])

const sizes = [
  { w: 320, h: 320, label: 'cell80(4x4=320)' },
  { w: 360, h: 360, label: 'cell90(4x4=360)' },
  { w: 280, h: 280, label: 'cell70(4x4=280)' },
]

for (const { w, h, label } of sizes) {
  const chart = echarts.init(null, null, { renderer: 'svg', ssr: true, width: w, height: h })
  chart.setOption({
    backgroundColor: 'transparent',
    grid: { top: 40, right: 16, bottom: 40, left: 40 },
    title: {
      text: '预测趋势',
      left: 'center',
      textStyle: { fontSize: 16, fontWeight: 600, color: '#303133' },
    },
    xAxis: { type: 'category', data: ['2024'] },
    yAxis: { type: 'value' },
    series: [{ type: 'line', data: [100] }],
  })
  const svg = chart.renderToSVGString()
  chart.dispose()
  const m = svg.match(/<text[^>]*>([^<]*)<\/text>/g) || []
  for (const t of m) {
    if (t.includes('预测趋势')) {
      const y = t.match(/y="([\d.]+)"/)?.[1]
      const dy = t.match(/dominant-baseline="([^"]+)"/)?.[1]
      const transform = t.match(/transform="([^"]+)"/)?.[1]
      console.log(
        `[${label}] w=${w} h=${h} title y=${y} baseline=${dy} transform=${transform || 'none'}`
      )
    }
  }
}

// 再看默认 title（不显式 top）的完整输出片段
const chart = echarts.init(null, null, { renderer: 'svg', ssr: true, width: 320, height: 320 })
chart.setOption({
  title: { text: '预测趋势', left: 'center', textStyle: { fontSize: 16, fontWeight: 600 } },
  xAxis: { type: 'category', data: ['2024'] },
  yAxis: { type: 'value' },
  series: [{ type: 'line', data: [100] }],
})
const svg = chart.renderToSVGString()
chart.dispose()
const seg = svg.slice(svg.indexOf('<text'), svg.indexOf('</text>') + 7)
console.log('--- 原始 text 元素 ---')
console.log(seg)
