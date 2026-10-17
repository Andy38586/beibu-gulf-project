// @vitest-environment node
/**
 * 代码资产棘轮（死物 / 冗余导出 / 重复）的强制点接线（2A）。
 *
 * 治的是「本体已绿、挂点未上闸」：`ratchet:dead-code` / `ratchet:dup` 此前只挂在
 * 人手敲的 `ci:local` ⇒ 不敲就无人拦（AGENTS §十三-2「只进人手敲的聚合入口不算挂点」）。
 * 本判据断言两个强制点里各有一条**可执行**命令行 —— 注释与 echo 不算触发
 * （形状照 `tools/metrics/__tests__/derive-status.test.mjs` 的强制点接线用例）。
 */
import { readFileSync } from 'node:fs'

import { describe, expect, it } from 'vitest'

const SCRIPTS = ['ratchet:dead-code', 'ratchet:dup']
const SITES = ['.husky/pre-push', '.github/workflows/ci.yml']

/** 剥掉注释行后的可执行命令行（注释里提一句 `npm run X` 不算触发点） */
function executableLines(rel) {
  return readFileSync(new URL(`../../../${rel}`, import.meta.url), 'utf8')
    .split(/\r?\n/)
    .filter((l) => !l.trim().startsWith('#'))
}

describe('代码资产棘轮强制点接线（2A）', () => {
  it('@guard-red-sample 两个棘轮在两个强制点各有可执行步骤', () => {
    for (const rel of SITES) {
      const lines = executableLines(rel)
      for (const s of SCRIPTS) {
        expect(
          lines.some((l) => l.includes(`npm run ${s}`)),
          `${rel} 缺 npm run ${s} 可执行步骤`
        ).toBe(true)
      }
    }
  })

  it('@guard-red-sample 棘轮排在覆盖率基线冻结之后（基线未冻结时棘轮判定不可信）', () => {
    const lines = executableLines('.husky/pre-push')
    const freeze = lines.findIndex((l) =>
      l.includes('--freeze-check backend/coverage-baseline.json')
    )
    const dead = lines.findIndex((l) => l.includes('npm run ratchet:dead-code'))
    expect(freeze).toBeGreaterThanOrEqual(0)
    expect(dead).toBeGreaterThan(freeze)
  })
})
