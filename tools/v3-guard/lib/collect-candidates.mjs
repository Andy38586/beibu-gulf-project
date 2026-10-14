/**
 * collect-candidates — 从 **git 索引**采集候选文件（不读工作树脏件，AGENTS §5.4）。
 *
 * 三个守卫（retired-claims / host-object-cast / dev-gated-logs）此前各自持一份**逐字同款**的
 * `collectCandidates()`（D22「判据基建家族」）——本件是它们的单一来源。
 * 三处差异只有：检索 token、pathspec、路径过滤；故参数化，逻辑（`git grep --cached -l`
 * 取清单 → `git show :<path>` 读索引内容 → 读不到则跳过）一字未改。
 */
import { execFileSync } from 'node:child_process'

/** 常见路径过滤：ts/vue 源码（dev-gated-logs / host-object-cast 共用，不各自手抄正则） */
export const TS_VUE = (rel) => /\.(ts|vue)$/.test(rel)

/**
 * @param {object} o
 * @param {string} o.root         仓库根（作为 git 的 cwd）
 * @param {string[]} o.tokens     `git grep -e` 的检索词（任一命中即入选）
 * @param {string[]} o.pathspecs  `git grep` 的 pathspec（可含 `:(exclude)…`）
 * @param {(rel: string) => boolean} [o.accept] 路径过滤（默认全收）
 * @param {number} [o.maxBuffer]  默认 32 MiB
 * @returns {Array<{ path: string, text: string }>}
 */
export function collectCandidates({ root, tokens, pathspecs, accept, maxBuffer = 32 << 20 }) {
  const args = ['grep', '--cached', '-l']
  for (const t of tokens) args.push('-e', t)
  args.push('--', ...pathspecs)

  let listing = ''
  try {
    listing = execFileSync('git', args, { cwd: root, encoding: 'utf8', maxBuffer })
  } catch {
    return []
  }

  const out = []
  for (const rel of listing.split(/\r?\n/)) {
    const p = rel.trim()
    if (!p) continue
    if (accept && !accept(p)) continue
    try {
      out.push({
        path: p,
        text: execFileSync('git', ['show', `:${p}`], { cwd: root, encoding: 'utf8', maxBuffer }),
      })
    } catch {
      // 索引读不到：跳过（不假装读过）
    }
  }
  return out
}
