import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { afterAll, describe, expect, it } from 'vitest'

import { currentCounts } from '../ratchet.mjs'
import { scanDeepImports } from '../scan.mjs'

const TMP_ROOTS = []
afterAll(() => TMP_ROOTS.forEach((r) => fs.rmSync(r, { recursive: true, force: true })))

/** 建一棵假 src 树：`{ 'business/index.ts': '…' }` 这样的映射 */
function makeTree(files) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'deep-import-'))
  TMP_ROOTS.push(root)
  for (const [rel, content] of Object.entries(files)) {
    const p = path.join(root, rel)
    fs.mkdirSync(path.dirname(p), { recursive: true })
    fs.writeFileSync(p, content)
  }
  return root
}

describe('深路径穿透扫描口径（W59）', () => {
  it('≥3 段且跨模块组才算穿透', () => {
    const root = makeTree({
      'business/forecast/ForecastPage.vue': "import { x } from '@/shared/utils/helpers'\n",
      'shared/utils/helpers.ts': 'export const x = 1\n',
    })
    expect(scanDeepImports(root)).toEqual([
      {
        file: 'business/forecast/ForecastPage.vue',
        target: 'shared/utils/helpers',
        group: 'shared/utils',
      },
    ])
  })

  it('同模块组内的子目录互引不算穿透', () => {
    // core/map/renderers → core/map/composables：两组同属 core/map，是模块内部结构
    const root = makeTree({
      'core/map/renderers/MapRenderer.ts': "import { y } from '../composables/useZoom'\n",
      'core/map/composables/useZoom.ts': 'export const y = 1\n',
    })
    expect(scanDeepImports(root)).toEqual([])
  })

  it('2 段目标（走入口）不算穿透', () => {
    const root = makeTree({
      'business/forecast/ForecastPage.vue': "import { z } from '@/shared/utils'\n",
      'shared/utils/index.ts': 'export const z = 1\n',
    })
    expect(scanDeepImports(root)).toEqual([])
  })

  it('测试文件不计入（与 .dependency-cruiser.cjs 的 exclude.path 同口径）', () => {
    const root = makeTree({
      'business/forecast/__tests__/x.test.ts': "import { a } from '@/shared/utils/helpers'\n",
      'shared/utils/helpers.ts': 'export const a = 1\n',
      'business/forecast/spec.spec.ts': "import { b } from '@/shared/utils/helpers'\n",
    })
    expect(scanDeepImports(root)).toEqual([])
  })

  it('注释里的 import 说明符不算依赖', () => {
    const root = makeTree({
      'business/forecast/ForecastPage.vue': [
        '// import { a } from "@/shared/utils/helpers"',
        '/* import { b } from "@/shared/utils/other" */',
        'import { real } from "@/shared/utils/real"',
      ].join('\n'),
      'shared/utils/real.ts': 'export const real = 1\n',
    })
    expect(scanDeepImports(root)).toEqual([
      {
        file: 'business/forecast/ForecastPage.vue',
        target: 'shared/utils/real',
        group: 'shared/utils',
      },
    ])
  })

  it('动态 import() 同样计入', () => {
    const root = makeTree({
      'views/HomePage.vue': "const m = () => import('@/shared/utils/helpers')\n",
      'shared/utils/helpers.ts': 'export default {}\n',
    })
    expect(scanDeepImports(root)).toHaveLength(1)
  })

  it('入口文件豁免只对「目标组没有入口」生效（W59 防回归的核心）', () => {
    const files = {
      'business/index.ts': "export * from './forecast/composables/useForecastRequest'\n",
      'business/forecast/composables/useForecastRequest.ts': 'export const c = 1\n',
      'business/forecast/index.ts': 'export { c } from "./composables/useForecastRequest"\n',
    }
    // 目标组已有入口 ⇒ business/index.ts 该走入口，穿透必须计入
    expect(scanDeepImports(makeTree(files))).toEqual([
      {
        file: 'business/index.ts',
        target: 'business/forecast/composables/useForecastRequest',
        group: 'business/forecast',
      },
    ])
    // 目标组没有入口 ⇒ 存量形态（core/index.ts 31 条、shared/index.ts 49 条），豁免
    delete files['business/forecast/index.ts']
    expect(scanDeepImports(makeTree(files))).toEqual([])
  })

  it('真实树口径回归锚：当前存量与基线一致（防口径悄悄漂移）', () => {
    // 这条锚点是「尺子」的自陈：真实 frontend/src 扫出来的条数必须与
    // tools/deep-import/baseline.json 的 total 相等，否则说明口径或代码面变了，
    // 要么改基线（带 note），要么发现了解析漏洞——两种都不许静默。
    const baseline = JSON.parse(
      fs.readFileSync(
        path.join(path.dirname(fileURLToPath(import.meta.url)), '../baseline.json'),
        'utf8'
      )
    )
    expect(currentCounts().total).toBe(baseline.total)
  })
})
