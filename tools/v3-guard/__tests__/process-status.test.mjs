import { createRequire } from 'node:module'

import { describe, expect, it } from 'vitest'

const require = createRequire(import.meta.url)
const { toExitCode } = require('../../../scripts/lib/process-status.cjs')

describe('toExitCode — 子进程退出码映射（P1-07 壳化修复的可执行证据）', () => {
  it('正常退出码原样透传', () => {
    expect(toExitCode({ status: 0 })).toBe(0)
    expect(toExitCode({ status: 2 })).toBe(2)
  })

  it('被信号杀死（status=null, signal=SIGKILL, error=undefined）→ 1（原实现得 0 = PASS）', () => {
    expect(toExitCode({ status: null, signal: 'SIGKILL', error: undefined })).toBe(1)
  })

  it('spawn 失败（error 非空、status=null、无 signal）→ 1', () => {
    expect(toExitCode({ status: null, signal: null, error: new Error('ENOENT') })).toBe(1)
  })

  it('无任何信息 → 0', () => {
    expect(toExitCode({})).toBe(0)
    expect(toExitCode()).toBe(0)
  })
})
