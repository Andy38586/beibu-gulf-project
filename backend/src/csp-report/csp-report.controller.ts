import { Controller, HttpCode, Logger, Post, Req } from '@nestjs/common'
import { SkipThrottle } from '@nestjs/throttler'
import type { Request } from 'express'

/**
 * CSP 违规上报接收端点（审查 z153）。
 *
 * 为什么需要它：生产 CSP 是 `Report-Only` 却**没有 `report-uri`** ——
 * 等于装了探头没接记录仪：浏览器把违规报告发到不存在的路径，收集到零条数据，
 * 于是"收紧 connect-src"和"最终切强制"都失去依据（切强制前必须有报告数据兜底，
 * 否则漏配 = 生产白屏）。本端点即记录仪。
 *
 * ⚠️ 限流：与 health 同款**裸 `@SkipThrottle()`**。不得给它单开命名桶 ——
 * `@nestjs/throttler` 的命名桶作用于**全部**路由（既有路由靠逐个 `@SkipThrottle`
 * 选桶），新增一个桶等于给全站多套一道闸，得连带改 8 个 controller，风险远大于收益。
 * 代价是本端点不限流，用三件事兜住：
 *   ① 只读 3 个白名单字段，其余一律丢弃（不落盘、不回显）；
 *   ② 响应恒为 204 且无 body，不构成反射面；
 *   ③ 日志量硬上限（每窗口 `LOG_BUDGET_PER_WINDOW` 条），超出只累计计数。
 */
const LOG_BUDGET_PER_WINDOW = 60
const WINDOW_MS = 60_000
const MAX_FIELD_LEN = 200

/** 归一化后的报告（只保留排障必需的三项） */
export interface NormalizedCspReport {
  documentUri: string
  directive: string
  blockedUri: string
}

const clip = (v: unknown): string => {
  const s = typeof v === 'string' ? v : ''
  return s.length > MAX_FIELD_LEN ? `${s.slice(0, MAX_FIELD_LEN)}…` : s
}

const pick = (o: Record<string, unknown>, keys: string[]): string => {
  for (const k of keys) {
    const v = o[k]
    if (typeof v === 'string' && v !== '') return clip(v)
  }
  return ''
}

/**
 * 兼容两种上报格式并归一化：
 *   · `report-uri`（旧，Chromium/Firefox 均支持）：`{ "csp-report": {...} }`，字段横线命名
 *   · `report-to` / Reporting API：`[ { type, body: {...} } ]`，字段驼峰命名
 * 两者都可能出现，取第一条即可（同一次违规不会同时走两条通道）。
 */
export function extractFirstReport(body: unknown): NormalizedCspReport | null {
  const raw = Array.isArray(body) ? body[0] : body
  if (!raw || typeof raw !== 'object') return null
  const obj = raw as Record<string, unknown>
  const inner = obj['csp-report']
  const src: unknown = inner && typeof inner === 'object' ? inner : obj.body
  if (!src || typeof src !== 'object') return null
  const o = src as Record<string, unknown>
  return {
    documentUri: pick(o, ['document-uri', 'documentURL']),
    directive: pick(o, ['violated-directive', 'effective-directive', 'effectiveDirective']),
    blockedUri: pick(o, ['blocked-uri', 'blockedURL']),
  }
}

@SkipThrottle()
@Controller('csp-report')
export class CspReportController {
  private readonly logger = new Logger(CspReportController.name)
  private windowStart = 0
  private loggedInWindow = 0
  private suppressedInWindow = 0

  /** 返回 true 表示本窗口还有配额，可落盘 */
  private consumeBudget(now = Date.now()): boolean {
    if (now - this.windowStart >= WINDOW_MS) {
      if (this.suppressedInWindow > 0) {
        this.logger.warn(`[csp] 上一窗口另有 ${this.suppressedInWindow} 条报告因配额被抑制`)
      }
      this.windowStart = now
      this.loggedInWindow = 0
      this.suppressedInWindow = 0
    }
    if (this.loggedInWindow >= LOG_BUDGET_PER_WINDOW) {
      this.suppressedInWindow++
      return false
    }
    this.loggedInWindow++
    return true
  }

  @Post()
  @HttpCode(204)
  report(@Req() req: Request): void {
    const r = extractFirstReport(req.body)
    if (!r) return
    if (!this.consumeBudget()) return
    this.logger.warn(
      `[csp] 违规 directive=${r.directive || '(未提供)'} blocked=${r.blockedUri || '(未提供)'} doc=${r.documentUri || '(未提供)'}`
    )
  }
}
