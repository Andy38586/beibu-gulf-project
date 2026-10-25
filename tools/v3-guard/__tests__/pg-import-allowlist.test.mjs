// @vitest-environment node
/**
 * pg-import-allowlist 自测（F100，用户 2026-10-25 裁定 A）。
 *
 * 钉五件事：
 *   1) infra/db 与 modules/<域>/repositories 的 pg 直引不报（阳性对照）；
 *   2) 白名单外的 import/require 必红，且报出 file:line；
 *   3) 注释里的 from 'pg' 不误红；
 *   4) 空输入集合不得报通过（W58）；
 *   5) 已知违规 fixture 能被判据抓住（用户硬约束）。
 */
import { describe, expect, it } from 'vitest'

import { auditPgImports, isPgImportAllowed, scanPgImports } from '../pg-import-allowlist.mjs'

const src = (relPath, text) => ({ relPath, text })

describe('pg-import-allowlist', () => {
  it('白名单：infra/db 与 repositories 的 pg 直引不报（阳性对照）', () => {
    const sources = [
      src('infra/db/db.service.ts', "import { Pool } from 'pg'"),
      src('modules/plans/repositories/plans.repository.ts', "import type { PoolClient } from 'pg'"),
    ]
    expect(scanPgImports(sources)).toEqual([])
    expect(isPgImportAllowed('infra/db/db.service.ts')).toBe(true)
    expect(isPgImportAllowed('modules/plans/repositories/plans.repository.ts')).toBe(true)
    expect(isPgImportAllowed('modules/flood/services/flood.service.ts')).toBe(false)
  })

  it('@guard-red-sample 白名单外 import pg ⇒ 必红并点名 file:line', () => {
    const bad = scanPgImports([
      src('modules/flood/services/flood.service.ts', "import { Pool } from 'pg'"),
    ])
    expect(bad).toEqual(['modules/flood/services/flood.service.ts:1'])
  })

  it('@guard-red-sample 白名单外 require pg ⇒ 必红', () => {
    const bad = scanPgImports([
      src('modules/flood/services/legacy.ts', "const { Pool } = require('pg')"),
    ])
    expect(bad).toEqual(['modules/flood/services/legacy.ts:1'])
  })

  it('注释里的 pg 直引不误红（阴性对照）', () => {
    const bad = scanPgImports([
      src(
        'modules/flood/services/comment.ts',
        "// 旧实现 from 'pg'\n/* require('pg') */\nexport const x = 1"
      ),
    ])
    expect(bad).toEqual([])
  })

  it('@guard-red-sample 空输入集合 ⇒ 判据不得报通过（W58）', () => {
    const { problem, bad } = auditPgImports([])
    expect(problem).toMatch(/0 个/)
    expect(bad).toEqual([])
  })

  it('已知违规 fixture：非仓储目录直接 import pg ⇒ 判据能红', () => {
    const { problem, bad } = auditPgImports([
      src('infra/db/db.service.ts', "import { Pool } from 'pg'"),
      src('modules/route/services/route.service.ts', "import { Pool } from 'pg'"),
    ])
    expect(problem).toBeNull()
    expect(bad).toEqual(['modules/route/services/route.service.ts:1'])
  })
})
