import { describe, expect, it } from 'vitest'

import {
  auditFrontendContract,
  auditProductionDefault,
  auditTestSideDefaults,
  extractDockerfileDefaultModules,
  extractEnvDomainLists,
  extractFrontendDomains,
  parseRoutesFromLines,
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

  it('兼容测试侧两种写法：vi.stubEnv 与 vitest env 明值', () => {
    expect(extractEnvDomainLists(`vi.stubEnv('VITE_USE_NEST_MODULES', 'auth,plans')`)).toEqual([
      ['auth', 'plans'],
    ])
    expect(extractEnvDomainLists(`env: { VITE_USE_NEST_MODULES: 'auth,route', }`)).toEqual([
      ['auth', 'route'],
    ])
  })
})

describe('auditFrontendContract — 前端契约联动审计', () => {
  const NO_ENV = []

  it('业务域全收录 → 无问题（health 属基础设施探针，不要求收录）', () => {
    expect(auditFrontendContract(FRONTEND_SAMPLE, NO_ENV, MANIFEST_DOMAINS)).toEqual([])
  })

  it('@guard-red-sample route 域漏收录 → 报问题（历史事故回归样例：漏配导致 dev 航线查询 404）', () => {
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

describe('auditProductionDefault — 生产镜像域清单必须全覆盖', () => {
  const dockerfileWith = (domains) =>
    `RUN echo hi\nARG VITE_USE_NEST_MODULES=${domains}\nENV VITE_USE_NEST_MODULES=$VITE_USE_NEST_MODULES\n`
  const ALL_BIZ = 'auth,plans,favorites,forecast,flood,site-analysis,route'

  it('域清单全覆盖 → 无问题（health 属探针域，不要求出现）', () => {
    expect(auditProductionDefault(dockerfileWith(ALL_BIZ), MANIFEST_DOMAINS)).toEqual([])
  })

  it('@guard-red-sample 生产默认漏 site-suitability/diversion → 报问题（2026-10-01 事故回归样例）', () => {
    const problems = auditProductionDefault(dockerfileWith(ALL_BIZ), [
      ...MANIFEST_DOMAINS,
      'site-suitability',
      'diversion',
    ])
    expect(problems).toHaveLength(2)
    expect(problems.join(' ')).toContain('site-suitability')
    expect(problems.join(' ')).toContain('diversion')
  })

  it('生产默认含未知/过期域 → 报问题', () => {
    const problems = auditProductionDefault(dockerfileWith(ALL_BIZ + ',ghost'), MANIFEST_DOMAINS)
    expect(problems).toHaveLength(1)
    expect(problems[0]).toContain("'ghost'")
  })

  it('ARG 被改名/删除 → 抛错（守卫失效即红灯，不允许静默跳过）', () => {
    expect(() => extractDockerfileDefaultModules('ENV FOO=bar')).toThrow(/VITE_USE_NEST_MODULES/)
  })

  it('数值形态正确解析（含连字符域、忽略 ENV 展开行）', () => {
    expect(extractDockerfileDefaultModules(dockerfileWith(ALL_BIZ))).toEqual([
      'auth',
      'plans',
      'favorites',
      'forecast',
      'flood',
      'site-analysis',
      'route',
    ])
  })
})

describe('auditTestSideDefaults — 测试侧域清单必须全覆盖（F13 / 1004-T2 上闸）', () => {
  const ALL_BIZ = 'auth,plans,favorites,forecast,flood,site-analysis,route'
  const stub = (domains) => `vi.stubEnv('VITE_USE_NEST_MODULES', '${domains}')`
  const vitestEnv = (domains) => `env: { VITE_USE_NEST_MODULES: '${domains}', }`

  it('两副本全覆盖 → 无问题（health 属探针域，不要求出现）', () => {
    const copies = [
      { file: 'frontend/test/setup.ts', content: stub(ALL_BIZ) },
      { file: 'frontend/vitest.config.js', content: vitestEnv(ALL_BIZ) },
    ]
    expect(auditTestSideDefaults(copies, MANIFEST_DOMAINS)).toEqual([])
  })

  it('@guard-red-sample 测试侧缺域 → 报问题（1004-F13 回归样例：缺 diversion ⇒ 测试回落 /api）', () => {
    const copies = [{ file: 'frontend/test/setup.ts', content: stub(ALL_BIZ) }]
    const problems = auditTestSideDefaults(copies, [...MANIFEST_DOMAINS, 'diversion'])
    expect(problems).toHaveLength(1)
    expect(problems[0]).toContain('setup.ts')
    expect(problems[0]).toContain("'diversion'")
  })

  it('测试侧含 manifest 已移除的死域 → 报问题（防 site-analysis 式残留继续存活）', () => {
    const copies = [{ file: 'frontend/vitest.config.js', content: vitestEnv(ALL_BIZ) }]
    const problems = auditTestSideDefaults(
      copies,
      MANIFEST_DOMAINS.filter((d) => d !== 'site-analysis')
    )
    expect(problems).toHaveLength(1)
    expect(problems[0]).toContain("'site-analysis'")
    expect(problems[0]).toContain('未知/过期域')
  })

  it('测试域开关被改名/删除 → 报问题（守卫不得静默跳过）', () => {
    const problems = auditTestSideDefaults(
      [{ file: 'frontend/test/setup.ts', content: 'const FOO = 1' }],
      MANIFEST_DOMAINS
    )
    expect(problems).toHaveLength(1)
    expect(problems[0]).toContain('未找到 VITE_USE_NEST_MODULES')
  })
})

// 「注入即红」：装饰器路径解析不得因引号风格静默置空（P1-11）——置空会让「生成」与「检查」一致地错
describe('parseRoutesFromLines — 装饰器路径解析', () => {
  const lines = (s) => s.split('\n')

  it("单引号 @Get('overview') → 保留子路径", () => {
    expect(parseRoutesFromLines(lines("@Get('overview')"), 'forecast')).toEqual([
      { method: 'GET', path: 'nest-api/forecast/overview' },
    ])
  })

  it('双引号 @Get("overview") → 保留子路径（原实现静默置空 → 永久假绿）', () => {
    expect(parseRoutesFromLines(lines('@Get("overview")'), 'forecast')).toEqual([
      { method: 'GET', path: 'nest-api/forecast/overview' },
    ])
  })

  it('反引号 @Get(`overview`) → 保留子路径', () => {
    expect(parseRoutesFromLines(lines('@Get(`overview`)'), 'forecast')).toEqual([
      { method: 'GET', path: 'nest-api/forecast/overview' },
    ])
  })

  it('无参 @Post() → 仅控制器前缀（合法形态）', () => {
    expect(parseRoutesFromLines(lines('@Post()'), 'plans')).toEqual([
      { method: 'POST', path: 'nest-api/plans' },
    ])
  })

  it("路径参数 @Delete(':id') → 原样保留", () => {
    expect(parseRoutesFromLines(lines("@Delete(':id')"), 'plans')).toEqual([
      { method: 'DELETE', path: 'nest-api/plans/:id' },
    ])
  })

  it('括号内是非字面量表达式 → 抛错（禁止静默置空）', () => {
    expect(() => parseRoutesFromLines(lines('@Get(prefix + "/x")'), 'forecast')).toThrow(
      /无法解析为路径字面量/
    )
  })
})
