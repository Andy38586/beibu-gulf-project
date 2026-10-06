/**
 * doc-claim-numbers 自测：手抄数字必红 + 登记站点/指针句不许误红（同形态阳性对照）。
 */
import { describe, expect, it } from 'vitest'

import { auditClaimNumbers, loadFiles } from '../doc-claim-numbers.mjs'

const run = (path, text) => auditClaimNumbers([{ path, text }])

describe('doc-claim-numbers — 自述数字必须有执行体', () => {
  it('@guard-red-sample 未登记的门禁条数 ⇒ 必红（新增一处手抄这件事本身可判）', () => {
    const problems = run('README.md', '本项目共 26 项守卫，全部必跑。\n')
    expect(problems).toHaveLength(1)
    expect(problems[0]).toContain('手抄门禁条数「26 项守卫」未登记')
  })

  it('阳性对照：同一句话落在 doc-numbers 登记站点内 ⇒ 不红（值由那条守卫对账）', () => {
    expect(run('.husky/pre-commit', '# 快集清单：guard:v3（26 项静态守卫，含 x）\n')).toEqual([])
    expect(
      run(
        'tools/README.md',
        'npm run guard:v3  # tools/v3-guard/*.mjs（26 项守卫，run-all.mjs 串联不短路）\n'
      )
    ).toEqual([])
  })

  it('@guard-red-sample 体量数字没有执行体 ⇒ 必红（「≤ 80 行」族）', () => {
    const problems = run('docs/文档地图.md', '> 本文件体量上限 ≤ 80 行，超出先删旧条款。\n')
    expect(problems).toHaveLength(1)
    expect(problems[0]).toContain('手抄体量数字')
    expect(problems[0]).toContain('（80 行）')
  })

  it('阳性对照：同行带执行体路径（指针句/历史引述）⇒ 不红', () => {
    expect(
      run(
        'docs/根基文档/审查体系专项/审查体系约定.md',
        '> 行数上限由 `tools/v3-guard/protocol-single-source.mjs` 体量表校验（旧版写"≤ 80 行"已过期）。\n'
      )
    ).toEqual([])
  })

  it('真仓端到端：16 份扫描文档自述数字全部可追溯（索引口径）', () => {
    const files = loadFiles()
    expect(files.length).toBeGreaterThanOrEqual(10)
    expect(auditClaimNumbers(files.filter((f) => !f.missing))).toEqual([])
  })
})
