import { describe, expect, it } from 'vitest'

import { CESIUM_IMPORT_ALLOWLIST, scanCesiumImports } from '../cesium-import-allowlist.mjs'

/** 造一个源文件条目（relPath 相对 frontend/src） */
const src = (relPath, text) => ({ relPath, text })

describe('cesium-import-allowlist —— 2D eager 图禁止静态 import cesium', () => {
  it('基线（白名单三文件各自 import）⇒ 零违规', () => {
    const sources = [...CESIUM_IMPORT_ALLOWLIST].map((p) =>
      src(p, "import { Cartesian3 } from 'cesium'\nexport const x = Cartesian3\n")
    )
    expect(scanCesiumImports(sources)).toEqual([])
  })

  it('@guard-red-sample 白名单外静态值 import ⇒ 必红且带行号', () => {
    const bad = scanCesiumImports([
      src(
        'core/map/renderers/OLRenderer.ts',
        "import ol from 'ol'\nimport { Cartesian3 } from 'cesium'\n"
      ),
    ])
    expect(bad).toEqual(['core/map/renderers/OLRenderer.ts:2'])
  })

  it('@guard-red-sample type-only import 同样必红（tsPreCompilationDeps 语义）', () => {
    const bad = scanCesiumImports([
      src('shared/foo.ts', "import type { Viewer } from 'cesium'\nexport type V = Viewer\n"),
    ])
    expect(bad).toEqual(['shared/foo.ts:1'])
  })

  it('@guard-red-sample 停用/包进条件分支的写法 ⇒ 必红（文本级判据不认运行时条件）', () => {
    const bad = scanCesiumImports([
      src(
        'core/map/renderers/index.ts',
        "const m = await import('cesium')\nif (false) {\n  const x = require('cesium')\n}\n"
      ),
    ])
    // require 形态在剥离注释后仍命中第 3 行
    expect(bad).toEqual(['core/map/renderers/index.ts:3'])
  })

  it('等价重构 ⇒ 不许红：同文件 import 别的包 / 注释里出现 cesium 示例', () => {
    const ok = scanCesiumImports([
      src(
        'core/map/renderers/OLRenderer.ts',
        "import { Feature } from 'ol'\n// import { Cartesian3 } from 'cesium'\n/*\n * import … from 'cesium'（示例）\n */\n"
      ),
      src('shared/utils/x.ts', "export const c = 'cesium-string'\n"),
    ])
    expect(ok).toEqual([])
  })

  it('同义改写违约 ⇒ 必红：裸副作用 import 与换行 import 都算', () => {
    const bad = scanCesiumImports([
      src('a.ts', "import 'cesium'\n"),
      src('b.ts', "import {\n  Cartesian3,\n} from 'cesium'\n"),
    ])
    expect(bad).toEqual(['a.ts:1', 'b.ts:3'])
  })
})
