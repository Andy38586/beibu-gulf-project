// JTT 月度运量 CSV 序列化（extract-jtt-archive / fetch-jtt-monthly 共用）。
// 两份原实现逐字同款（head 数组、sort、map、join、`fetched_at` 取当日），只差一个
// `mode` 列（extract 侧多）——把该差异参数化，消掉第二份手抄（AGENTS §七-7）。
/**
 * @param {Array<Record<string, any>>} records 月度记录
 * @param {(r: Record<string, any>) => string} [modeOf] 给了则插 `mode` 列（位置在 `month` 后）
 * @returns {string} CSV 文本（含表头行）
 */
export function toCsv(records, modeOf) {
  const head = [
    'year',
    'month',
    ...(modeOf ? ['mode'] : []),
    'cargo_fang_cum_10kt',
    'cargo_fang_month_10kt',
    'cargo_qin_cum_10kt',
    'cargo_qin_month_10kt',
    'cargo_bei_cum_10kt',
    'cargo_bei_month_10kt',
    'cargo_beibu_cum_10kt',
    'cargo_beibu_month_10kt',
    'container_beibu_cum_teu',
    'container_beibu_month_teu',
    'sum_check_pct',
    'source_url',
    'fetched_at',
  ]
  const rows = records
    .sort((a, b) => a.year * 100 + a.month - (b.year * 100 + b.month))
    .map((r) =>
      [
        r.year,
        r.month,
        ...(modeOf ? [modeOf(r)] : []),
        r.fang_cargo?.cum ?? '',
        r.fang_cargo?.month ?? '',
        r.qin_cargo?.cum ?? '',
        r.qin_cargo?.month ?? '',
        r.bei_cargo?.cum ?? '',
        r.bei_cargo?.month ?? '',
        r.beibu_cargo?.cum ?? '',
        r.beibu_cargo?.month ?? '',
        r.beibu_container?.cum ?? '',
        r.beibu_container?.month ?? '',
        r.sum_check_pct ?? '',
        r.source_url,
        new Date().toISOString().slice(0, 10),
      ].join(',')
    )
  return [head.join(','), ...rows].join('\n')
}
