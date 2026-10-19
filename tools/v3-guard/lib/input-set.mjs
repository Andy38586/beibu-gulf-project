/**
 * input-set — 判据的输入集合为空时的统一口径（W58 / 专项5 指标 9.2）。
 *
 * ## 治的失效
 *
 * 守卫按「收集候选 → 遍历判违例 → 报 OK」写。当收集侧返回空集，遍历体一次都不执行，
 * 于是**没有任何违例**，主流程走到 OK 分支打印「全部满足 ✓」。此时判据其实没跑，
 * 而输出读起来像「检查过了，很干净」。
 *
 * 这类红不会自己出现：目录改名、doc-map 条目被删、git 在非仓库里跑 —— 每一种都会让
 * 某个守卫安静转绿。专项5 指标 9.2 的原话是「确认每条守卫实际读到的输入集合非空，
 * 而不是『循环体一次都没执行却报了通过』」。
 *
 * ## 实测面（2026-10-19，`npm run guard:v3` 的 29 个执行体逐个体检）
 *
 * 带「成功文案」但零值判断缺失的有 7 个：`nest-controllers` / `doc-ref-check` /
 * `doc-claim-numbers` / `cruise-coverage`（输入来自目录或登记表）与
 * `dev-gated-logs` / `host-object-cast` / `retired-claims`（输入来自 `git grep` 词条检索）。
 * 后一组的 git **故障**已由 `lib/collect-candidates.mjs` 单独拦掉（exit 1 才是空集，
 * 其余退出码直接抛）；本函数管的是**检索成功但 0 份候选**，那意味着词条或扫描面已经失效。
 *
 * ## 为什么是一条函数而不是七处 if
 *
 * 逐处手写 `if (!x.length)` 会让「什么算空、空时说什么」长出七份口径 ——
 * 正是 AGENTS 禁忌 7 治的东西。文案、出口、失效条件都在这里改一次。
 */

/**
 * 输入集合为空时的失败文案；非空返回 null（调用方原样继续）。
 *
 * @param {number} count 实际拿到的输入条数
 * @param {object} o
 * @param {string} o.what 输入是什么（如「controller」「受控文档」「business 模块目录」）
 * @param {string} o.hint 该查哪里（路径/配置项的具名线索，不要写「检查配置」这种空话）
 * @returns {string|null}
 */
export function emptyInputProblem(count, { what, hint }) {
  if (count > 0) return null
  return (
    `扫描到 0 个${what}：判据的循环体一次都没执行，不能报通过。` +
    `空分母下的「全部满足」等于「没检查」。先确认 ${hint}。` +
    `若确认这一面已无需检查，按 AGENTS §十三-7 删掉本守卫，而不是让它空转。`
  )
}
