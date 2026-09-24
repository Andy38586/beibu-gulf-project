// @vitest-environment node
/**
 * css-lint-visibility 守卫的自测（含"能让它红"的样本入库）：
 * 红样本 = 把 overrides 改宽回覆盖纯 css（本次真事），或把 css 从脚本 glob 里删掉。
 */
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

import { CONFIG_FILE, auditCssLintVisibility } from '../css-lint-visibility.mjs'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..')
const REAL_CONFIG = readFileSync(path.join(ROOT, CONFIG_FILE), 'utf8')
const REAL_SCRIPT = JSON.parse(readFileSync(path.join(ROOT, 'package.json'), 'utf8')).scripts
  .stylelint

// 红样本：2026-09-23 之前的配置形态（customSyntax 套在纯 .css 上）
const REGRESSED_CONFIG = JSON.stringify({
  extends: ['stylelint-config-standard'],
  overrides: [{ files: ['**/*.css'], customSyntax: 'postcss-html' }],
})

describe('css-lint-visibility 守卫', () => {
  it('当前仓库配置通过', () => {
    expect(auditCssLintVisibility(REAL_CONFIG, REAL_SCRIPT)).toEqual([])
  })

  it('🔴 红样本：customSyntax 套在 **/*.css 上必报（违例不可见的成因）', () => {
    const problems = auditCssLintVisibility(REGRESSED_CONFIG, REAL_SCRIPT)
    expect(problems.length).toBeGreaterThan(0)
    expect(problems.join(' ')).toContain('customSyntax')
  })

  it('🔴 红样本：脚本 glob 不含 .css ⇒ 纯 CSS 脱离检查面', () => {
    const problems = auditCssLintVisibility(REAL_CONFIG, 'stylelint "frontend/src/**/*.vue"')
    expect(problems.length).toBeGreaterThan(0)
    expect(problems.join(' ')).toContain('未覆盖纯 CSS')
  })

  it('给 .vue 用容器语法是正确用法，不得误报', () => {
    const ok = JSON.stringify({
      overrides: [{ files: ['**/*.vue'], customSyntax: 'postcss-html' }],
    })
    expect(auditCssLintVisibility(ok, REAL_SCRIPT)).toEqual([])
  })
})
