import fs from 'node:fs'
import path from 'node:path'

import ts from 'typescript'
import { describe, expect, it } from 'vitest'

import { isUnitInterval } from '../src/modules/site-suitability/constants/unit-interval'
import { parseSuitabilityQuery } from '../src/modules/site-suitability/dto/site-suitability.dto'
import { parseWeights } from '../src/modules/site-suitability/services/scoring'

// U9：单位区间入参校验 \`!Number.isFinite(v) || v < 0 || v > 1\` 此前在
// parseResolution / parseMinLandFrac（dto）与 parseWeights（scoring）三处各手抄一份（dup 18×3）。
// 失效面：三份判据漂移 ⇒ 改一处漏两处，漏改的表现为静默放行非法入参（超范围分辨率、越界权重）。

const HERE = __dirname
const MODULE_DIR = path.resolve(HERE, '..', 'src', 'modules', 'site-suitability')
const AUTHORITY = path.join(MODULE_DIR, 'constants', 'unit-interval.ts')

function parse(text: string): ts.SourceFile {
  return ts.createSourceFile('probe.ts', text, ts.ScriptTarget.Latest, true)
}

/** 递归列出模块目录下的 .ts 文件（跳过测试目录；本目录内无） */
function listSources(dir: string): string[] {
  const out: string[] = []
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) out.push(...listSources(full))
    else if (entry.name.endsWith('.ts')) out.push(full)
  }
  return out
}

/**
 * 统计「手抄单位区间判据」的行号：if 条件里同时出现 \`!Number.isFinite(\`、\`< 0\`、\`> 1\`。
 * 只认这一形态；换成 isUnitInterval(v) 的写法即不计数（本单元收口后的形态）。
 */
function handwrittenUnitChecks(sf: ts.SourceFile): number[] {
  const lines: number[] = []
  const visit = (node: ts.Node): void => {
    if (ts.isIfStatement(node)) {
      const cond = node.expression.getText(sf)
      if (!/!\s*Number\.isFinite\(/.test(cond)) {
        // 继续下钻，if 里可能还嵌着别的 if
      } else if (/<\s*0/.test(cond) && />\s*1(?!\d)/.test(cond)) {
        lines.push(sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1)
      }
    }
    ts.forEachChild(node, visit)
  }
  visit(sf)
  return lines
}

/** 统计裸标识符调用 name(...) 的行号 */
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

const SOURCES = listSources(MODULE_DIR).map((file) => ({
  file,
  sf: parse(fs.readFileSync(file, 'utf8')),
}))

// 阳性对照：三处各手抄一份判据（本单元收口前的形态）
const HAND_WRITTEN_SAMPLE = [
  'const f = (v) => {',
  '  if (!Number.isFinite(v) || v < 0 || v > 1) return false',
  '}',
  'const g = (v) => {',
  '  if (!Number.isFinite(v) || v < 0 || v > 1) {',
  '    return false',
  '  }',
  '}',
  'const h = (v) => {',
  '  if (!Number.isFinite(v) || v < 0 || v > 1) {',
  '    return false',
  '  }',
  '}',
].join('\n')

// 近失对照：别的上界判据 / 缺有限性 / 注释 / 字符串 / 换写法一律不计数
const NEAR_MISS_SAMPLE = [
  'const a = (v) => { if (!Number.isFinite(v)) return false }',
  'const b = (v) => { if (v < 0 || v > 1) return false }',
  'const c = (v) => { if (!Number.isFinite(v) || v <= 0 || v >= 1) return false }',
  'const d = (v) => { if (!Number.isFinite(v) || v < 0 || v > 12) return false }',
  '// if (!Number.isFinite(v) || v < 0 || v > 1) return false',
  'const s = "if (!Number.isFinite(v) || v < 0 || v > 1) {}"',
  'const e = (v) => isUnitInterval(v)',
].join('\n')

describe('单位区间判据单一入口（U9）', () => {
  it('🔴 @guard-red-sample 单位区间判据只许一处：模块内不再手抄 !Number.isFinite(v) || v < 0 || v > 1', () => {
    const offenders: Array<{ file: string; lines: number[] }> = []
    for (const { file, sf } of SOURCES) {
      const lines = handwrittenUnitChecks(sf)
      if (lines.length > 0) offenders.push({ file: path.relative(MODULE_DIR, file), lines })
    }
    expect(offenders).toEqual([])
    // 权威源自身就是唯一落点，且三处消费方都经它
    const authority = SOURCES.find(({ file }) => file === AUTHORITY)
    expect(authority).toBeDefined()
    const consumerCalls = SOURCES.filter(({ file }) => file !== AUTHORITY).reduce(
      (sum, { sf }) => sum + plainCalls(sf, 'isUnitInterval').length,
      0
    )
    expect(consumerCalls).toBeGreaterThanOrEqual(3)
  })

  it('边界与等价性：isUnitInterval 与旧判据逐点同值（含 0/1 闭区间与越界）', () => {
    expect(isUnitInterval(0)).toBe(true)
    expect(isUnitInterval(1)).toBe(true)
    expect(isUnitInterval(0.5)).toBe(true)
    expect(isUnitInterval(-0.0000001)).toBe(false)
    expect(isUnitInterval(1.0000001)).toBe(false)
    expect(isUnitInterval(Number.NaN)).toBe(false)
    expect(isUnitInterval(Number.POSITIVE_INFINITY)).toBe(false)
    // 消费方在边界上的行为：0 与 1 放行（0 是 resolution/min_land_frac 的合法下界）
    expect(parseSuitabilityQuery({ resolution: '1' }).resolution).toBe(1)
    expect(parseSuitabilityQuery({ min_land_frac: '0' }).minLandFrac).toBe(0)
    expect(
      parseWeights({ inundation: 1, terrain: 0, land: 0, access: 0, demand: 0 }).inundation
    ).toBe(1)
  })

  it('三处消费方仍按原口径拒收非法入参', () => {
    expect(() => parseSuitabilityQuery({ resolution: '-1' })).toThrow(/resolution/)
    expect(() => parseSuitabilityQuery({ resolution: '2' })).toThrow(/resolution/)
    expect(() => parseSuitabilityQuery({ resolution: 'abc' })).toThrow(/resolution/)
    expect(() => parseSuitabilityQuery({ min_land_frac: '9' })).toThrow(/min_land_frac/)
    expect(() =>
      parseWeights({ inundation: 1.2, terrain: -0.2, land: 0, access: 0, demand: 0 })
    ).toThrow(/权重/)
    expect(() =>
      parseWeights({ inundation: Number.NaN, terrain: 0.2, land: 0.2, access: 0.2, demand: 0.2 })
    ).toThrow(/权重/)
  })

  it('扫描器阳性对照：手抄三份判据能被数出 3 处', () => {
    expect(handwrittenUnitChecks(parse(HAND_WRITTEN_SAMPLE))).toEqual([2, 5, 10])
  })

  it('扫描器近失对照：别的上界/缺有限性/注释/字符串/换写法一律不计数', () => {
    expect(handwrittenUnitChecks(parse(NEAR_MISS_SAMPLE))).toEqual([])
  })
})
