#!/usr/bin/env node
/**
 * vue-list-keys.mjs — Vue 列表 key 不得用数组下标或时间戳/随机数（c023 收口）。
 *
 * 治什么：`v-for` 的 `:key` 用下标（`:key="index"`）或 `Date.now()` / `Math.random()` 时，
 * 列表一变（过滤/重排/插入）DOM 复用就会错位——输入框里刚敲的字会跟着"跑到"另一行、
 * 展开态挂到别人身上。这类缺陷不会在 console 报错，只会在用户手上出现。
 *
 * 判据（**只看模板里的 v-for 元素**，逐元素解析，不 blanket 扫全文）：
 *   ① `v-for="(item, idx) in list"` 的 `:key` 若**只**用 idx（`idx` 或 `` `${…}-${idx}` `` 的插值段）
 *      ⇒ 红；
 *   ② `:key` 里出现 `Date.now(` / `Math.random(` ⇒ 红（每次都新 key = 每帧重建 DOM）。
 *
 * 判据输入 = **索引**内容（`git grep --cached` 列候选 + `git show :<path>` 读内容，AGENTS §5.4）。
 * 已知漏口（如实写）：跨元素拼接（`v-for` 与 `:key` 分属父子元素）、`:key` 写在 `v-bind` 对象里
 * （`v-bind="{ key: idx }"`）、以及自定义渲染函数（`.tsx`）不在判据面内。
 *
 * 用法：node tools/v3-guard/vue-list-keys.mjs   # 违例 exit 1
 */
import { execFileSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const SCAN_DIR = 'frontend/src'

/** 元素标签：`<div … v-for … :key …>`（同标签内两个属性都要在） */
const TAG_RE = /<([A-Za-z][\w-]*)\b((?:"[^"]*"|'[^']*'|[^>"'])*)>/g
/** v-for 的第二个参数（下标变量）：带括号与不带括号两种写法 */
const INDEX_RE = /v-for\s*=\s*"\(?\s*[\w$]+\s*,\s*([\w$]+)\s*\)?\s*(?:in|of)\b/
const KEY_RE = /:key\s*=\s*"([^"]*)"/g

/**
 * 审计一份模板文本。返回问题列表（空 = 通过）。纯函数，便于单测。
 * @param {string} relPath
 * @param {string} text
 */
export function auditVueTemplate(relPath, text) {
  const problems = []
  const lines = text.split(/\r?\n/)
  const lineOf = (idx) => text.slice(0, idx).split(/\r?\n/).length
  for (const tag of text.matchAll(TAG_RE)) {
    const attrs = tag[2]
    const idxVar = (attrs.match(INDEX_RE) || [])[1]
    const keys = [...attrs.matchAll(new RegExp(KEY_RE.source, 'g'))].map((m) => m[1].trim())
    if (!keys.length) continue
    for (const key of keys) {
      const line = lineOf(tag.index)
      if (/Date\.now\s*\(|Math\.random\s*\(/.test(key)) {
        problems.push(
          `${relPath}:${line} :key 用时间戳/随机数（${key}）—— 每次都新 key = 每帧重建 DOM`
        )
        continue
      }
      if (!idxVar) continue
      // 下标只作为等式或插值段出现才算违例：`idx` / `${…-${idx}}` / `${idx}-…`
      const usedAsSegment = new RegExp(`\\$\\{[^}]*\\b${idxVar}\\b[^}]*\\}`).test(key)
      const onlyIndex = key === idxVar
      if (onlyIndex || usedAsSegment) {
        problems.push(
          `${relPath}:${line} :key 含数组下标（${key}）—— 过滤/重排后 DOM 复用错位；` +
            `改用稳定字段组合（如 id / name+field）`
        )
      }
    }
  }
  return problems
}

/** 候选文件：索引里含 `:key=` 的 .vue（git grep 粗筛；无命中 ⇒ 空数组） */
export function collectVueFiles() {
  let listing = ''
  try {
    listing = execFileSync('git', ['grep', '--cached', '-l', '-e', ':key=', '--', SCAN_DIR], {
      cwd: ROOT,
      encoding: 'utf8',
    })
  } catch {
    return []
  }
  const out = []
  for (const rel of listing.split(/\r?\n/)) {
    const p = rel.trim()
    if (!p || !/\.vue$/.test(p)) continue
    try {
      out.push({
        path: p,
        text: execFileSync('git', ['show', `:${p}`], {
          cwd: ROOT,
          encoding: 'utf8',
          maxBuffer: 32 << 20,
        }),
      })
    } catch {
      // 索引读不到：跳过（不假装读过）
    }
  }
  return out
}

function main() {
  const files = collectVueFiles()
  const problems = files.flatMap((f) => auditVueTemplate(f.path, f.text))
  if (problems.length) {
    console.error('[vue-list-keys] 未通过：列表 key 不稳定')
    for (const p of problems) console.error('  ✗ ' + p)
    process.exit(1)
  }
  console.log(`[vue-list-keys] OK：${files.length} 份含 :key 的 .vue 全部使用稳定 key ✓`)
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
if (isMain) main()
