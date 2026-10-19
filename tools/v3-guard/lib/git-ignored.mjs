/**
 * git-ignored — 判定目标是否在**版本控制之外**（gitignored），三态返回。
 *
 * 两个守卫（agent-docs-check / tmp-hygiene）此前各持一份 `isGitIgnored()`：一个只回
 * 二态（`status === 0`），一个回三态（0/1/其它 ⇒ true/false/null）。同一事实两处手抄，
 * 且「非 git 环境」这一档只在其中一处存在 —— 本件是它们的单一来源。
 *
 * 三态是承重的，不是过度设计：tmp-hygiene 用 `=== true` 判豁免，于是非 git 环境
 * （tarball 分发，status=128）⇒ null ⇒ **仍报红**，那正是该守卫头注自陈的兜底价值。
 * 抹成二态会把这条兜底直接删掉（见 tools/v3-guard/tmp-hygiene.mjs 的强度边界注释）。
 *
 * `stdio: 'ignore'` 不是风格选择：受限执行环境拒绝**管道式**子进程，spawnSync 会返回
 * status=null，判定随之退化成「无法判定」（本仓第三次踩同一个坑）。
 */
import { spawnSync } from 'node:child_process'

/**
 * @param {string} target 相对或绝对路径（相对 `root` 解析）
 * @param {object} o
 * @param {string} o.root 仓库根（作为 git 的 cwd）
 * @returns {true | false | null} true=被忽略；false=未被忽略；null=无法判定（非 git 环境）
 */
export function isGitIgnored(target, { root }) {
  const r = spawnSync('git', ['check-ignore', '-q', '--', target], { cwd: root, stdio: 'ignore' })
  // check-ignore 退出码：0 = 被忽略；1 = 未被忽略；128 = 非 git 环境
  if (r.status === 0) return true
  if (r.status === 1) return false
  return null
}
