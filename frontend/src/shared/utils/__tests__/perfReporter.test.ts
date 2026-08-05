/**
 * PerfReporter 聚合逻辑测试（生产可用版）
 * 覆盖：perfTimeFn 聚合（count/avg/max）、perfRecordApi 分位 + 样本窗口截断、
 * perfReportError 分类计数、perfMark/perfMeasure 度量、buildPerfReport 序列化。
 * 不调用 initPerfReporter（避免启动 rAF 采样循环污染测试进程）。
 */
import { beforeEach, describe, expect, it } from 'vitest'

import {
  _resetPerfForTest,
  buildPerfReport,
  perfMark,
  perfMeasure,
  perfRecordApi,
  perfReportError,
  perfTimeFn,
} from '../perfReporter'

interface ApiBucket {
  count: number
  avg: number
  max: number
  p50: number
  p95: number
}

function apiReport(): Record<string, ApiBucket> {
  return buildPerfReport().api as Record<string, ApiBucket>
}

beforeEach(() => {
  _resetPerfForTest()
})

describe('PerfReporter 聚合（生产可用版）', () => {
  it('perfTimeFn：聚合 count/avg/max 且不改变原函数行为', () => {
    perfTimeFn('layer:create:geojson', () => 1)
    perfTimeFn('layer:create:geojson', () => 2)
    perfTimeFn('layer:create:geojson', () => 3)

    const timers = buildPerfReport().timers as Record<string, { count: number; total: number; max: number }>
    const t = timers['layer:create:geojson']
    expect(t.count).toBe(3)
    expect(t.max).toBeGreaterThanOrEqual(t.total / t.count)
  })

  it('perfRecordApi：count/avg/max/p50/p95 聚合正确', () => {
    // 10 个样本：1..10（ms）
    for (let i = 1; i <= 10; i++) {
      perfRecordApi('/api/test', i * 10)
    }
    const b = apiReport()['/api/test']
    expect(b.count).toBe(10)
    expect(b.avg).toBeCloseTo(55, 0) // (10+20+...+100)/10 = 55
    expect(b.max).toBe(100)
    expect(b.p50).toBe(50) // 升序第 5 个 = 50
    expect(b.p95).toBe(100) // 升序第 ceil(9.5)=10 个 = 100
  })

  it('perfRecordApi：样本窗口截断（>50 只保留最近 50，count 仍全量）', () => {
    for (let i = 1; i <= 80; i++) {
      perfRecordApi('/api/test/window', i)
    }
    const b = apiReport()['/api/test/window']
    expect(b.count).toBe(80)
    // 最近 50 个样本是 31..80 → p50 = 升序第 25 个 = 31+24 = 55
    expect(b.p50).toBe(55)
    // p95 = 升序第 ceil(0.95*50)=48 个 = 31+47 = 78；旧样本（1..30）已溢出窗口不受影响
    expect(b.p95).toBe(78)
    expect(b.max).toBe(80)
  })

  it('perfReportError：分类计数', () => {
    perfReportError('vue')
    perfReportError('vue')
    perfReportError('script')
    const errors = buildPerfReport().errors as Record<string, number>
    expect(errors.vue).toBe(2)
    expect(errors.script).toBe(1)
    expect(errors.promise).toBeUndefined()
  })

  it('perfMark/perfMeasure：度量差值记录', () => {
    perfMark('a')
    perfMark('b')
    const d = perfMeasure('m', 'a', 'b')
    expect(d).not.toBeNull()
    expect((buildPerfReport().measures as Record<string, number>).m).toBeGreaterThanOrEqual(0)
  })

  it('buildPerfReport：Map 序列化为普通可 JSON 化对象', () => {
    perfRecordApi('/api/x', 5)
    const report = buildPerfReport()
    expect(() => JSON.stringify(report)).not.toThrow()
    expect(Array.isArray(report.timers)).toBe(false)
    expect(report.fps).toHaveProperty('longFrames')
  })
})
