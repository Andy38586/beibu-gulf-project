/**
 * test-watchdog 自测：跳过治理 / 执行清单 / 空壳识别的纯判定 + CLI 缺结果文件。
 * 纯函数走合成 vitest 结果（快、确定）；CLI 缺结果这一副作用走子进程真实执行。
 */
import { execFileSync } from 'node:child_process'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

const require = createRequire(import.meta.url)
const wd = require('../scripts/test-watchdog.cjs')

const SCRIPT = fileURLToPath(new URL('../scripts/test-watchdog.cjs', import.meta.url))

// 构造一个最小 vitest JSON 结果：files = { 相对文件: [用例状态...] }
function makeResult(files) {
  const testResults = []
  let total = 0
  let passed = 0
  let pending = 0
  let failed = 0
  for (const [file, statuses] of Object.entries(files)) {
    const assertionResults = statuses.map((status, i) => ({
      status,
      title: `${file}#${i}`,
      fullName: `${file} case ${i}`,
    }))
    testResults.push({ name: file, assertionResults })
    for (const s of statuses) {
      total++
      if (s === 'passed') passed++
      else if (s === 'pending') pending++
      else if (s === 'failed') failed++
    }
  }
  return {
    numTotalTests: total,
    numPassedTests: passed,
    numPendingTests: pending,
    numFailedTests: failed,
    testResults,
  }
}

// 最小 project（evaluateProject 会把结果内路径相对化到 rootAbs；测试取空基准、直接用相对键）
const PROJECT = {
  root: '',
  include: ['test/**/*.spec.ts', 'test/**/*.e2e-spec.ts'],
  result: 'coverage/vitest-result.json',
  requireEnvToRunGated: 'V3_INTEGRATION_DB',
  allowSkipped: {
    'test/gated.e2e-spec.ts': { mode: 'gated', reason: '真库' },
    'test/data.spec.ts': { mode: 'data', max: 1, reason: '数据文件不入库' },
    // 条目级 env 覆盖：依赖合成夹具图（非项目级 V3_INTEGRATION_DB）
    'test/fixture.e2e-spec.ts': {
      mode: 'gated',
      env: 'V3_ROADS_FIXTURE',
      reason: '断言合成夹具图拓扑，夹具严禁灌真库',
    },
  },
}

function evalWith(files, opts = {}) {
  return wd.evaluateProject(PROJECT, makeResult(files), {
    rootAbs: '',
    env: opts.env ?? {},
    filesOnDisk: opts.filesOnDisk ?? Object.keys(files),
  })
}

describe('watchdog.evaluateProject —— 跳过治理（静默 skip≠绿）', () => {
  it('本地无门控环境变量：gated 跳过被允许，但显式计入 allowedSkips（非静默）', () => {
    const r = evalWith({ 'test/gated.e2e-spec.ts': ['pending', 'pending'] })
    expect(r.violations).toEqual([])
    expect(r.allowedSkips[0]).toMatchObject({
      file: 'test/gated.e2e-spec.ts',
      count: 2,
      mode: 'gated',
    })
  })

  it('注入：门控变量已设置（CI 承诺真库）却仍跳过 → GATED_SKIP_IN_REQUIRED_ENV 判红', () => {
    const r = evalWith(
      { 'test/gated.e2e-spec.ts': ['pending'] },
      { env: { V3_INTEGRATION_DB: '1' } }
    )
    expect(r.violations.map((v) => v.code)).toEqual(['GATED_SKIP_IN_REQUIRED_ENV'])
  })

  it('注入：白名单之外的文件出现跳过 → UNDECLARED_SKIP 判红（新增 .skip 必须登记）', () => {
    const r = evalWith({ 'test/random.spec.ts': ['pending'] })
    expect(r.violations.map((v) => v.code)).toEqual(['UNDECLARED_SKIP'])
  })

  // 条目级 env 覆盖（2026-09-15）：门控条件必须与该文件的实际依赖对齐——
  // 项目级变量已设、但本文件依赖的变量未设时，跳过应被允许（否则本地有真库时夹具套件必假红）。
  it('条目级 env 覆盖：项目级变量已设、本文件依赖的变量未设 → 跳过被允许（不误判）', () => {
    const r = evalWith(
      { 'test/fixture.e2e-spec.ts': ['pending', 'pending'] },
      { env: { V3_INTEGRATION_DB: '1' } }
    )
    expect(r.violations).toEqual([])
    expect(r.allowedSkips[0]).toMatchObject({
      file: 'test/fixture.e2e-spec.ts',
      count: 2,
      mode: 'gated',
      env: 'V3_ROADS_FIXTURE',
    })
  })

  it('条目级 env 覆盖：本文件依赖的变量已设却仍跳过 → GATED_SKIP_IN_REQUIRED_ENV 判红', () => {
    const r = evalWith(
      { 'test/fixture.e2e-spec.ts': ['pending'] },
      { env: { V3_INTEGRATION_DB: '1', V3_ROADS_FIXTURE: '1' } }
    )
    expect(r.violations.map((v) => v.code)).toEqual(['GATED_SKIP_IN_REQUIRED_ENV'])
    expect(r.violations[0].detail).toContain('V3_ROADS_FIXTURE')
  })

  it('data 型跳过在上限内放行；超过 max → DATA_SKIP_OVER_CAP 判红', () => {
    const ok = evalWith({ 'test/data.spec.ts': ['pending'] })
    expect(ok.violations).toEqual([])
    const over = evalWith({ 'test/data.spec.ts': ['pending', 'pending'] })
    expect(over.violations.map((v) => v.code)).toEqual(['DATA_SKIP_OVER_CAP'])
  })

  it('注入：有用例失败 → RESULT_FAILED_TESTS（纵深防御，不信任上游退出码）', () => {
    const r = evalWith({ 'test/a.spec.ts': ['passed', 'failed'] })
    expect(r.violations.map((v) => v.code)).toEqual(['RESULT_FAILED_TESTS'])
  })
})

describe('watchdog.evaluateProject —— 清单存在 ≠ 被执行', () => {
  it('磁盘有、结果无 → TEST_FILE_NOT_RUN（掉出 glob / 收集期崩 / 改名没跑）', () => {
    const r = evalWith(
      { 'test/ran.spec.ts': ['passed'] },
      { filesOnDisk: ['test/ran.spec.ts', 'test/ghost.spec.ts'] }
    )
    expect(r.violations.map((v) => v.code)).toEqual(['TEST_FILE_NOT_RUN'])
    expect(r.violations[0].file).toBe('test/ghost.spec.ts')
  })

  it('文件被收集但 0 用例 → EMPTY_SUITE', () => {
    const r = evalWith({ 'test/empty.spec.ts': [] })
    expect(r.violations.map((v) => v.code)).toEqual(['EMPTY_SUITE'])
  })
})

describe('watchdog.findEmptyTestBlocks —— 空壳用例静态识别', () => {
  it('命中空体（箭头/function），放过有断言或仅有注释外语句的用例', () => {
    const src = [
      "it('空', () => {})",
      "it('有货', () => { expect(1).toBe(1) })",
      "it('只有注释', () => { // 仅注释",
      '})',
      "test('function 形空', function () { });",
    ].join('\n')
    const hits = wd.findEmptyTestBlocks(src).map((h) => h.title)
    expect(hits).toEqual(['空', 'function 形空'])
  })
})

describe('watchdog CLI —— 没有结果文件不得视为通过', () => {
  it('结果 JSON 缺失 → exit 1 且提示先跑测试（杜绝「没跑」被当成绿）', () => {
    const dir = mkdtempSync(join(tmpdir(), 'wd-'))
    const cfg = join(dir, 'gate.json')
    // 指向一个不存在的结果文件
    writeFileSync(
      cfg,
      JSON.stringify({
        projects: { x: { root: dir, include: [], result: join(dir, 'nope.json') } },
      })
    )
    let code = 0
    let out = ''
    try {
      out = execFileSync('node', [SCRIPT, '--config', cfg], { encoding: 'utf8' })
    } catch (e) {
      code = e.status ?? -1
      out = `${e.stdout ?? ''}${e.stderr ?? ''}`
    }
    expect(code).toBe(1)
    expect(out).toContain('读不到')
  })
})
