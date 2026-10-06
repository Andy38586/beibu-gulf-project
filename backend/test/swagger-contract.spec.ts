/**
 * swagger-contract — 端点双向契约核对（b018，`npm run contract:check`）。
 *
 * 判据（双向，缺一即红）：
 *   ① 后端→前端：Swagger 文档每条 path 必须被前端 ENDPOINTS 声明，或逐条登记进
 *      `BACKEND_ONLY_PATHS`（每条给"为什么不走前端"的理由）；
 *   ② 前端→后端：前端 ENDPOINTS 每条 path 必须真实存在于 Swagger 文档
 *      （前端调用后端不存在的端点 = 契约单向）。
 *
 * 判据输入：真文档（`Test.createTestingModule(AppModule)` + `SwaggerModule.createDocument`，
 * 不 listen、不连库）+ 受版本控制的 `frontend/src/shared/constants/api.ts`。
 *
 * 已知边界（如实写）：Swagger 现无响应注解（无 `@ApiOkResponse`）⇒ **响应字段形状不在本判据面**，
 * 仍由前端 zod 运行时校验 + `types:check` 的 `@backend-contract` 反向核对承担；请求体形状由
 * Swagger 自身的 `@ApiProperty`（DTO 单源）承担。参数化段一律归一为 `{p}` 比对，不比对参数名。
 */
import fs from 'node:fs'
import path from 'node:path'

import { SwaggerModule } from '@nestjs/swagger'
import { Test } from '@nestjs/testing'
import { beforeAll, describe, expect, it } from 'vitest'

import { AppModule } from '../src/app.module'
import { COMPAT_ENDPOINTS } from '../src/routes.compat'
import { buildSwaggerConfig } from '../src/swagger'

const API_TS = path.resolve(__dirname, '../../frontend/src/shared/constants/api.ts')

/** 后端独有端点：前端不（应）调用，逐条给理由——未登记的后端端点即红（防悄悄新增面） */
const BACKEND_ONLY_PATHS: Record<string, string> = {
  '/health': '存活探针（compose/nginx 调用，前端不消费）',
  '/health/ready': '就绪探针（同上）',
  '/health/version': '版本探针（同上）',
  '/csp-report': '浏览器 CSP 上报（nginx report-uri 直通，无前端代码调用）',
  '/forecast': '前端零调用（2026-10-06 实测：ENDPOINTS 与调用点 0 命中）——保留端点',
  // Express 遗留兼容端点：权威登记在 backend/src/routes.compat.ts（不在此手抄第二份）
  ...Object.fromEntries(
    COMPAT_ENDPOINTS.map((e) => [
      normalizePath('/' + e.path.replace(/^nest-api\//, '')),
      '内部/兼容端点（Express 遗留，前端零消费；权威登记见 backend/src/routes.compat.ts）',
    ])
  ),
}

/** 参数化段归一：`{itemType}`/`${itemId}`/`:id` 一律折叠为 `{p}`（只比对形状，不比对参数名） */
export function normalizePath(p: string): string {
  return p
    .replace(/\$\{[^}]*\}/g, '{p}')
    .replace(/\{[^}]*\}/g, '{p}')
    .replace(/:[A-Za-z0-9_]+/g, '{p}')
}

/**
 * 全局前缀（main.ts `setGlobalPrefix('nest-api')`）：Swagger 路径带前缀、前端 ENDPOINTS
 * 存相对路径（前缀由 useApiRequest 按域拼接）⇒ 比对前统一剥掉。
 */
const GLOBAL_PREFIX = '/nest-api'

/**
 * 解析前端 ENDPOINTS 声明（文本级，够用且无编译依赖）：
 * 只取 `export const ENDPOINTS` … `} as const` 块内、非注释行上的字符串字面量与模板函数。
 */
export function parseFrontendEndpoints(text: string): string[] {
  const start = text.indexOf('export const ENDPOINTS')
  const end = text.indexOf('} as const', start)
  if (start < 0 || end < 0) return []
  const block = text.slice(start, end)
  const out: string[] = []
  for (const raw of block.split(/\r?\n/)) {
    const line = raw.trim()
    if (!line || line.startsWith('//') || line.startsWith('*') || line.startsWith('/*')) continue
    const literal = line.match(/:\s*'([^']+)'/)
    if (literal) {
      out.push(literal[1])
      continue
    }
    const template = line.match(/:\s*\([^)]*\)\s*=>\s*`([^`]+)`/)
    if (template) out.push(template[1])
  }
  return out.map(normalizePath)
}

export interface SwaggerContractInput {
  swaggerPaths: string[]
  frontendPaths: string[]
  backendOnly?: Record<string, string>
}

/** 审计纯函数：返回问题列表（空 = 通过） */
export function auditSwaggerContract({
  swaggerPaths,
  frontendPaths,
  backendOnly = {},
}: SwaggerContractInput): string[] {
  const problems: string[] = []
  const frontend = new Set(frontendPaths.map(normalizePath))
  const backend = new Set(
    swaggerPaths.map((p) =>
      normalizePath(p.startsWith(GLOBAL_PREFIX) ? p.slice(GLOBAL_PREFIX.length) : p)
    )
  )
  for (const p of backend) {
    if (!frontend.has(p) && !Object.hasOwn(backendOnly, p)) {
      problems.push(
        `后端→前端：Swagger 端点 ${p} 未在前端 ENDPOINTS 声明，也不在 BACKEND_ONLY_PATHS 登记 —— ` +
          '要么前端接入（ENDPOINTS 补条目），要么登记"为什么不走前端"'
      )
    }
  }
  for (const p of frontend) {
    if (!backend.has(p)) {
      problems.push(
        `前端→后端：ENDPOINTS 声明 ${p} 在 Swagger 文档中不存在 —— 前端在调不存在的端点`
      )
    }
  }
  return problems
}

describe('swagger-contract — 端点双向核对（b018）', () => {
  let doc: { paths?: Record<string, unknown> }
  let frontendPaths: string[] = []

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile()
    const app = moduleRef.createNestApplication()
    app.setGlobalPrefix('nest-api') // 与 main.ts 同序（前缀在 createDocument 前设置）
    doc = SwaggerModule.createDocument(app, buildSwaggerConfig())
    await app.close()
    frontendPaths = parseFrontendEndpoints(fs.readFileSync(API_TS, 'utf8'))
  }, 60000)

  it('@guard-red-sample 前端端点缺失于 Swagger ⇒ 必红', () => {
    const problems = auditSwaggerContract({
      swaggerPaths: ['/nest-api/auth/login'],
      frontendPaths: ['/auth/login', '/auth/ghost'],
    })
    expect(problems).toHaveLength(1)
    expect(problems[0]).toContain('前端→后端')
    expect(problems[0]).toContain('/auth/ghost')
  })

  it('@guard-red-sample 后端端点未声明且未登记 ⇒ 必红', () => {
    const problems = auditSwaggerContract({
      swaggerPaths: ['/nest-api/secret/endpoint'],
      frontendPaths: [],
    })
    expect(problems).toHaveLength(1)
    expect(problems[0]).toContain('后端→前端')
    expect(problems[0]).toContain('/secret/endpoint')
  })

  it('阳性对照：双向对齐（含 BACKEND_ONLY 登记与参数归一）⇒ 不红', () => {
    const problems = auditSwaggerContract({
      swaggerPaths: ['/nest-api/favorites/{itemType}/{itemId}', '/nest-api/health'],
      frontendPaths: ['/favorites/{p}/{p}'],
      backendOnly: { '/health': '探针' },
    })
    expect(problems).toEqual([])
  })

  it('真仓双向：Swagger ↔ 前端 ENDPOINTS 全对上（后端独有端点逐条登记）', () => {
    const swaggerPaths = Object.keys(doc.paths ?? {})
    // 反向空集防护：解析器若静默返回空 ⇒ 两处规模断言先红，而不是"0 problems"假绿
    expect(swaggerPaths.length).toBeGreaterThanOrEqual(25)
    expect(frontendPaths.length).toBeGreaterThanOrEqual(20)
    const problems = auditSwaggerContract({
      swaggerPaths,
      frontendPaths,
      backendOnly: BACKEND_ONLY_PATHS,
    })
    expect(problems, problems.join('\n')).toEqual([])
  })
})
