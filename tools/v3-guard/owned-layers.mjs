#!/usr/bin/env node
/**
 * owned-layers.mjs — 页面不得在卸载钩子里手写图层注销（结构约束的执行体）。
 *
 * 为什么：图层的「注册必注销」曾经靠每个页面自己写 onUnmounted + 手写 remove 维持，
 * 921→924 四轮都在同一个点复发（漏一个就跨路由残留）。改用 useOwnedLayers 之后，
 * 注销由作用域销毁统一负责，卸载钩子里**不该再有** remove 这个动作 —— 本守卫查的就是它。
 *
 * 口径（刻意收窄，避免误伤）：
 *   · 只看 `frontend/src/business/**` 下的 `.vue` 文件；
 *   · 只看 `onUnmounted` / `onBeforeUnmount` 的**块内**；
 *   · **主动清**不算违规 —— 例如渲染器切回 2D 时摘掉 3D 独占图层（`removeCesiumOnlyLayers`）
 *     写在自己的函数里、带注释说明，那是「现在就清」，不是「卸载时清」。
 *   · 注释行放过（否则文件头那句「页面不需要自己调 manager.remove」会被自己判违规）。
 *
 * 用法：node tools/v3-guard/owned-layers.mjs
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const BUSINESS = path.join(ROOT, 'frontend/src/business')

/** 棘轮基线：当前已知、待处理的例外（每清一处就删一项）。新增页面不得进本表。 */
export const BASELINE = []

const COMMENT = /^\s*(\/\/|\*|\/\*)/
const UNMOUNT_HEAD = /onUnmounted\s*\(|onBeforeUnmount\s*\(/

/** 收集 .vue 文件（相对路径 + 文本） */
export function collectPages(dir = BUSINESS) {
  const out = []
  const walk = (abs) => {
    let entries
    try {
      entries = fs.readdirSync(abs, { withFileTypes: true })
    } catch {
      return
    }
    for (const e of entries) {
      const p = path.join(abs, e.name)
      if (e.isDirectory()) {
        if (e.name !== '__tests__' && e.name !== 'node_modules') walk(p)
      } else if (e.name.endsWith('.vue')) {
        out.push({
          relPath: path.relative(ROOT, p).replace(/\\/g, '/'),
          text: fs.readFileSync(p, 'utf8'),
        })
      }
    }
  }
  walk(dir)
  return out.sort((a, b) => a.relPath.localeCompare(b.relPath))
}

/** 取每个卸载钩子的块（大括号配平），返回 [{ line, text }...] 的行数组 */
export function unmountBlocks(text) {
  const lines = text.split(/\r?\n/)
  const blocks = []
  for (let i = 0; i < lines.length; i++) {
    if (!UNMOUNT_HEAD.test(lines[i])) continue
    let depth = 0
    let started = false
    const buf = []
    for (let j = i; j < lines.length; j++) {
      for (const ch of lines[j]) {
        if (ch === '{') {
          depth++
          started = true
        } else if (ch === '}') depth--
      }
      buf.push({ line: j + 1, text: lines[j] })
      if (started && depth <= 0) break
    }
    blocks.push(buf)
  }
  return blocks
}

/** 审计：返回问题列表（空 = 通过） */
export function auditPages(pages, { baseline = BASELINE } = {}) {
  const problems = []
  for (const { relPath, text } of pages) {
    for (const block of unmountBlocks(text)) {
      for (const { line, text: t } of block) {
        if (COMMENT.test(t)) continue
        if (/\.remove\(/.test(t)) {
          if (baseline.includes(relPath)) continue
          problems.push(
            `${relPath}:${line} 在卸载钩子里手写图层注销 —— 应经 useOwnedLayers，由作用域销毁统一清`
          )
        }
      }
    }
  }
  return problems
}

function main() {
  const pages = collectPages()
  const problems = auditPages(pages)
  if (problems.length === 0) {
    console.log(`[owned-layers] OK：${pages.length} 个业务页面均未在卸载钩子里手写图层注销`)
    return
  }
  console.error(`[owned-layers] FAIL：${problems.length} 处`)
  for (const p of problems) console.error(`  - ${p}`)
  process.exit(1)
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
if (isMain) main()
