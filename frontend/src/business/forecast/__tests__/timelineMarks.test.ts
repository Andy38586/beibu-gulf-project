/**
 * 必要性审判波次二·单元 G — 时间轴刻度域单源（../timeline）
 *
 * ForecastControlPanel.vue 原手抄三条公式：中点年 `Math.round((BASE_YEAR + END_YEAR) / 2)`、
 * YEAR_MARKS 的 step 字段 `(year - BASE_YEAR) * 12`、yearMarkPosition 的
 * `(year - BASE_YEAR) / (END_YEAR - BASE_YEAR)`（年模式）与 `(year - BASE_YEAR) * 12 / maxSteps`
 * （月模式）。三者现全部派生进 ../timeline 的 timelineYears() 与 yearMarkPosition()。
 *
 * 阳性对照（删/改任一即红）：
 * ① 面板重新手抄年数差 `(END_YEAR - BASE_YEAR)` 或中点 `(BASE_YEAR + END_YEAR) / 2` ⇒ 公式断言红
 * ② 面板重新定义本地 yearMarkPosition / MID_YEAR ⇒ 形态断言红
 * ③ 模板不再按 (year, isYearMode, maxSteps) 三元调用 ⇒ 模板调用形态断言红
 * ④ timeline 的 yearMarkPosition 不再经 currentTimeToStep 派生 ⇒ 内部引用断言红
 */
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import ts from 'typescript'
import { describe, expect, it } from 'vitest'

import { BASE_YEAR, END_YEAR } from '@/shared'

import {
  currentTimeToStep,
  monthMaxSteps,
  timelineYears,
  yearMarkPosition,
  yearMaxSteps,
} from '../timeline'

const HERE = dirname(fileURLToPath(import.meta.url))
const PANEL = join(HERE, '..', 'components', 'ForecastControlPanel.vue')
const TIMELINE = join(HERE, '..', 'timeline.ts')

/** .vue 只取 <script> 段（模板/CSS 不进 AST）；.ts 原样返回 */
function scriptOf(file: string): string {
  const text = readFileSync(file, 'utf8')
  if (!file.endsWith('.vue')) return text
  return [...text.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/g)].map((m) => m[1]).join('\n')
}

/** .vue 只取 <template> 段（模板调用形态只能文本匹配，AST 不解析模板） */
function templateOf(file: string): string {
  const text = readFileSync(file, 'utf8')
  // 贪婪取到最后一个 </template>：组件内还有 <template #icon> 插槽段，非贪婪会在此截断
  return [...text.matchAll(/<template>([\s\S]*)<\/template>/g)].map((m) => m[1]).join('\n')
}

/** 剥块注释与整行行注释 —— 公式判据不许被注释里的同名写法污染 */
function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .map((line) => line.replace(/^\s*\/\/.*$/, ''))
    .join('\n')
}

function moduleSpecifiers(source: string): string[] {
  const sf = ts.createSourceFile('x.ts', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  const out: string[] = []
  const visit = (node: ts.Node): void => {
    if (
      (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
      node.moduleSpecifier &&
      ts.isStringLiteralLike(node.moduleSpecifier)
    ) {
      out.push(node.moduleSpecifier.text)
    }
    ts.forEachChild(node, visit)
  }
  visit(sf)
  return out
}

describe('刻度域单源：年份与位置公式一律派生自 ../timeline', () => {
  it('面板不再手抄年数差与中点年（公式形态断言）', () => {
    const src = stripComments(scriptOf(PANEL))
    // 手抄形态：年数差 / 中点年；派生后两者都不应出现
    expect(src).not.toMatch(/\(\s*END_YEAR\s*-\s*BASE_YEAR\s*\)/)
    expect(src).not.toMatch(/\(\s*BASE_YEAR\s*\+\s*END_YEAR\s*\)\s*\/\s*2/)
    // 本地函数/常量也不再存在
    expect(src).not.toMatch(/function\s+yearMarkPosition/)
    expect(src).not.toMatch(/\bMID_YEAR\b/)
  })

  it('面板经 ../timeline 取年份域与位置函数（import + 模板三元调用）', () => {
    expect(moduleSpecifiers(scriptOf(PANEL))).toContain('../timeline')
    expect(scriptOf(PANEL)).toMatch(/timelineYears\(\)/)

    const tmpl = templateOf(PANEL)
    const calls = [...tmpl.matchAll(/yearMarkPosition\(m\.year,\s*isYearMode,\s*maxSteps\)/g)]
    // 两处调用：t-tick--end 判据 + left 百分比
    expect(calls.length).toBe(2)
    // 阳性对照：模板里刻度确实在渲染（不是空分母）
    expect(tmpl).toMatch(/v-for="\(m, i\) in YEAR_MARKS"/)
  })

  it('timeline 的 yearMarkPosition 经 currentTimeToStep 派生，不复制步长公式', () => {
    const src = stripComments(readFileSync(TIMELINE, 'utf8'))
    expect(src).toMatch(/export function yearMarkPosition\(/)
    expect(src).toMatch(/currentTimeToStep\(/)
    // 不得再出现 (year - BASE_YEAR) * 12 这类手抄月步公式
    expect(src).not.toMatch(/\(year\s*-\s*BASE_YEAR\s*\)\s*\*\s*12/)
  })

  it('timelineYears 由 BASE_YEAR / END_YEAR 派生（同值陷阱：中点 2026 恰等于派生值，行为断言无法区分写死）', () => {
    const src = stripComments(readFileSync(TIMELINE, 'utf8'))
    const fn = src.match(/export function timelineYears\(\)[\s\S]*?\n\}/)
    expect(fn).not.toBeNull()
    const body = fn![0]
    expect(body).toMatch(/BASE_YEAR/)
    expect(body).toMatch(/END_YEAR/)
    // 只咬「两端都取自权威源 + 无写死年份」，不咬记法（Math.round((a+b)/2) 与 (a+b)*0.5 皆合法）
    // 写死年份字面量（如 2026）即违约 —— 行为断言在此处是同值盲区
    expect(body).not.toMatch(/\b\d{4}\b/)
  })
})

describe('timelineYears / yearMarkPosition 行为（派生自权威源 BASE_YEAR / END_YEAR）', () => {
  it('刻度年份 = 起止年 + 取整中点年（不手抄年份字面量）', () => {
    const years = timelineYears()
    const mid = Math.round((BASE_YEAR + END_YEAR) / 2)
    expect(years).toEqual([BASE_YEAR, mid, END_YEAR])
    // 阳性对照：年数差非零，位置分母才有效
    expect(yearMaxSteps()).toBeGreaterThan(0)
    expect(monthMaxSteps()).toBeGreaterThan(0)
  })

  it('年模式位置：起止 0% / 100%，中点落 50%', () => {
    const max = yearMaxSteps()
    const mid = Math.round((BASE_YEAR + END_YEAR) / 2)
    expect(yearMarkPosition(BASE_YEAR, true, max)).toBe(0)
    expect(yearMarkPosition(END_YEAR, true, max)).toBe(100)
    expect(yearMarkPosition(mid, true, max)).toBeCloseTo(50, 10)
  })

  it('月模式位置 = 该年 1 月月步 / 月步上限（与 currentTimeToStep 逐值一致）', () => {
    const max = monthMaxSteps()
    const mid = Math.round((BASE_YEAR + END_YEAR) / 2)
    for (const year of [BASE_YEAR, mid, END_YEAR]) {
      const expected = (currentTimeToStep(`${year}-01`, false) / max) * 100
      expect(yearMarkPosition(year, false, max)).toBe(expected)
    }
    // 终点刻度：末月步落 100%
    expect(yearMarkPosition(END_YEAR, false, max)).toBe(
      ((monthMaxSteps() - 11) / monthMaxSteps()) * 100
    )
  })
})
