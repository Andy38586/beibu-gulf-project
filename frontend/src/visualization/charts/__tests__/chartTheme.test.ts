import { describe, expect, it } from 'vitest'

import { chartColor } from '@/shared'

import { chartAxisLineOption, chartTitleOption } from '../chartTheme'

describe('chartTheme 三图共用样式', () => {
  it.each([false, true])('标题：居中、主文字色、16px/600（dark=%s）', (dark) => {
    expect(chartTitleOption('西江货类转移流向', dark)).toEqual({
      text: '西江货类转移流向',
      left: 'center',
      textStyle: {
        color: chartColor('textPrimary', dark),
        fontSize: 16,
        fontWeight: 600,
      },
    })
  })

  it.each([false, true])('轴线：颜色取主题轴色（dark=%s）', (dark) => {
    expect(chartAxisLineOption(dark)).toEqual({
      lineStyle: { color: chartColor('axisLine', dark) },
    })
  })
})
