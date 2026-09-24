import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

// c043 同形态三处一起收（R5）：三处控制面板的网格容器都必须**声明滚动出口**。
//
// 为什么用源码级断言：jsdom 不做布局，`scrollHeight`/`clientHeight` 恒为 0，运行时无法
// 判断"条目是否真的溢出"。可断言的事实是"出口声明在位"（`overflow-y:auto` + 可测锚
// `data-overflow-exit`）——两者任一被删即红，防的是"改回去不留痕"。
// 行为侧判据见 `core/map/__tests__/LayerControlPanel.capacity.test.ts`（真注入 capacity+1）。
const SRC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..')

const PANELS = [
  { file: 'core/map/components/LayerControlPanel.vue', grid: '.layer-grid', via: '目录派生' },
  {
    file: 'business/site-selection/components/SiteAnalysisControlPanel.vue',
    grid: '.factor-grid',
    via: '设施因子',
  },
  {
    file: 'business/forecast/components/ForecastControlPanel.vue',
    grid: '.btn-grid',
    via: '指标按钮',
  },
]

describe('c043 三处面板的容量出口', () => {
  for (const { file, grid, via } of PANELS) {
    it(`🔴 ${file}：${grid}（${via}）必须声明滚动出口`, () => {
      const text = readFileSync(path.join(SRC, file), 'utf8')

      // ① 样式出口：`.grid { … overflow-y: auto|scroll … }`（等价重构 `overflow: auto` 也放行）
      const rule = text.match(new RegExp(`\\${grid}\\s*\\{([^}]*)\\}`))
      expect(rule, `${grid} 规则未找到`).not.toBeNull()
      expect(rule?.[1], `${grid} 未声明滚动出口（overflow-y:auto/scroll）`).toMatch(
        /overflow(-y)?:\s*(auto|scroll)/
      )

      // ② 可测锚：模板容器上的 data-overflow-exit（与样式同处声明，防"样式删了没人发现"）
      expect(text, `${grid} 容器缺 data-overflow-exit 锚`).toContain('data-overflow-exit="scroll"')
    })
  }
})
