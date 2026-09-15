/**
 * merge-verdict 纯判定自测：堵「跳过检查却仍宣称 READY」的放行洞（EP-DYN）。
 */
import { createRequire } from 'node:module'

import { describe, expect, it } from 'vitest'

const require = createRequire(import.meta.url)
const { listVerificationSkipped, decideVerdict } = require('../scripts/lib/merge-verdict.cjs')

describe('listVerificationSkipped', () => {
  it('三项齐全 → 空（无跳过）', () => {
    expect(listVerificationSkipped({ tests: true, build: true, secretScan: true })).toEqual([])
  })
  it('逐项列出被关的验证', () => {
    expect(listVerificationSkipped({ tests: false, build: true, secretScan: false })).toHaveLength(
      2
    )
    expect(listVerificationSkipped({ tests: false, build: false, secretScan: false })).toHaveLength(
      3
    )
  })
})

describe('decideVerdict（三态，禁止「没检查=通过」）', () => {
  it('有 FAIL → BLOCKED(1)，优先级最高（即使同时跳过）', () => {
    expect(decideVerdict(2, ['测试'], false)).toEqual({ code: 1, verdict: 'BLOCKED' })
  })
  it('无 FAIL 但跳过验证且未显式确认 → PARTIAL(2)，不得放行', () => {
    expect(decideVerdict(0, ['测试', '生产构建'], false)).toEqual({ code: 2, verdict: 'PARTIAL' })
  })
  it('无 FAIL、验证齐全 → READY(0)', () => {
    expect(decideVerdict(0, [], false)).toEqual({ code: 0, verdict: 'READY' })
  })
  it('容错通道：跳过但 --acknowledge-skip → READY_ACK(0)，仍区分于完整 READY', () => {
    expect(decideVerdict(0, ['测试'], true)).toEqual({ code: 0, verdict: 'READY_ACK' })
    // 齐全时 ack 无意义，回到普通 READY
    expect(decideVerdict(0, [], true)).toEqual({ code: 0, verdict: 'READY' })
  })
})
