/**
 * collect-candidates — 从 **git 索引**采集候选文件（不读工作树脏件，AGENTS §5.4）。
 *
 * 三个守卫（retired-claims / host-object-cast / dev-gated-logs）此前各自持一份**逐字同款**的
 * `collectCandidates()`（D22「判据基建家族」）——本件是它们的单一来源。
 * 三处差异只有：检索 token、pathspec、路径过滤；故参数化，逻辑（`git grep --cached -l`
 * 取清单 → `git show :<path>` 读索引内容 → 读不到则跳过）一字未改。
 *
 * **W58：git 失败不再伪装成「0 命中」**。修前 `catch { return [] }` 把两种完全不同的状态
 * 混成一个返回值——「仓库里确实没有这个词」和「git 根本跑不起来」（exit 128 非仓库 /
 * 129 未知选项 / 128 坏正则）。后者会让守卫拿空集去审计，然后打印
 * 「判据面 0 份文件……全部带标记 ✓」（空分母静默转绿）。
 * 实测（2026-10-19）：`git grep` 无命中 exit 1、非仓库 exit 128、未知选项 exit 129、
 * 坏正则 exit 128 ⇒ **只有 1 是合法空集**。
 * 注意 pathspec 写错（指向不存在目录）实测也是 exit 1，与无命中同码、无法用退出码区分；
 * 那一面由各守卫自己的「0 份候选」判据兜住（`lib/input-set.mjs`）。
 * 契约：合法空集返回 `[]`；git 不可用/选项错/正则错一律 throw，由调用方决定如何红。
 *
 * @param {object} o
 * @param {string} o.root         仓库根（作为 git 的 cwd）
 * @param {string[]} o.tokens     `git grep -e` 的检索词（任一命中即入选）
 * @param {string[]} o.pathspecs  `git grep` 的 pathspec（可含 `:(exclude)…`）
 * @param {(rel: string) => boolean} [o.accept] 路径过滤（默认全收）
 * @param {number} [o.maxBuffer]  默认 32 MiB
 * @returns {Array<{ path: string, text: string }>}
 */
import { execFileSync } from 'node:child_process'

/** 常见路径过滤：ts/vue 源码（dev-gated-logs / host-object-cast 共用，不各自手抄正则） */
export const TS_VUE = (rel) => /\.(ts|vue)$/.test(rel)

export function collectCandidates({ root, tokens, pathspecs, accept, maxBuffer = 32 << 20 }) {
  const args = ['grep', '--cached', '-l']
  for (const t of tokens) args.push('-e', t)
  args.push('--', ...pathspecs)

  let listing = ''
  try {
    listing = execFileSync('git', args, { cwd: root, encoding: 'utf8', maxBuffer })
  } catch (err) {
    // exit 1 = 无命中（合法空集）；其余（128 非仓库 / 129 坏选项 / 128 坏正则）是真故障。
    // 直接看 status 而不是看 stderr 文本：报错文案随 git 版本变，退出码不会。
    if (err?.status === 1) return []
    throw new Error(
      `git grep 失败（exit ${err?.status ?? '?'}）：${String(err?.stderr ?? err?.message ?? err).trim()}\n` +
        `  ——这不是「0 命中」。判据输入取不到时不许拿空集去审计后报通过。`,
      { cause: err }
    )
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
