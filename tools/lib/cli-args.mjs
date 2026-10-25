#!/usr/bin/env node
/**
 * tools/lib/cli-args.mjs — tools 下所有 CLI 探针的参数读取**唯一入口**。
 *
 * ## 为什么要有它（2026-10-25 全仓实测）
 *
 * 收口前 13 个文件各写一份 `arg(name, default)`，分成两套互不兼容的约定：
 *
 * | 约定 | 调用方写法 | 实现 | 实测处数 |
 * | --- | --- | --- | --- |
 * | A：调用方自带 `--` | `arg('--osm', d)` | `argv.indexOf(k)` | 4 |
 * | B：实现内部补 `--` | `arg('osm', d)` | `argv.indexOf('--' + k)` | 8 |
 * | A′：A + 真值判断 | `arg('--url', d)` | `indexOf(k)` + `&& argv[i+1]` | 1 |
 *
 * 同形的两种写法带来的真实代价：把 A 文件的调用点抄到 B 文件里，标志永远解析不到、
 * 静默取默认值（探针跑的是「默认参数」而不是用户以为的那份）。这类错不会报错。
 *
 * ## 选型：统一到 **B**（调用方写裸名，`--` 由本模块补）
 *
 * 1. **多数派**：8/13；A→B 的迁移只是删掉调用点里的 `--`（机械、可 diff 复核）。
 * 2. **语法归实现所有**：调用点写 `arg('osm', d)` 不可能漏写或写成单横杠
 *    （本仓确实同时出现过 `'--url'` 与 `'url'`）。`--k=v`、`--no-k` 这类扩展
 *    也只在实现侧加，不必逐文件改调用点。
 * 3. **迁移可增量**：实现侧对带 `--` 的名字做归一，故 A 约定的旧调用点不改也能工作
 *    —— 允许逐文件迁移，不会因为「改了一半」而静默取默认值。
 *
 * ## 边界语义（唯一一套，替代原三种写法）
 *
 * | 场景 | 返回 |
 * | --- | --- |
 * | 标志不存在 | 默认值 |
 * | 标志存在且有值 | 该值（`''` 也是值——用户显式给了空串） |
 * | 标志存在但缺值（行尾 / 下一个 token 又是 `--x`） | 默认值 |
 *
 * 「缺值回落默认」是对原实现的收紧：原 B 写法在 `node x.mjs --k` 时返回 `undefined`，
 * 把 `undefined` 静默传给下游（报错点离现场很远）；原 A′ 则用 `&& argv[i+1]` 只堵了
 * 空串一种。此处的判据是「下一个 token 是不是另一个标志」，两种畸形一起堵。
 */

/** 归一标志名：`osm` → `--osm`；`--osm` 原样保留（兼容 A 约定的旧调用点） */
function flagOf(name) {
  return name.startsWith('--') ? name : `--${name}`
}

/**
 * 读取字符串型参数。
 * @param {string} name 裸名（`'osm'`）；带 `--` 亦可（迁移期兼容）
 * @param {string} fallback 缺标志或缺值时返回
 * @param {string[]} argv 参数表（默认 process.argv；单测注入）
 */
export function arg(name, fallback, argv = process.argv) {
  const flag = flagOf(name)
  const i = argv.indexOf(flag)
  if (i === -1) return fallback
  const v = argv[i + 1]
  // 缺值：行尾，或下一个 token 是另一个标志
  if (v === undefined || v.startsWith('--')) return fallback
  return v
}

/**
 * 布尔开关：`--dry` → true；`--no-dry` → false；缺席 → false。
 * 取代各文件里的 `argv.includes('--dry')`（那样无法表达显式取反）。
 */
export function hasFlag(name, argv = process.argv) {
  const bare = name.replace(/^--/, '')
  if (argv.includes(`--no-${bare}`)) return false
  return argv.includes(`--${bare}`)
}
