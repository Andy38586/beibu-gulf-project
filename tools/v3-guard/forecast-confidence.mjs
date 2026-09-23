#!/usr/bin/env node
/**
 * forecast-confidence.mjs — 「默认置信度」不得同名异值守卫。
 *
 * 为什么需要：`DEFAULT_CONFIDENCE` 曾在前端 `shared/constants/forecast.ts`（0.8，UI 滑块默认
 * 阈值）与后端 `common/constants/forecast.constants.ts`（1.0，入参非法时的兜底值）各写一份且
 * 同名——两个值语义不同，却被同一个名字串起来：改任一侧都没有守卫报差异，读代码的人也会
 * 误以为它们同源（审查 923 记为「同名异值」）。
 *
 * 处置（2026-09-23）：后端那份改名 FALLBACK_CONFIDENCE，**值不动**（零行为变化）；本守卫钉住
 * 两侧的名字与值——任一侧被改名/改值，或后端又冒出同名 DEFAULT_CONFIDENCE（回流），一律红。
 *
 * 用法：node tools/v3-guard/forecast-confidence.mjs   （违例 exit 1）
 */
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')

export const FE_FILE = 'frontend/src/shared/constants/forecast.ts'
export const BE_FILE = 'backend/src/common/constants/forecast.constants.ts'

/**
 * 纯函数便于单测：两文件文本 → 问题列表（空数组 = 通过）
 * @param {string} feText 前端 forecast.ts 文本
 * @param {string} beText 后端 forecast.constants.ts 文本
 * @returns {string[]}
 */
export function auditForecastConfidence(feText, beText) {
  const problems = []

  if (!/export const DEFAULT_CONFIDENCE = 0\.8\b/.test(feText)) {
    problems.push(
      `${FE_FILE}：DEFAULT_CONFIDENCE 不再是 0.8（UI 滑块默认阈值）——` +
        '改值属口径变更，须同步本守卫与后端注释'
    )
  }
  if (!/export const FALLBACK_CONFIDENCE = 1\b/.test(beText)) {
    problems.push(
      `${BE_FILE}：FALLBACK_CONFIDENCE 不再是 1.0（入参非法时的兜底值）——同上，改值须同步`
    )
  }
  if (/export const DEFAULT_CONFIDENCE\b/.test(beText)) {
    problems.push(
      `${BE_FILE}：又出现与前端同名的 DEFAULT_CONFIDENCE——同名异值回流，` +
        '后端那份必须叫 FALLBACK_CONFIDENCE（语义是"入参非法时的兜底"）'
    )
  }
  return problems
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
if (isMain) {
  const feText = readFileSync(path.join(ROOT, FE_FILE), 'utf8')
  const beText = readFileSync(path.join(ROOT, BE_FILE), 'utf8')
  const problems = auditForecastConfidence(feText, beText)
  if (problems.length > 0) {
    console.error('[forecast-confidence] FAIL：')
    for (const p of problems) console.error(`  · ${p}`)
    process.exit(1)
  }
  console.log(
    '[forecast-confidence] OK：前端 DEFAULT_CONFIDENCE=0.8（UI 默认阈值）与后端 ' +
      'FALLBACK_CONFIDENCE=1.0（非法入参兜底）各守其名其值'
  )
}
