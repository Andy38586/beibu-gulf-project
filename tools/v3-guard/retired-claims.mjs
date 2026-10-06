#!/usr/bin/env node
/**
 * retired-claims.mjs — 退役机制不得以「在役」口吻残留在生产/构建/部署/门禁面（z040 收口）。
 *
 * 治什么：Express→Nest、FastAPI→PostGIS 两次退役后，配置/注释/脚本里仍散落无标记的
 * 「在役口吻」引用（实测：Dockerfile 写着 algorithm-service 为独立容器、README 说 dev:all
 * 会拉 uvicorn、premerge 还在跑已删除的 test:algorithm）。幽灵声明会把后来者送到不存在的
 * 服务上——这是 RC1「权威源」在退役面的化身。
 *
 * 判据：判据面内出现无歧义退役词条（FastAPI | flood-online | algorithm-service）的行，
 * 必须处于「退役语气」：token 行是注释时，看**同一连续注释块**；否则只看同行。标记词 =
 * 退役|下线|已删|删除|移除|不再|勿重新添加|勿再引入|阶段4|历史|归档|保留不删|对齐|下沉|
 * 取代|此前|原为|原…|死代码|废弃|冻结|迁移|校正|遗留|改为|搬迁|拆出。
 * 例外：① 含 `.venv` 的行——离线 Python 工具链按 setup-runtime.ps1 的保留决策继续使用
 * `backend/algorithm-service/.venv` 这个**路径**（目录已不在版本控制内，非在役服务声明）；
 * ② `tools/doc-system/baseline/**` 与派生的 `kp-map.json`——逐字节冻结旧文本，不可改不可判。
 *
 * 判据输入 = 索引（`git grep --cached` + `git show :<path>`，AGENTS §5.4）。
 *
 * 已知漏口（如实写）：
 *   · `docs/**` 不在判据面：文档层的退役口径由 doc-ref-check / C3 迁移与人工「废弃声明」
 *     先例（专6 指标 8.1、专8 指标 7.3）管辖；CHANGELOG / docs/archive 是历史留档，按设计不判。
 *   · `Express` 不入词条：Nest 的现行 HTTP 适配器就叫 express（NestExpressApplication /
 *     express.Express），字面无法与已退役的 Express 服务区分——该面靠人工复核。
 *   · 「6 档」不判：2026-10-06 实测「6 档参考表」是活概念（flood.service/repository 在用），
 *     不是幽灵词（z040 原始清单里的「6 档」项据此作废）。
 *   · 注释块内的标记为块内任意行放行：标记在块首、正文在块尾描述在役机制，本判据看不出。
 *   · 本守卫本体与其红样夹具含词条字面（否则自指），按文件除外。
 *
 * 用法：node tools/v3-guard/retired-claims.mjs   # 违例 exit 1
 */
import { execFileSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')

/** 判据面：生产/构建/部署/门禁的活执行面 */
const SURFACES = [
  'frontend/src',
  'backend',
  'scripts',
  'tools',
  '.husky',
  '.github',
  '.env.example',
  'frontend/.env.example',
  'Dockerfile',
  'nginx.conf',
  'docker-entrypoint.sh',
  'docker-compose.yml',
  'docker-compose.v3.yml',
  'README.md',
  'frontend/vite.config.js',
]

/** 冻结基线 / 派生件 / 本守卫自身（含红样夹具）：按设计不判 */
const EXCLUDES = [
  'tools/doc-system/baseline',
  'tools/doc-system/kp-map.json',
  'tools/v3-guard/retired-claims.mjs',
  'tools/v3-guard/__tests__/retired-claims.test.mjs',
]

const TOKEN_RE = /FastAPI|flood-online|algorithm-service/
const MARKER_RE =
  /(退役|下线|已删|删除|移除|不再|勿重新添加|勿再引入|阶段\s?4|历史|归档|保留不删|对齐|下沉|取代|此前|原为|原\s|死代码|废弃|冻结|迁移|校正|遗留|改为|搬迁|拆出)/
const VENV_RE = /\.venv/
const COMMENT_RE = /^\s*(#|\/\/|--|\*|\/\*)/

/**
 * 审计纯函数：`files` = [{path, text}]（索引内容）。
 * @returns {string[]} 问题列表（空 = 通过）
 */
export function auditRetiredClaims(files) {
  const problems = []
  for (const { path: rel, text } of files) {
    const lines = text.split(/\r?\n/)
    lines.forEach((line, i) => {
      if (!TOKEN_RE.test(line)) return
      if (VENV_RE.test(line)) return
      let context = line
      if (COMMENT_RE.test(line)) {
        let lo = i
        while (lo > 0 && COMMENT_RE.test(lines[lo - 1])) lo--
        let hi = i
        while (hi < lines.length - 1 && COMMENT_RE.test(lines[hi + 1])) hi++
        context = lines.slice(lo, hi + 1).join('\n')
      }
      if (MARKER_RE.test(context)) return
      problems.push(
        `${rel}:${i + 1} 退役机制以在役口吻残留（缺退役/历史标记）—— 「${line
          .trim()
          .slice(0, 80)}」`
      )
    })
  }
  return problems
}

/** 候选文件：索引里命中三个词条的判据面文件 */
export function collectCandidates() {
  let listing = ''
  try {
    listing = execFileSync(
      'git',
      [
        'grep',
        '--cached',
        '-l',
        '-e',
        'FastAPI',
        '-e',
        'flood-online',
        '-e',
        'algorithm-service',
        '--',
        ...SURFACES,
        ...EXCLUDES.map((e) => `:(exclude)${e}`),
      ],
      { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 << 20 }
    )
  } catch {
    return []
  }
  const out = []
  for (const rel of listing.split(/\r?\n/)) {
    const p = rel.trim()
    if (!p) continue
    try {
      out.push({
        path: p,
        text: execFileSync('git', ['show', `:${p}`], {
          cwd: ROOT,
          encoding: 'utf8',
          maxBuffer: 64 << 20,
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
  const problems = auditRetiredClaims(files)
  if (problems.length) {
    console.error(`[retired-claims] 未通过：${problems.length} 处退役机制以在役口吻残留`)
    for (const p of problems) console.error('  ✗ ' + p)
    process.exit(1)
  }
  console.log(
    `[retired-claims] OK：判据面 ${files.length} 份含退役词条的文件里，全部带退役/历史标记 ✓`
  )
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
if (isMain) main()
