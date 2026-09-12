import { Logger } from '@nestjs/common'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { CspReportController, extractFirstReport } from '../src/csp-report/csp-report.controller'

describe('CSP 违规上报接收端点（审查 z153）', () => {
  let ctrl: CspReportController
  let warn: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-09-12T00:00:00Z'))
    ctrl = new CspReportController()
    const logger = (ctrl as unknown as { logger: Logger }).logger
    warn = vi.spyOn(logger, 'warn').mockImplementation(() => undefined)
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  const post = (body: unknown): void =>
    (ctrl as unknown as { report: (b: unknown) => void }).report({ body } as never)

  describe('extractFirstReport 归一化（两种上报格式）', () => {
    it('report-uri 格式（横线命名字段）', () => {
      expect(
        extractFirstReport({
          'csp-report': {
            'document-uri': 'https://x/y',
            'violated-directive': 'script-src',
            'blocked-uri': 'https://evil/a.js',
          },
        })
      ).toEqual({
        documentUri: 'https://x/y',
        directive: 'script-src',
        blockedUri: 'https://evil/a.js',
      })
    })

    it('report-to / Reporting API 格式（数组 + 驼峰字段）', () => {
      expect(
        extractFirstReport([
          {
            type: 'csp-violation',
            body: {
              documentURL: 'https://x/y',
              effectiveDirective: 'connect-src',
              blockedURL: 'https://t0.tianditu.gov.cn/',
            },
          },
        ])
      ).toEqual({
        documentUri: 'https://x/y',
        directive: 'connect-src',
        blockedUri: 'https://t0.tianditu.gov.cn/',
      })
    })

    it('非法形状一律返回 null（不抛）', () => {
      for (const bad of [undefined, null, {}, [], 'str', 42, { 'csp-report': 'x' }]) {
        expect(extractFirstReport(bad)).toBeNull()
      }
    })

    it('字段超长被截断（防日志被单条报告撑爆）', () => {
      const r = extractFirstReport({
        'csp-report': { 'document-uri': 'a'.repeat(500), 'violated-directive': 'img-src' },
      })
      expect(r?.documentUri).toHaveLength(201) // 200 + 省略号
      expect(r?.documentUri.endsWith('…')).toBe(true)
    })
  })

  describe('report() 行为', () => {
    it('合法报告 → 记一条 warn（含三项白名单字段）', () => {
      post({
        'csp-report': {
          'document-uri': 'https://x/y',
          'violated-directive': 'script-src',
          'blocked-uri': 'inline',
        },
      })
      expect(warn).toHaveBeenCalledTimes(1)
      const line = String(warn.mock.calls[0]?.[0])
      expect(line).toContain('directive=script-src')
      expect(line).toContain('blocked=inline')
      expect(line).toContain('doc=https://x/y')
    })

    it('缺字段仍记录（用占位符），不抛', () => {
      post({ 'csp-report': {} })
      expect(warn).toHaveBeenCalledTimes(1)
      expect(String(warn.mock.calls[0]?.[0])).toContain('(未提供)')
    })

    it('非法 body → 静默返回、不记日志（不构成日志注入面）', () => {
      post(undefined)
      post('not-json')
      post({ random: 'x' })
      expect(warn).not.toHaveBeenCalled()
    })

    it('日志配额：单窗口最多 60 条，超出只计数；下窗口补一条汇总', () => {
      const mk = (i: number) => ({ 'csp-report': { 'violated-directive': `d${i}` } })
      for (let i = 0; i < 75; i++) post(mk(i))
      expect(warn).toHaveBeenCalledTimes(60) // 75 条里只落 60 条

      // 跨窗口：先记上一窗口被抑制的数量，再恢复配额
      vi.setSystemTime(new Date('2026-09-12T00:01:30Z'))
      post(mk(999))
      expect(warn).toHaveBeenCalledTimes(62)
      expect(String(warn.mock.calls[60]?.[0])).toContain('另有 15 条报告因配额被抑制')
      expect(String(warn.mock.calls[61]?.[0])).toContain('directive=d999')
    })
  })
})
