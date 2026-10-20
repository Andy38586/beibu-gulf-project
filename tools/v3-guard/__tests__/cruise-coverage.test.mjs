import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

import { auditCoverage, auditLayerRules, parseRuleModules } from '../cruise-coverage.mjs'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const GUARD = path.resolve(HERE, '../cruise-coverage.mjs')
const ROOT = path.resolve(HERE, '../../..')

// 最小 cruise 配置**对象**（规则命名约定：business-cross-import-<目录名>）。
// W11 起对账读 require() 出来的真实配置对象，故 fixture 也必须是对象——
// 文本 fixture 会让"注释里的规则名"重新变成可命中项。
const CRUISE_OK = {
  forbidden: [
    {
      name: 'business-cross-import-flood-analysis',
      from: { path: '^frontend/src/business/flood-analysis/' },
      to: { pathNot: '^frontend/src/business/flood-analysis/' },
    },
    {
      name: 'business-cross-import-forecast',
      from: { path: '^frontend/src/business/forecast/' },
      to: { pathNot: '^frontend/src/business/forecast/' },
    },
  ],
}

describe('cruise-coverage：04-E2 规则集合 == 目录集合（z055）', () => {
  it('目录与规则一一对应时无问题', () => {
    const { problems, rules } = auditCoverage(CRUISE_OK, ['flood-analysis', 'forecast'])
    expect(problems).toEqual([])
    expect(rules).toEqual(['flood-analysis', 'forecast'])
  })

  it('@guard-red-sample 阳性对照①：新增业务目录未建规则必红（route-analysis 落地即无守护的回归形态）', () => {
    const { problems } = auditCoverage(CRUISE_OK, ['flood-analysis', 'forecast', 'route-analysis'])
    expect(problems.some((p) => p.includes('business/route-analysis 无互引守护规则'))).toBe(true)
  })

  it('阳性对照②：规则指向不存在的目录（幽灵规则）必红', () => {
    const { problems } = auditCoverage(CRUISE_OK, ['flood-analysis', 'forecast', 'site-selection'])
    expect(
      problems.some((p) => p.includes('幽灵规则') || p.includes('site-selection 无互引守护规则'))
    ).toBe(true)
  })

  it('规则名与 from 路径不一致时抛错（命名约定被破坏）', () => {
    const bad = {
      forbidden: [
        {
          name: 'business-cross-import-flood',
          from: { path: '^frontend/src/business/flood-analysis/' },
        },
      ],
    }
    expect(() => parseRuleModules(bad)).toThrow(/命名约定/)
  })

  it('🔴 不再数注释里的规则名：规则只剩在注释文本里即在册（W11）', () => {
    // 旧实现读配置**文本**做正则 ⇒ 规则名留在注释里照样命中，规则真被停用也不红。
    const commentedOut = {
      comment:
        "// { name: 'business-cross-import-forecast', from: { path: '^frontend/src/business/forecast/' } }",
      forbidden: CRUISE_OK.forbidden.slice(0, 1), // forecast 那条已从真实配置里拿掉
    }
    expect(parseRuleModules(commentedOut)).toEqual(['flood-analysis'])
    const { problems } = auditCoverage(commentedOut, ['flood-analysis', 'forecast'])
    expect(problems.some((p) => p.includes('business/forecast 无互引守护规则'))).toBe(true)
  })
})

describe('cruise-coverage：分层规则覆盖面（W61 M4：from.path 不许窄于它宣称的整层）', () => {
  // 最小配置：只放分层规则，不放 business 互引规则（本 describe 只测分层覆盖面）。
  const LAYER_OK = {
    forbidden: [
      { name: 'core-not-import-services', from: { path: '^frontend/src/core/' }, to: {} },
      { name: 'services-not-import-core', from: { path: '^frontend/src/services/' }, to: {} },
      { name: 'core-imports-business', from: { path: '^frontend/src/core/' }, to: {} },
      { name: 'services-imports-business', from: { path: '^frontend/src/services/' }, to: {} },
      { name: 'shared-not-import-core', from: { path: '^frontend/src/shared/' }, to: {} },
    ],
  }

  it('五条分层规则的 from.path 各覆盖其整层 ⇒ 无问题', () => {
    expect(auditLayerRules(LAYER_OK)).toEqual([])
  })

  it('@guard-red-sample 阳性对照：from.path 窄写成 core/map/ ⇒ 必红且点名该规则', () => {
    // W61 实测形态：规则名与 comment 仍宣称「core 层」，from.path 却只覆盖 core/map/，
    // 于是 core/config、core/layout 的反向边静默无人守——名实不符的假面。
    const narrowed = {
      forbidden: LAYER_OK.forbidden.map((r) =>
        r.name === 'core-not-import-services'
          ? { ...r, from: { path: '^frontend/src/core/map/' } }
          : r
      ),
    }
    const problems = auditLayerRules(narrowed)
    expect(problems).toHaveLength(1)
    expect(problems[0]).toContain('core-not-import-services')
    expect(problems[0]).toContain('^frontend/src/core/map/')
  })

  it('@guard-red-sample 阳性对照：分层规则被整条删掉 ⇒ 必红（在册性）', () => {
    const removed = {
      forbidden: LAYER_OK.forbidden.filter((r) => r.name !== 'services-not-import-core'),
    }
    const problems = auditLayerRules(removed)
    expect(problems.some((p) => p.includes('services-not-import-core') && p.includes('不在'))).toBe(
      true
    )
  })

  it('@guard-red-sample 端到端：真实配置里把某层 from.path 改窄 ⇒ 守卫本体 exit 1', () => {
    // M2 形态：main 不接 auditLayerRules 时，纯函数用例全绿而守卫本体静默放行——
    // 所以必须有一条起子进程的端到端断言钉住「接线」这件事（PD-2 M1 同型教训）。
    const src = fs.readFileSync(GUARD, 'utf8')
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'w61-m4-'))
    fs.mkdirSync(path.join(tmp, 'tools/v3-guard/lib'), { recursive: true })
    // 守卫本体按 `../../..` 反推仓库根，依赖须按同层级一起抄
    fs.copyFileSync(GUARD, path.join(tmp, 'tools/v3-guard/cruise-coverage.mjs'))
    fs.copyFileSync(
      path.join(path.dirname(GUARD), 'lib/input-set.mjs'),
      path.join(tmp, 'tools/v3-guard/lib/input-set.mjs')
    )
    fs.mkdirSync(path.join(tmp, 'frontend/src/business/flood-analysis'), { recursive: true })
    // 变异：把 `.dependency-cruiser.cjs` 里 core-not-import-services 的 from.path 改窄。
    // 定位方式与探针不同——这里读的是**被测守卫读的那份配置**，按 name 行往下找第一个 from 行。
    const cruiseSrc = fs.readFileSync(path.join(ROOT, '.dependency-cruiser.cjs'), 'utf8')
    const lines = cruiseSrc.split('\n')
    const nameIdx = lines.findIndex((l) => l.includes("name: 'core-not-import-services'"))
    expect(nameIdx).toBeGreaterThan(-1)
    let fromIdx = -1
    for (let i = nameIdx; i < Math.min(nameIdx + 8, lines.length); i++) {
      if (lines[i].includes('from: {')) {
        fromIdx = i
        break
      }
    }
    expect(fromIdx).toBeGreaterThan(-1)
    // prettier 已把 from 展开成多行（`from: {` 独占一行，path/pathNot 各占一行）。
    // 整块替换成单行窄口径：改 from 行 + 删掉紧随的 path 行与 pathNot 行。
    const indent = lines[fromIdx].match(/^\s*/)[0]
    lines[fromIdx] = `${indent}from: { path: '^frontend/src/core/map/' },`
    // 把 from 块内**所有续行**删到收尾 `},`：from: { / path / (注释) / pathNot / },
    // 行数取决于 prettier 何时把对象展开，所以按「见到收尾行」收口，不写死条数。
    let removed = 0
    while (fromIdx + 1 < lines.length) {
      if (lines[fromIdx + 1].trim() === '},') {
        lines.splice(fromIdx + 1, 1)
        removed += 1
        break
      }
      lines.splice(fromIdx + 1, 1)
      removed += 1
      if (removed > 8) break // 兜底：形状异常时别把整份配置吃空
    }
    expect(removed).toBeGreaterThan(1)
    const mutated = lines.join('\n')
    expect(mutated).not.toBe(cruiseSrc) // 变异必须真的发生
    expect(mutated).toContain("from: { path: '^frontend/src/core/map/' },")
    // 变异件必须仍是合法 JS：require 得起来，否则红的是语法错不是判据。
    // 用 `new Function` 编译（不执行）即可验语法；顶层 await 不会出现，安全。
    expect(
      () => new Function(mutated.replace('module.exports =', 'globalThis.__cruise ='))
    ).not.toThrow()
    // 守卫 main 用 createRequire(import.meta.url) 按**守卫文件位置**解析
    // path.join(ROOT, CRUISE_CONFIG)，而 ROOT = <tmp>/tools/v3-guard 的上两级 = <tmp>；
    // 但 createRequire 的基准是守卫文件自身 ⇒ 相对路径解析到 <tmp>/tools/v3-guard/。
    // 两处都写，任何一处解析策略变化都不至于让红变成「加载失败」。
    fs.writeFileSync(path.join(tmp, '.dependency-cruiser.cjs'), mutated)
    fs.writeFileSync(path.join(tmp, 'tools/v3-guard/.dependency-cruiser.cjs'), mutated)
    let code = 0
    let output = ''
    try {
      output = execFileSync('node', [path.join(tmp, 'tools/v3-guard/cruise-coverage.mjs')], {
        cwd: tmp,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
      })
    } catch (err) {
      code = err.status ?? -1
      output = `${err.stdout ?? ''}${err.stderr ?? ''}`
    }
    fs.rmSync(tmp, { recursive: true, force: true })
    expect(code).toBe(1)
    expect(output).toContain('core-not-import-services')
    expect(output).toContain('未覆盖整层')
  })
})
