import { describe, expect, it } from 'vitest'

import { diffRoutes, parseRoutesFromLines } from '../routes-audit.mjs'

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

describe('diffRoutes — 契约双向差集（本守卫的核心判据，D1a 后为唯一判据）', () => {
  const r = (method, path) => ({ method, path })

  it('一致 ⇒ 两侧皆空（阳性对照：判据不是恒有输出）', () => {
    const same = [r('GET', 'nest-api/flood/x')]
    expect(diffRoutes(same, same)).toEqual({ missing: [], extra: [] })
  })

  it('@guard-red-sample 清单有而代码无 ⇒ missing 命中（路由被删却未同步清单）', () => {
    const problems = diffRoutes(
      [r('GET', 'nest-api/flood/x'), r('DELETE', 'nest-api/flood/gone')],
      [r('GET', 'nest-api/flood/x')]
    )
    expect(problems.missing).toEqual([r('DELETE', 'nest-api/flood/gone')])
    expect(problems.extra).toEqual([])
  })

  it('@guard-red-sample 代码有而清单无 ⇒ extra 命中（新增路由未随改动提交清单）', () => {
    const problems = diffRoutes(
      [r('GET', 'nest-api/flood/x')],
      [r('GET', 'nest-api/flood/x'), r('POST', 'nest-api/flood/new')]
    )
    expect(problems.extra).toEqual([r('POST', 'nest-api/flood/new')])
    expect(problems.missing).toEqual([])
  })

  it('@guard-red-sample 方法同名不同路径不得互相抵消（判据按 method+path 全键）', () => {
    const problems = diffRoutes([r('GET', 'nest-api/a')], [r('POST', 'nest-api/a')])
    expect(problems.missing).toEqual([r('GET', 'nest-api/a')])
    expect(problems.extra).toEqual([r('POST', 'nest-api/a')])
  })
})
