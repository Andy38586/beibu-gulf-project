import { describe, expect, it } from 'vitest'

import {
  auditFrontendContract,
  extractEnvDomainLists,
  extractFrontendDomains,
} from '../routes-audit.mjs'

// 与 backend/src/routes.manifest.ts 现网域集同构的最小样例（含基础设施探针 health）
const MANIFEST_DOMAINS = [
  'auth',
  'plans',
  'favorites',
  'forecast',
  'flood',
  'site-analysis',
  'route',
  'health',
]

const FRONTEND_SAMPLE = `
const MODULE_BY_PATH_PREFIX: Record<string, string> = {
  auth: 'auth',
  plans: 'plans',
  favorites: 'favorites',
  forecast: 'forecast',
  flood: 'flood',
  'site-analysis': 'site-analysis',
  route: 'route',
}
`

describe('extractFrontendDomains — 前端功能域清单解析', () => {
  it('解析全部键（含带连字符的 site-analysis）', () => {
    expect(extractFrontendDomains(FRONTEND_SAMPLE)).toEqual([
      'auth',
      'plans',
      'favorites',
      'forecast',
      'flood',
      'site-analysis',
      'route',
    ])
  })

  it('清单被改名/删除时抛错（守卫失效即红灯）', () => {
    expect(() => extractFrontendDomains('const FOO = 1')).toThrow(/MODULE_BY_PATH_PREFIX/)
  })
})

describe('extractEnvDomainLists — env 副本解析', () => {
  it('兼容 compose 默认值写法 ${VAR:-a,b}', () => {
    const lists = extractEnvDomainLists(
      'VITE_USE_NEST_MODULES: ${VITE_USE_NEST_MODULES:-auth,plans}'
    )
    expect(lists).toEqual([['auth', 'plans']])
  })

  it('兼容 CI 明值写法 VAR=a,b', () => {
    const lists = extractEnvDomainLists('VITE_USE_NEST_MODULES=auth,plans,flood')
    expect(lists).toEqual([['auth', 'plans', 'flood']])
  })
})

describe('auditFrontendContract — 前端契约联动审计', () => {
  const NO_ENV = []

  it('业务域全收录 → 无问题（health 属基础设施探针，不要求收录）', () => {
    expect(auditFrontendContract(FRONTEND_SAMPLE, NO_ENV, MANIFEST_DOMAINS)).toEqual([])
  })

  it('route 域漏收录 → 报问题（历史事故回归样例：漏配导致 dev 航线查询 404）', () => {
    const missing = FRONTEND_SAMPLE.replace("  route: 'route',\n", '')
    const problems = auditFrontendContract(missing, NO_ENV, MANIFEST_DOMAINS)
    expect(problems).toHaveLength(1)
    expect(problems[0]).toContain("'route'")
    expect(problems[0]).toContain('MODULE_BY_PATH_PREFIX')
  })

  it('前端残留 manifest 已无路由的过期域名 → 报问题', () => {
    const stale = FRONTEND_SAMPLE.replace("  route: 'route',", "  'old-domain': 'old-domain',")
    const problems = auditFrontendContract(stale, NO_ENV, MANIFEST_DOMAINS)
    expect(problems.some((p) => p.includes("'old-domain'"))).toBe(true)
  })

  it('env 副本含未知/过期域名 → 报问题（防 VITE_DATA_SOURCE 式僵尸残留）', () => {
    const problems = auditFrontendContract(
      FRONTEND_SAMPLE,
      [
        {
          file: 'docker-compose.yml',
          content: 'VITE_USE_NEST_MODULES: ${VITE_USE_NEST_MODULES:-auth,ghost}',
        },
      ],
      MANIFEST_DOMAINS
    )
    expect(problems).toHaveLength(1)
    expect(problems[0]).toContain('docker-compose.yml')
    expect(problems[0]).toContain("'ghost'")
  })

  it('env 副本未覆盖全部业务域 → 不报问题（部分回退 Express 是文档化的回滚开关）', () => {
    const problems = auditFrontendContract(
      FRONTEND_SAMPLE,
      [{ file: '.github/workflows/ci.yml', content: 'VITE_USE_NEST_MODULES=auth,plans' }],
      MANIFEST_DOMAINS
    )
    expect(problems).toEqual([])
  })
})
