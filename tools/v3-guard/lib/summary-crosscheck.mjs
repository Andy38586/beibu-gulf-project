/**
 * metrics-tally 的「§4 汇总表 ↔ §8 明细表」交叉校验（抽为纯函数以便注入测试）。
 *
 * 修复动因（P1-08，2026-09-15）：原实现的正则 `/^\|\s*(专项\d)\s[^|]*\|/` 要求「专项名与序号同格」，
 * 而真实表格是 `| 专项1 | 数据链 | 57 | ...`（两者之间有竖线）⇒ `match()` 恒为 null → `continue`，
 * 整段不变量 3 一行都不执行却显示通过（假绿）。且循环后没有「命中数 > 0」断言，
 * 结构再变一次仍会静默通过。
 *
 * 本模块把该判定固化为两条硬约束：
 *   ① 正则必须能匹配真实表结构；
 *   ② **命中数为 0 一律报错**——禁止"解析不到 = 通过"。
 */

/** §4 汇总表行（`| 专项N | 名称 | 总数 | A | B | A- | C | D | 退役 |`） */
export const SUMMARY_ROW_RE =
  /^\|\s*(专项\d)\s*\|[^|]*\|\s*(\d+)\s*\|\s*(\d+)\s*\|\s*(\d+)\s*\|\s*(\d+)\s*\|\s*(\d+)\s*\|\s*(\d+)\s*\|\s*(\d+)\s*\|/

/** 表内数字列顺序（与 SUMMARY_ROW_RE 的捕获组顺序一致） */
export const SUMMARY_KEYS = ['总数', 'A', 'B', 'A-', 'C', 'D', '退役']

/**
 * @param {string[]} lines 附录全文按行切分
 * @param {Array<{专项: string} & Record<string, number>>} summary §8 明细表实算结果
 * @returns {{ problems: string[], matched: number }}
 */
export function crossCheckSummary(lines, summary) {
  const problems = []
  let matched = 0

  for (const l of lines) {
    const m = l.match(SUMMARY_ROW_RE)
    if (!m) continue
    const s = summary.find((x) => x.专项 === m[1])
    if (!s) continue
    matched++
    const got = SUMMARY_KEYS.map((k, i) => Number(m[i + 2]))
    const want = SUMMARY_KEYS.map((k) => s[k])
    if (got.join() !== want.join()) {
      problems.push(`§4 汇总表与 §8 明细表不一致：${m[1]} 表内 [${got}] vs 实际 [${want}]`)
    }
  }

  if (matched === 0) {
    problems.push(
      '附录 §4 汇总表未解析到任何专项行（正则或表结构已变更）——不变量 3「两表一致」实际未执行，' +
        '禁止以"未命中"当作通过；请同步正则或表结构后重跑。'
    )
  }
  return { problems, matched }
}
