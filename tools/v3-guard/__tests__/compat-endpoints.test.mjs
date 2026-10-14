// @vitest-environment node
/**
 * compat-endpoints — 内部/兼容端点登记守卫（1004-F14 · D26）。
 *
 * 测守卫本体的纯函数 `auditCompatEndpoints`（`tools/v3-guard/compat-endpoints.mjs`）：
 * 三条红样（manifest 缺登记端点 / 前端消费登记 URL 形态 / 权威源解析为空）+ 真仓阳性对照。
 */
import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

import { auditCompatEndpoints } from '../compat-endpoints.mjs'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..')
const COMPAT = readFileSync(path.join(ROOT, 'backend/src/routes.compat.ts'), 'utf8')
const MANIFEST = readFileSync(path.join(ROOT, 'backend/src/routes.manifest.ts'), 'utf8')

function walkFrontend(dir = path.join(ROOT, 'frontend/src'), out = []) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, e.name)
    if (e.isDirectory()) {
      if (['node_modules', 'dist', 'coverage', '__tests__'].includes(e.name)) continue
      walkFrontend(full, out)
    } else if (/\.(ts|vue|js|mjs)$/.test(e.name)) {
      out.push({ path: path.relative(ROOT, full), text: readFileSync(full, 'utf8') })
    }
  }
  return out
}

describe('compat-endpoints — 兼容端点登记一致性', () => {
  it('@guard-red-sample manifest 缺登记端点 ⇒ 必红（幽灵声明）', () => {
    const problems = auditCompatEndpoints({
      compatText: "export const COMPAT_ENDPOINTS = [{ method: 'GET', path: 'nest-api/ghost' }]",
      manifestText: '// 无此端点',
      frontendFiles: [],
    })
    expect(problems).toHaveLength(1)
    expect(problems[0]).toContain('幽灵声明')
  })

  it('@guard-red-sample 前端消费登记 URL 形态 ⇒ 必红（声明与现状分叉）', () => {
    const problems = auditCompatEndpoints({
      compatText:
        "export const COMPAT_ENDPOINTS = [{ method: 'POST', path: 'p', consumerRe: /\\/plans\\/[^'\"\\s`]*xiaoqu/ }]",
      manifestText: "{ method: 'POST', path: 'p' }",
      frontendFiles: [{ path: 'frontend/src/x.ts', text: "api.get('/plans/1/xiaoqu')" }],
    })
    expect(problems).toHaveLength(1)
    expect(problems[0]).toContain('前端消费')
  })

  it('@guard-red-sample 权威源解析为空 ⇒ 必红（分母归零不静默放行）', () => {
    const problems = auditCompatEndpoints({ compatText: '', manifestText: '', frontendFiles: [] })
    expect(problems).toHaveLength(1)
    expect(problems[0]).toContain('解析为空')
  })

  it('真仓当前 = 通过（阳性对照：登记端点齐全 + 前端零消费）', () => {
    expect(
      auditCompatEndpoints({
        compatText: COMPAT,
        manifestText: MANIFEST,
        frontendFiles: walkFrontend(),
      })
    ).toEqual([])
  })
})
