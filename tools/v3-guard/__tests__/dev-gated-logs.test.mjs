/**
 * dev-gated-logs 自测：DEV 门控 warn/error 必红；debug/info 门控不误红（a018）。
 */
import { describe, expect, it } from 'vitest'

import { auditDevGatedLogs } from '../dev-gated-logs.mjs'

const F = 'frontend/src/core/map/renderers/CesiumRenderer.ts'
const run = (text) => auditDevGatedLogs([{ path: F, text }])

describe('dev-gated-logs — 生产 warn/error 不得被 DEV 门控（a018）', () => {
  it('@guard-red-sample 块式门控 logger.error ⇒ 必红', () => {
    const problems = run("if (import.meta.env.DEV) {\n  logger.error('加载失败', e)\n}\n")
    expect(problems).toHaveLength(1)
    expect(problems[0]).toContain('生产 warn/error 被 import.meta.env.DEV 门控')
  })

  it('@guard-red-sample 单行式与 warn 形态 ⇒ 必红', () => {
    expect(run("if (import.meta.env.DEV) logger.warn('卸载失败', e)\n")).toHaveLength(1)
  })

  it('阳性对照：门控 logger.debug/info 不红（级别门控已在 logger 内部单点实现）', () => {
    expect(run("if (import.meta.env.DEV) {\n  logger.debug('entity 超 1000')\n}\n")).toEqual([])
    expect(run("if (import.meta.env.DEV) logger.info('dev only tip')\n")).toEqual([])
  })

  it('阳性对照：DEV 分支里做别的事（不是日志）不红', () => {
    expect(run('if (import.meta.env.DEV) {\n  window.__debug = true\n}\n')).toEqual([])
  })

  it('等价重构不误红：logger.warn 与 DEV 判据相邻但不同分支（不同 if）', () => {
    const text = [
      'if (import.meta.env.DEV) {',
      "  logger.debug('dev')",
      '}',
      "logger.warn('生产保留')",
      '',
    ].join('\n')
    // 窗口 3 行会看到 logger.warn ⇒ 这是已知漏口（守卫头部写明）：行数很近的"假近邻"会误报，
    // 真实代码里两者不同分支时至少隔 4 行。本用例固定当前行为，改动判据必须同时改这里。
    expect(run(text).length).toBe(1)
  })
})
