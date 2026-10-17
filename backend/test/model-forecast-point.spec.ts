import fs from 'node:fs'
import path from 'node:path'

import ts from 'typescript'
import { describe, expect, it } from 'vitest'

import { interpolateMonthly } from '../src/modules/forecast/services/model-loader'

// U11：模型点输出形状 `{ time; value; type; reliability; lower?; upper? }` 此前在
// model-loader.ts 三处各写一份匿名字面量（interpolateMonthly 返回值 / 其内部 out 数组 /
// ModelForecast.forecast，dup 22×3）。三处虽由 tsc 结构兼容兜住，但「一份声明」本身无信号：
// 新增第四处同形字面量、或把某处的 lower/upper 去掉，都不会红。
// 失效面：形状漂移 ⇒ getModelForecast 的 reliability/lower/upper 透传与消费方（forecast.service
// 把模型段并入 ForecastPoint[]）静默错位。

const HERE = __dirname
const SERVICES_DIR = path.resolve(HERE, '..', 'src', 'modules', 'forecast', 'services')
const AUTHORITY = path.join(SERVICES_DIR, 'model-loader.ts')

function parse(text: string): ts.SourceFile {
  return ts.createSourceFile('probe.ts', text, ts.ScriptTarget.Latest, true)
}

/** 统计「匿名模型点形状字面量」的行号：TypeLiteral 成员名同时含六个键 */
function shapedTypeLiterals(sf: ts.SourceFile): number[] {
  const lines: number[] = []
  const visit = (node: ts.Node): void => {
    if (ts.isTypeLiteralNode(node)) {
      const names = node.members
        .map((m) => m.name?.getText(sf))
        .filter((n): n is string => typeof n === 'string')
      // 恰好六键：多一个键即另一种形状（不计数），少一个键也不是同形
      if (
        names.length === 6 &&
        ['time', 'value', 'type', 'reliability', 'lower', 'upper'].every((k) => names.includes(k))
      ) {
        lines.push(sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1)
      }
    }
    ts.forEachChild(node, visit)
  }
  visit(sf)
  return lines
}

/** 取具名接口的成员名集合（排序后），用于锁「声明内容」而非声明写法 */
function interfaceMemberNames(sf: ts.SourceFile, name: string): string[] {
  const names: string[] = []
  const visit = (node: ts.Node): void => {
    if (ts.isInterfaceDeclaration(node) && node.name.text === name) {
      for (const m of node.members) {
        const n = m.name?.getText(sf)
        if (typeof n === 'string') names.push(n)
      }
    }
    ts.forEachChild(node, visit)
  }
  visit(sf)
  return names.sort()
}

/** 统计类型引用 ModelForecastPoint 的行号 */
function namedTypeRefs(sf: ts.SourceFile, name: string): number[] {
  const lines: number[] = []
  const visit = (node: ts.Node): void => {
    if (ts.isTypeReferenceNode(node) && node.typeName.getText(sf) === name) {
      lines.push(sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1)
    }
    ts.forEachChild(node, visit)
  }
  visit(sf)
  return lines
}

const AUTHORITY_SF = parse(fs.readFileSync(AUTHORITY, 'utf8'))

const SRC_DIR = path.resolve(HERE, '..', 'src')

/** 递归列出 src 下的 .ts 文件 */
function listSources(dir: string): string[] {
  const out: string[] = []
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) out.push(...listSources(full))
    else if (entry.name.endsWith('.ts')) out.push(full)
  }
  return out
}

// 阳性对照：三处各写一份匿名字面量（本单元收口前的形态）
const HAND_WRITTEN_SAMPLE = [
  'function a(): Array<{',
  '  time: string',
  '  value: number',
  '  type: string',
  '  reliability: number',
  '  lower?: number',
  '  upper?: number',
  '}> { return [] }',
  'const b: Array<{',
  '  time: string',
  '  value: number',
  '  type: string',
  '  reliability: number',
  '  lower?: number',
  '  upper?: number',
  '}> = []',
  'interface C {',
  '  forecast: Array<{',
  '    time: string',
  '    value: number',
  '    type: string',
  '    reliability: number',
  '    lower?: number',
  '    upper?: number',
  '  }>',
  '}',
].join('\n')

// 近失对照：具名引用 / 缺 lower / Record 索引 / 注释 / 字符串 / 别的形状一律不计数
const NEAR_MISS_SAMPLE = [
  'const a: ModelForecastPoint[] = []',
  'const b: Array<{ time: string; value: number; type: string; reliability: number }> = []',
  'const c: Record<string, unknown> = {}',
  '// Array<{ time: string; value: number; type: string; reliability: number; lower?: number; upper?: number }>',
  'const s = "Array<{ time: string; value: number; type: string; reliability: number; lower?: number; upper?: number }>"',
  'interface D {',
  '  forecast: Array<{',
  '    time: string',
  '    value: number',
  '    type: string',
  '    reliability: number',
  '    lower?: number',
  '    upper?: number',
  '    extra?: number',
  '  }>',
  '}',
].join('\n')

describe('模型点输出形状单一入口（U11）', () => {
  it('🔴 @guard-red-sample 模型点形状只许一处声明：services 内不再有匿名同形字面量', () => {
    const offenders: Array<{ file: string; lines: number[] }> = []
    for (const entry of fs.readdirSync(SERVICES_DIR, { withFileTypes: true })) {
      if (!entry.isFile() || !entry.name.endsWith('.ts')) continue
      const file = path.join(SERVICES_DIR, entry.name)
      const lines = shapedTypeLiterals(parse(fs.readFileSync(file, 'utf8')))
      if (lines.length > 0) offenders.push({ file: entry.name, lines })
    }
    expect(offenders).toEqual([])
    // 全后端也不得有第二份匿名同形字面量（本单元只收口 model-loader，但形态是全后端唯一）
    const repoWide: Array<{ file: string; lines: number[] }> = []
    const files = listSources(SRC_DIR)
    for (const file of files) {
      const lines = shapedTypeLiterals(parse(fs.readFileSync(file, 'utf8')))
      if (lines.length > 0) repoWide.push({ file: path.relative(SRC_DIR, file), lines })
    }
    expect(files.length).toBeGreaterThan(50)
    expect(repoWide).toEqual([])
    // 权威件里唯一声明被三处引用（返回值 / out 数组 / ModelForecast.forecast）
    expect(namedTypeRefs(AUTHORITY_SF, 'ModelForecastPoint')).toHaveLength(3)
    // 声明内容（六键）不得增删；成员顺序不锁（等价重构须绿）
    expect(interfaceMemberNames(AUTHORITY_SF, 'ModelForecastPoint')).toEqual([
      'lower',
      'reliability',
      'time',
      'type',
      'upper',
      'value',
    ])
  })

  it('行为等价：interpolateMonthly 返回点仍是原四键（可选上下界缺省不出现）', () => {
    const out = interpolateMonthly(
      [
        { time: '2027-06', value: 100 },
        { time: '2027-12', value: 130 },
      ],
      '2027-01'
    )
    expect(out.map((p) => p.time)).toEqual([
      '2027-06',
      '2027-07',
      '2027-08',
      '2027-09',
      '2027-10',
      '2027-11',
      '2027-12',
    ])
    expect(Object.keys(out[0])).toEqual(['time', 'value', 'type', 'reliability'])
    expect(out[0]).toEqual({ time: '2027-06', value: 100, type: 'forecast', reliability: 1 })
  })

  it('扫描器阳性对照：手抄三份形状能被数出 3 处', () => {
    expect(shapedTypeLiterals(parse(HAND_WRITTEN_SAMPLE))).toEqual([1, 9, 18])
  })

  it('扫描器近失对照：具名引用/缺键/Record/注释/字符串一律不计数', () => {
    expect(shapedTypeLiterals(parse(NEAR_MISS_SAMPLE))).toEqual([])
  })
})
