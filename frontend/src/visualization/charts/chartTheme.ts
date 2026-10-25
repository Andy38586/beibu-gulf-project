import { chartColor } from '@/shared'

/** 图表标题：折线/柱状、桑基、雷达共用，16px/600 与主文字色只在这里改 */
export function chartTitleOption(title: string | undefined, dark: boolean) {
  return {
    text: title,
    left: 'center',
    textStyle: {
      color: chartColor('textPrimary', dark),
      fontSize: 16,
      fontWeight: 600,
    },
  }
}

/** 轴线：直角坐标 x 轴与雷达轴共用同一主题色 */
export function chartAxisLineOption(dark: boolean) {
  return { lineStyle: { color: chartColor('axisLine', dark) } }
}
