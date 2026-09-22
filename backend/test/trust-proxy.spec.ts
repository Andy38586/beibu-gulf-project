import { readFileSync } from 'node:fs'
import path from 'node:path'

import { describe, expect, it } from 'vitest'

import { resolveTrustProxyHops } from '../src/common/utils/trust-proxy'

// 接线断言：解析函数有单测还不够——main.ts 里少一次 `http.set('trust proxy', …)`
// 调用，限流键与 secure 推定照样退化（d058 失效形态）。源码级断言钉住接线：
// 删掉该行本用例即红（否则"删修复全绿"）。
// 路径相对 vitest 的 cwd（backend/）；不用 import.meta——后端 tsconfig 是 CJS 模块口径。
const MAIN_TS = readFileSync(path.resolve(process.cwd(), 'src/main.ts'), 'utf8')

// trust proxy 跳数解析。老 Express 时代有 app.test.js 的
// describe('app - trust proxy (REQ-6)')；Nest 迁移时丢失，本件补解析层用例。
// 「两个不同来源 IP 计入两个桶」的端到端断言需起服务，留待联调窗口。
describe('resolveTrustProxyHops（d058）', () => {
  it('缺省/非法值回落 1（nginx→nest 一跳）', () => {
    expect(resolveTrustProxyHops(undefined)).toBe(1)
    expect(resolveTrustProxyHops('')).toBe(1) // Number('') 是 0，空串按未设置
    expect(resolveTrustProxyHops('  ')).toBe(1)
    expect(resolveTrustProxyHops('abc')).toBe(1)
    expect(resolveTrustProxyHops('-1')).toBe(1)
    expect(resolveTrustProxyHops('Infinity')).toBe(1)
  })

  it('0 = 显式不信任代理（不能被 || 1 吞掉）', () => {
    expect(resolveTrustProxyHops('0')).toBe(0)
  })

  it('显式正整型跳数原样生效', () => {
    expect(resolveTrustProxyHops('1')).toBe(1)
    expect(resolveTrustProxyHops('2')).toBe(2)
  })

  it('接线断言：main.ts 必须真的把 trust proxy 设到 Express 实例上（删该行即红）', () => {
    expect(MAIN_TS).toMatch(
      /http\.set\(\s*'trust proxy',\s*resolveTrustProxyHops\(process\.env\.TRUST_PROXY_HOPS\)\s*\)/
    )
  })
})
