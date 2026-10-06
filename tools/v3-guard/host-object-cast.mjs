#!/usr/bin/env node
/**
 * host-object-cast.mjs — 禁止用 `as unknown as` 双断言往宿主对象挂属性（z043 收口）。
 *
 * 治什么（d134 实锤）：`(scene as unknown as { maximumScreenSpaceError: number })
 *   .maximumScreenSpaceError = 4` —— 双断言把一个**宿主对象上不存在的属性**写成了合法 TS，
 * 运行期四个月无声无效（Cesium 的 scene 没有这个属性）。类型系统在"写入不存在的属性"上
 * 本该拦人；`as unknown as` 把它变成了"看起来被批准的"绕过。
 *
 * 判据：生产代码（`frontend/src`、`backend/src`，排除 `__tests__`/`.test.`/`.spec.`）里
 *   `as unknown as` 的转型结果出现在**属性写入**左侧（`).prop =` / `).prop++` / `).prop--`）⇒ 红。
 *   允许的两种替代：① 声明扩展面（`declare module` / interface 声明合并）；
 *   ② 只读/可调用的能力探针（`(x as unknown as { m?: () => void }).m?.()` —— 不写属性）。
 *
 * 判据输入 = **索引**内容（`git grep --cached -l` + `git show :<path>`，AGENTS §5.4）；
 * 注释已剥离（历史注释里写着那条实锤，不该把注释判成违例——本守卫自身注释也含该形态）。
 *
 * 已知漏口（如实写）：跨语句的写入（先 `const g = x as unknown as G` 再 `g.p = 1`）看不到；
 * `Object.assign` / `Reflect.set` 型写入看不到；`.tsx` 与 `.mts` 未纳入（本仓无）。
 *
 * 用法：node tools/v3-guard/host-object-cast.mjs   # 违例 exit 1
 */
import { execFileSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const SCAN_DIRS = ['frontend/src', 'backend/src']

/** 测试文件不进判据面（夹具给 mock 挂属性是正常操作） */
const TEST_PATH = /(__tests__|\.test\.|\.spec\.)/
/** 剥离行注释与块注释（保留换行数，便于报行号） */
export function stripComments(text) {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
    .split(/\r?\n/)
    .map((l) => l.replace(/\/\/.*$/, ''))
    .join('\n')
}

/**
 * 审计纯函数：`files` = [{path, text}]（索引内容）。
 * @returns {string[]} 问题列表（空 = 通过）
 */
export function auditHostObjectCasts(files) {
  const problems = []
  const WRITE_RE = /as unknown as\b[\s\S]{0,200}?\)\s*\.\s*[\w$]+\s*(?:=[^=]|\+\+|--)/g
  for (const { path: rel, text } of files) {
    if (TEST_PATH.test(rel)) continue
    const code = stripComments(text)
    for (const m of code.matchAll(WRITE_RE)) {
      const line = code.slice(0, m.index).split(/\r?\n/).length
      const snippet = m[0].replace(/\s+/g, ' ').trim().slice(0, 90)
      problems.push(
        `${rel}:${line} 用 \`as unknown as\` 往宿主对象写属性（${snippet}）—— ` +
          `该属性在本体类型上不存在，运行期可能无声无效；改用 declare module 声明扩展面，` +
          `或只做可调用的能力探针（不写属性）`
      )
    }
  }
  return problems
}

/** 候选文件：索引里含 `as unknown as` 的 .ts/.vue */
export function collectCandidates() {
  let listing = ''
  try {
    listing = execFileSync(
      'git',
      ['grep', '--cached', '-l', '-e', 'as unknown as', '--', ...SCAN_DIRS],
      { cwd: ROOT, encoding: 'utf8' }
    )
  } catch {
    return []
  }
  const out = []
  for (const rel of listing.split(/\r?\n/)) {
    const p = rel.trim()
    if (!p || !/\.(ts|vue)$/.test(p)) continue
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
  const files = collectCandidates()
  const problems = auditHostObjectCasts(files)
  if (problems.length) {
    console.error('[host-object-cast] 未通过：双断言写宿主对象属性')
    for (const p of problems) console.error('  ✗ ' + p)
    process.exit(1)
  }
  const prod = files.filter((f) => !TEST_PATH.test(f.path)).length
  console.log(
    `[host-object-cast] OK：${prod} 份生产文件（候选 ${files.length} 份，测试夹具不计）` +
      `无「as unknown as 写属性」✓`
  )
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
if (isMain) main()
