import { createRequire } from 'node:module'

import { describe, expect, it } from 'vitest'

// 脚本是 CommonJS（ci:local 直接 node 调用），单测侧用 createRequire 载入同一份实现，
// 避免为了测试再复制一套规则 —— 复制体一旦漂移，测的就是"另一个脚本"。
const require = createRequire(import.meta.url)
const { resolveTestDb, DEFAULT_TEST_DB, DEV_DB } = require('../ci-backend-db.cjs')

describe('resolveTestDb', () => {
  it('默认（未设 V3_CI_DB）返回 beibu_gulf_ci_test', () => {
    expect(resolveTestDb({})).toBe('beibu_gulf_ci_test')
    expect(resolveTestDb({ V3_CI_DB: '' })).toBe(DEFAULT_TEST_DB)
    expect(DEFAULT_TEST_DB).toBe('beibu_gulf_ci_test')
  })

  it('显式把开发库当测试库时抛错（红线）', () => {
    // 这是本脚本唯一不能妥协的判定：目标库等于开发库 → 立刻拒绝，绝不连、绝不写
    expect(() => resolveTestDb({ V3_CI_DB: 'beibu-gulf-data' })).toThrow(/拒绝执行/)
    expect(() => resolveTestDb({ V3_CI_DB: DEV_DB })).toThrow(/开发库或系统库/)
    // 系统库同样在拒绝名单里
    expect(() => resolveTestDb({ V3_CI_DB: 'postgres' })).toThrow(/拒绝执行/)
  })

  it('V3_CI_DB 覆盖生效', () => {
    expect(resolveTestDb({ V3_CI_DB: 'beibu_gulf_ci_test_alt' })).toBe('beibu_gulf_ci_test_alt')
    // 前后空白被 trim（shell 里 V3_CI_DB=" x " 是常见笔误）
    expect(resolveTestDb({ V3_CI_DB: '  beibu_gulf_ci_test_alt  ' })).toBe('beibu_gulf_ci_test_alt')
  })
})
