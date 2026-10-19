// @vitest-environment node
/**
 * git-ignored 的单源判据（含红样）。
 *
 * 该模块收口了 agent-docs-check 与 tmp-hygiene 此前各持一份的 `isGitIgnored()`。
 * 两份的差别不只是写法：一处只回二态（status === 0），一处回三态（另加 null = 非 git
 * 环境）。三态是 tmp-hygiene 的承重语义——它用 `=== true` 判豁免，于是 tarball 分发
 * （非 git 环境）下 tmp- 目录**仍报红**。抹成二态等于删掉那条兜底，故本文件把三档
 * 全部钉住，并额外钉住调用侧的豁免语义（下一条用例）。
 */
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

import { isGitIgnored } from '../lib/git-ignored.mjs'
import { scan } from '../tmp-hygiene.mjs'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..')

describe('isGitIgnored — 版本控制之外的三态判定', () => {
  it('@guard-red-sample 被忽略 ⇒ true；被跟踪 ⇒ false', () => {
    expect(isGitIgnored('.local/', { root: ROOT })).toBe(true)
    expect(isGitIgnored('AGENTS.md', { root: ROOT })).toBe(false)
  })

  it('@guard-red-sample 非 git 环境 ⇒ null（不是 false，也不是 true）', () => {
    // 不存在的 root 是「非 git 环境」的确定性构造：git 自己 exit 128，与 spawn 失败无关
    expect(isGitIgnored('x', { root: 'C:/no/such/dir-does-not-exist' })).toBeNull()
  })

  it('root 可注入：换 root 结论随之改变', () => {
    // 必须用仓库**外**的目录：仓库内的子目录 git 会向上找到 .git，仍是 git 环境
    // （本轮踩过：在 .local/tmp 下造目录，check-ignore 照样 exit 0）
    const outside = mkdtempSync(path.join(tmpdir(), 'gi-outside-'))
    try {
      expect(isGitIgnored('.local/', { root: outside })).toBeNull()
      expect(isGitIgnored('.local/', { root: ROOT })).toBe(true)
    } finally {
      rmSync(outside, { recursive: true, force: true })
    }
  })

  it('@guard-red-sample 调用侧豁免只认 === true：非 git 环境下 tmp- 目录仍报红', () => {
    // tmp-hygiene 的承重语义。这里故意把 root 指到仓库外的非 git 目录：
    // 若有人把调用侧改成 !== false（把 null 当豁免），本条立刻红。
    const outside = mkdtempSync(path.join(tmpdir(), 'gi-nongit-'))
    mkdirSync(path.join(outside, 'tmp-residue'))
    try {
      const hits = scan({ root: outside, watched: ['.'] })
      expect(hits.map((h) => h.name)).toContain('tmp-residue')
    } finally {
      rmSync(outside, { recursive: true, force: true })
    }
  })
})
