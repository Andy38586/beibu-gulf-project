import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import ts from 'typescript'
import { describe, expect, it } from 'vitest'

/**
 * defineExpose 公开面守卫（必要性审判波二·单元 K）
 *
 * defineExpose 是「向外暴露」：无外部消费方时零价值，且会让读者以为存在外部依赖。
 * 本判据把 `.vue` 里的 defineExpose 收成白名单面——任何 .vue 出现白名单外的
 * defineExpose（或白名单内键位漂移）即红。
 *
 * 白名单（三条，均有生产消费方）：
 *  · UnifiedMap.vue             → core/provideKeys.ts 的 UnifiedMapExposed（@/core 消费）
 *  · RouteControlPanel.vue      → RouteAnalysisPage.vue:467 的 panelRef
 *  · WaterLevelProfilePanel.vue → FloodAnalysisPage.vue:543 的 waterPanelRef
 *
 * 本单元删除（零消费）：GCSPanel.abortDrag / SankeyChart.chartRef+updateChart /
 * BarChart.chartRef / LineChart.chartRef。同类先例 9c46ac55 删 SuitabilityRadarPanel。
 */

const HERE = path.dirname(fileURLToPath(import.meta.url))
const SRC = path.resolve(HERE, '..', '..')
const SKIP_DIR = new Set(['__tests__', '__mocks__', 'node_modules', 'dist', '.local'])

/** 白名单：文件（相对 SRC）→ 允许暴露的键（顺序即声明顺序） */
const ALLOWED: Record<string, string[]> = {
  'core/map/UnifiedMap.vue': ['flyTo', 'getRenderer', 'startBreathing', 'stopBreathing'],
  'business/route-analysis/components/RouteControlPanel.vue': ['handleMapPick', 'handleClear'],
  'business/flood-analysis/components/WaterLevelProfilePanel.vue': [
    'registerRenderers',
    'dockToTask',
  ],
}

function listVue(dir: string, out: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (SKIP_DIR.has(entry.name)) continue
      listVue(path.join(dir, entry.name), out)
    } else if (entry.name.endsWith('.vue')) {
      out.push(path.join(dir, entry.name))
    }
  }
  return out
}

/** 解析源码文本，返回每个 defineExpose({ ... }) 的键名（无则空数组） */
export function exposedKeys(text: string): string[] {
  const sf = ts.createSourceFile('probe.ts', text, ts.ScriptTarget.Latest, true)
  const keys: string[] = []
  const visit = (node: ts.Node): void => {
    if (
      ts.isCallExpression(node) &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === 'defineExpose'
    ) {
      const arg = node.arguments[0]
      if (arg && ts.isObjectLiteralExpression(arg)) {
        for (const prop of arg.properties) {
          if (ts.isShorthandPropertyAssignment(prop) || ts.isPropertyAssignment(prop)) {
            keys.push(prop.name.getText(sf))
          }
        }
      }
    }
    ts.forEachChild(node, visit)
  }
  visit(sf)
  return keys
}

/** 阳性对照：同形态样本必须被抽到键名 */
const HAND_WRITTEN_SAMPLE = `<script setup lang="ts">
const chartRef = ref(null)
defineExpose({ chartRef, updateChart })
</script>
`

describe('defineExpose 公开面（必要性审判波二·单元 K）', () => {
  const files = listVue(SRC)
  const actual = new Map<string, string[]>()
  for (const file of files) {
    const keys = exposedKeys(fs.readFileSync(file, 'utf8'))
    if (keys.length > 0) actual.set(path.relative(SRC, file).split(path.sep).join('/'), keys)
  }

  it('全仓 .vue 的 defineExpose 只允许白名单三条', () => {
    const offenders: string[] = []
    for (const [rel, keys] of actual) {
      const allowed = ALLOWED[rel]
      if (!allowed) {
        offenders.push(`${rel}: 白名单外的 defineExpose(${keys.join(', ')})`)
      } else if (keys.slice().sort().join(',') !== allowed.slice().sort().join(',')) {
        // 按集合比较：对象字面量键序是无语义的等价重构，不得误红
        offenders.push(
          `${rel}: 键集合漂移 [${keys.slice().sort().join(', ')}] ≠ [${allowed.slice().sort().join(', ')}]`
        )
      }
    }
    expect(offenders).toEqual([])
    // 兜空：扫描面必须真的扫到仓库
    expect(files.length).toBeGreaterThan(40)
  })

  it('白名单三条仍存在且键集合一致（防白名单被清空）', () => {
    for (const [rel, keys] of Object.entries(ALLOWED)) {
      expect(actual.get(rel)?.slice().sort()).toEqual(keys.slice().sort())
    }
  })

  it('🔴 @guard-red-sample 同形态样本（含 defineExpose）必被抽到键名', () => {
    expect(exposedKeys(HAND_WRITTEN_SAMPLE)).toEqual(['chartRef', 'updateChart'])
    // 该样本若落进仓内即是白名单外 offender：证明本判据能咬
    expect(ALLOWED['visualization/charts/SankeyChart.vue']).toBeUndefined()
  })
})
