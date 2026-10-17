import fs from 'node:fs'
import path from 'node:path'

import type { ExecutionContext } from '@nestjs/common'
import ts from 'typescript'
import { describe, expect, it } from 'vitest'

import { extractRequestToken } from '../src/common/utils/request-token'
import { AuthGuard } from '../src/modules/auth/guards/auth.guard'
import { resolveRequestOwner } from '../src/modules/task/utils/request-owner'

// U8：认证令牌提取（cookie 优先 / Bearer 兜底）此前在 AuthGuard 与 request-owner 各手抄一份。
// 失效面：两处顺序漂移 ⇒ 同一请求在「认证守卫」与「任务属主判定」被认成不同身份
// （守卫用 cookie 认成 A、属主用 Bearer 认成 B，或反之），且改一处漏一处时不会立刻红。

const HERE = __dirname
const SRC = path.resolve(HERE, '..', 'src')
const AUTHORITY = path.join(SRC, 'common', 'utils', 'request-token.ts')
const CONSUMERS = [
  path.join(SRC, 'modules', 'auth', 'guards', 'auth.guard.ts'),
  path.join(SRC, 'modules', 'task', 'utils', 'request-owner.ts'),
]

function parse(text: string): ts.SourceFile {
  return ts.createSourceFile('probe.ts', text, ts.ScriptTarget.Latest, true)
}

/** 统计「X.startsWith('Bearer ...')」调用行号（Bearer 兜底提取的唯一形态） */
function bearerStartsWith(sf: ts.SourceFile): number[] {
  const lines: number[] = []
  const visit = (node: ts.Node): void => {
    if (
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      node.expression.name.text === 'startsWith'
    ) {
      const arg = node.arguments[0]
      if (arg && ts.isStringLiteral(arg) && arg.text.startsWith('Bearer')) {
        lines.push(sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1)
      }
    }
    ts.forEachChild(node, visit)
  }
  visit(sf)
  return lines
}

/** 统计 auth_token 属性访问行号（cookie 提取的唯一形态） */
function cookieTokenAccess(sf: ts.SourceFile): number[] {
  const lines: number[] = []
  const visit = (node: ts.Node): void => {
    if (ts.isPropertyAccessExpression(node) && node.name.text === 'auth_token') {
      lines.push(sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1)
    }
    ts.forEachChild(node, visit)
  }
  visit(sf)
  return lines
}

/** 统计裸标识符调用 name(...) 行号 */
function plainCalls(sf: ts.SourceFile, name: string): number[] {
  const lines: number[] = []
  const visit = (node: ts.Node): void => {
    if (
      ts.isCallExpression(node) &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === name
    ) {
      lines.push(sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1)
    }
    ts.forEachChild(node, visit)
  }
  visit(sf)
  return lines
}

function sourceOf(file: string): string {
  return fs.readFileSync(file, 'utf8')
}

const AUTHORITY_SF = parse(sourceOf(AUTHORITY))
const CONSUMER_SFS = CONSUMERS.map((f) => ({ file: f, sf: parse(sourceOf(f)) }))

// 阳性对照：两处各手抄一份提取（本单元收口前的形态）
const HAND_WRITTEN_SAMPLE = [
  'const a = (req) => {',
  '  let token = req.cookies?.auth_token',
  '  if (!token) {',
  '    const header = req.headers.authorization',
  "    if (header && header.startsWith('Bearer ')) {",
  '      token = header.slice(7)',
  '    }',
  '  }',
  '}',
  'const b = (req) => {',
  '  let token = req.cookies?.auth_token',
  '  if (!token) {',
  '    const header = req.headers.authorization',
  "    if (header && header.startsWith('Bearer ')) {",
  '      token = header.slice(7)',
  '    }',
  '  }',
  '}',
].join('\n')

// 近失对照：注释、字符串、改名调用、别的头名一律不计数
const NEAR_MISS_SAMPLE = [
  '// let token = req.cookies?.auth_token',
  'const s = "header.startsWith(\'Bearer \')"',
  'const s2 = "req.cookies?.auth_token"',
  "if (header.startsWith('Basic ')) {}",
  'const extractRequestTokenX = (req) => req.cookies?.not_auth_token',
  'const extractRequestToken = 1',
].join('\n')

const MOCK_USER_B = {
  id: 'u-b',
  username: 'B',
  password: 'h',
  token_version: 0,
  created_at: null,
}

function contextOf(req: Record<string, unknown>): ExecutionContext {
  return { switchToHttp: () => ({ getRequest: () => req }) } as unknown as ExecutionContext
}

describe('认证令牌提取单一入口（U8）', () => {
  it('🔴 @guard-red-sample 提取顺序：cookie 优先、Bearer 兜底、皆无返回 undefined', () => {
    const cookie = { cookies: { auth_token: 'c-token' }, headers: {} } as never
    expect(extractRequestToken(cookie)).toBe('c-token')
    const bearer = { cookies: undefined, headers: { authorization: 'Bearer h-token' } } as never
    expect(extractRequestToken(bearer)).toBe('h-token')
    // cookie 与 Bearer 同时存在 ⇒ cookie 胜出（顺序即契约）
    const both = {
      cookies: { auth_token: 'c-token' },
      headers: { authorization: 'Bearer h-token' },
    } as never
    expect(extractRequestToken(both)).toBe('c-token')
    expect(extractRequestToken({ cookies: undefined, headers: {} } as never)).toBeUndefined()
    // 非 Bearer 方案不采信（避免把 Basic 头当令牌）
    expect(
      extractRequestToken({
        cookies: undefined,
        headers: { authorization: 'Basic aaa' },
      } as never)
    ).toBeUndefined()
  })

  it('两消费方认同一份提取：同一请求（cookie=B / header=A）在守卫与属主判定得到同一身份', async () => {
    process.env.JWT_SECRET = 'x'.repeat(64)
    const { generateToken } = await import('../src/common/utils/jwt.util')
    const tokenA = generateToken({ id: 'u-a', username: 'A' })
    const tokenB = generateToken({ id: 'u-b', username: 'B' })
    const req = {
      cookies: { auth_token: tokenB },
      headers: { authorization: `Bearer ${tokenA}` },
    }

    // 守卫侧：cookie 胜出 ⇒ 查库拿到 u-b，不是 u-a
    const guard = new AuthGuard({ findById: async () => MOCK_USER_B } as never)
    await expect(guard.canActivate(contextOf(req as never))).resolves.toBe(true)
    // 属主侧：同一请求必须也认 u-b（若两处顺序漂移，这里会得到 u-a）
    expect(resolveRequestOwner(req as never)).toBe('u-b')
  })

  it('🔴 @guard-red-sample 提取只许一份：两消费方都调 extractRequestToken，且不再局部读 auth_token / Bearer', () => {
    for (const { file, sf } of CONSUMER_SFS) {
      expect(plainCalls(sf, 'extractRequestToken')).toHaveLength(1)
      expect(cookieTokenAccess(sf)).toEqual([])
      expect(bearerStartsWith(sf)).toEqual([])
      expect(sourceOf(file)).toContain('request-token')
    }
    // 权威源自身就是这两条形态的唯一落点
    expect(cookieTokenAccess(AUTHORITY_SF)).toHaveLength(1)
    expect(bearerStartsWith(AUTHORITY_SF)).toHaveLength(1)
  })

  it('扫描器阳性对照：手抄两份提取能被数出 auth_token 2 处、Bearer 2 处', () => {
    const sf = parse(HAND_WRITTEN_SAMPLE)
    expect(cookieTokenAccess(sf)).toEqual([2, 11])
    expect(bearerStartsWith(sf)).toEqual([5, 14])
  })

  it('扫描器近失对照：注释/字符串/改名调用/别的头名一律不计数', () => {
    const sf = parse(NEAR_MISS_SAMPLE)
    expect(cookieTokenAccess(sf)).toEqual([])
    expect(bearerStartsWith(sf)).toEqual([])
    expect(plainCalls(sf, 'extractRequestToken')).toEqual([])
  })
})
