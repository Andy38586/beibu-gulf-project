#!/usr/bin/env node
/**
 * fetch-jtt-monthly.mjs — 广西交通运输厅月度港口生产公报抓取 + 解析
 *
 * 数据源：广西壮族自治区交通运输厅「政府信息公开 > 法定主动公开内容 > 交通统计 >
 * 公路水路运输」栏目月度公报（免费、无需登录）：
 *   https://jtt.gxzf.gov.cn/zfxxgk/fdzdgk/jttj/glslys/
 *
 * 公报覆盖（2026-10-02 经检索核实）：
 *   - 货物吞吐量：北部湾港合计 + 防城/钦州/北海 分港，月度「本月值 + 自年初累计」
 *   - 集装箱吞吐量：仅北部湾港合计（分港集装箱月报不发布；分港见
 *     巨潮资讯 000582 定期报告，需另行手工摘录）
 *   - 已核实样例：2016-06（t3966599）、2020-04（t7315452）、2020-09（t7315590）
 *
 * 用法：
 *   node tools/forecast/fetch-jtt-monthly.mjs --crawl [--start 2016-01] [--out <csv路径>]
 *       在线模式：翻栏目列表页 → 下载各期公报 HTML → 解析 → 输出 CSV。
 *       ⚠️ 需在能直连 jtt.gxzf.gov.cn 的网络运行（本机/国内网络；境外 IP 被 CDN 拒绝）。
 *   node tools/forecast/fetch-jtt-monthly.mjs --local <dir>
 *       离线模式：解析 <dir> 下已保存的公报 HTML（每文件对应一期）。
 *   node tools/forecast/fetch-jtt-monthly.mjs --selftest
 *       用内置真实公报文本（2016-06 期，检索结果原文）验证解析器，不触网。
 *
 * 输出 CSV 列：year, month, 各港货物(本月/累计)，北部湾港集装箱(本月/累计, 统一TEU)，
 *   sum_check（防城+钦州+北海 与 北部湾港合计的偏差%），source_url, fetched_at。
 * 每一行都带来源 URL —— 数据完整性红线的 source 标记是列级内置的。
 *
 * 已知口径注意：
 *   - 2016~2019 表头为「规模以上港口」，2020 起为「全区港口」，解析器两形态都认。
 *   - 2020 年公路水路指标有基数调整（公报自带注释），港口口径未受影响。
 *   - 累计值差分 ≈ 本月值，可作跨期一致性校验（--crawl 模式自动校验并告警）。
 */
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const COLUMN_BASE = 'https://jtt.gxzf.gov.cn/zfxxgk/fdzdgk/jttj/glslys/'
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) beibu-gulf-data-pipeline/1.0'

// ---------- 编码 ----------
async function decodeBuffer(buf) {
  for (const enc of ['utf-8', 'gbk']) {
    try {
      return new TextDecoder(enc, { fatal: true }).decode(buf)
    } catch {
      /* 尝试下一种编码 */
    }
  }
  return new TextDecoder('utf-8').decode(buf) // 兜底：替换非法字节
}

// ---------- HTML → 纯文本行 ----------
function htmlToLines(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/\r/g, '')
    .split('\n')
    .map((l) => l.replace(/\s+/g, ' ').trim())
    .filter(Boolean)
    .flatMap((l) => l.split(/(?=[(（]?[1-6][)）.、]\S)/)) // 政务页常把整表压成一行，按序号切分
    .map((l) => l.trim())
    .filter(Boolean)
}

// ---------- 单行数值提取 ----------
/** 单位后第一二个数 = 累计、本月（同比列忽略）。
 *  先剥枚举序号 [(1)/（2）/①/"1 ､"]——否则行首序号会被当成累计值（selftest 实测踩过）。 */
function grabPair(line) {
  const cleaned = line
    .replace(/[(（]\d+[)）]/g, ' ')
    .replace(/[①②③④⑤⑥⑦⑧⑨⑩]/g, ' ')
    .replace(/^\s*\d+\s*[､、.．]\s*/, ' ')
    .replace(/其中\s*:/g, ' ')
  const m = cleaned.match(/[-−]?[\d,]+(?:\.\d+)?/g)
  if (!m || m.length < 2) return null
  const nums = m.map((s) => Number(s.replace(/,/g, '')))
  return { cum: nums[0], month: nums[1] }
}

/** 容器行单位归一：TEU 原值；万TEU ×1e4 */
function unitScale(line) {
  return /万\s*TEU/i.test(line) ? 10000 : 1
}

/**
 * 公报文本解析。
 *
 * 两种已知形态（2026-10-02 检索核实）：
 *   2016~2019：「三､规模以上港口货物吞吐量」，集装箱为 ② 嵌套行（全区一行、北部湾港一行，
 *             行内不写字段名，归属靠出现次序——第二行才是北部湾港）
 *   2020~  ：「三､全区港口货物吞吐量」，集装箱区有显式「(1)北部湾港 万TEU」子行
 * 两种不明说的陷阱：
 *   - 「外贸货物吞吐量」块里也有北部湾港合计行——必须在主合计**之后**不覆盖（先到先得）
 *   - 集装箱全区行与北部湾港行之间会隔「外贸」行——不能靠上下文状态，只能靠次序/显式行
 * 未知形态一律解析为 null（漏一期可补，猜一个数进去违反数据红线）。
 */
export function parseReportText(lines, sourceUrl) {
  const titleLine = lines.find(
    (l) => /(\d{4})\s*年\s*(\d{1,2})\s*月/.test(l) && l.includes('港口生产完成情况')
  )
  if (!titleLine) return null
  const [, year, month] = titleLine.match(/(\d{4})\s*年\s*(\d{1,2})\s*月/)
  const rec = {
    year: Number(year),
    month: Number(month),
    beibu_cargo: null,
    fang_cargo: null,
    qin_cargo: null,
    bei_cargo: null,
    beibu_container: null,
    container_unit: 'TEU',
    source_url: sourceUrl,
  }
  const containerLines = [] // 嵌套形态（2016~2019）：按出现次序，[0]=全区、[1]=北部湾港

  for (const line of lines) {
    if (/集装箱吞吐量/.test(line) && /TEU/i.test(line)) {
      const pair = grabPair(line)
      if (pair) containerLines.push({ ...pair, scale: unitScale(line) })
      continue
    }
    if (/外贸/.test(line)) continue // 外贸块永不归属主口径，跳过（防覆盖主合计）
    if (/内河港口/.test(line)) continue
    if (!/万吨/.test(line)) continue
    const pair = grabPair(line)
    if (!pair) continue
    if (/北部湾港/.test(line))
      rec.beibu_cargo ??= pair // 先到先得：主合计在前、外贸在后
    else if (/防城/.test(line)) rec.fang_cargo ??= pair
    else if (/钦州/.test(line)) rec.qin_cargo ??= pair
    else if (/北海/.test(line)) rec.bei_cargo ??= pair
  }

  // 集装箱归属：显式「北部湾港 + TEU」行优先（2020~ 形态）；否则取嵌套第二行（2016~2019 形态）
  let container = null
  for (let i = 0; i < lines.length; i++) {
    if (/集装箱吞吐量/.test(lines[i])) continue
    if (/北部湾港/.test(lines[i]) && /TEU/i.test(lines[i])) {
      const pair = grabPair(lines[i])
      if (pair)
        container = { cum: pair.cum * unitScale(lines[i]), month: pair.month * unitScale(lines[i]) }
      break
    }
  }
  if (!container && containerLines.length >= 2) {
    const c = containerLines[1]
    container = { cum: c.cum * c.scale, month: c.month * c.scale }
  }
  rec.beibu_container = container

  // 分港合计对账：防城+钦州+北海 应 ≈ 北部湾港合计（口径变更会被这条抓住）
  if (rec.beibu_cargo && rec.fang_cargo && rec.qin_cargo && rec.bei_cargo) {
    const sum = rec.fang_cargo.cum + rec.qin_cargo.cum + rec.bei_cargo.cum
    rec.sum_check_pct = Math.round(((sum - rec.beibu_cargo.cum) / rec.beibu_cargo.cum) * 1000) / 10
  }
  return rec
}

// ---------- 在线抓取 ----------
async function fetchBuf(url) {
  const res = await fetch(url, {
    headers: { 'User-Agent': UA },
    signal: AbortSignal.timeout(30000),
  })
  if (!res.ok) throw new Error(`HTTP ${res.status} @ ${url}`)
  return Buffer.from(await res.arrayBuffer())
}

async function crawlReportUrls() {
  const urls = new Map() // url -> title
  for (let page = 0; page < 60; page++) {
    const listUrl = page === 0 ? `${COLUMN_BASE}index.shtml` : `${COLUMN_BASE}index_${page}.shtml`
    let html
    try {
      html = await decodeBuffer(await fetchBuf(listUrl))
    } catch (err) {
      if (page === 0)
        throw new Error(`栏目首页不可达：${err.message}（境外 IP 会被拒，需本机运行）`)
      break // 翻页到底
    }
    const found = [
      ...html.matchAll(/href="([^"]*t\d+\.shtml)"[^>]*>([^<]*港口生产完成情况[^<]*)</g),
    ]
    if (page > 0 && found.length === 0) break
    for (const [, href, title] of found) {
      const url = new URL(href, COLUMN_BASE).href
      if (!urls.has(url)) urls.set(url, title.trim())
    }
  }
  return urls
}

// ---------- CSV ----------
function toCsv(records) {
  const head = [
    'year',
    'month',
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

// ---------- 自检（真实公报原文，不触网） ----------
function selftest() {
  // 形态一：2016-06（t3966599 检索原文）。列序 = 累计、本月、同比累计、同比本月
  const fixture2016 = `2016 年 6 月交通运输､港口生产完成情况一览表
三､规模以上港口货物吞吐量 总 计 万吨 15201.07 2809.68 3.16 5.93
其中 : ①外贸货物吞吐量 万吨 6041.90 1185.44 1.76 15.71
②集装箱吞吐量 TEU 1132457 199348 25.62 38.24
1 ､广西北部湾港 万吨 10017.72 1840.21 3.28 9.61
其中 : ①外贸货物吞吐量 万吨 5993.56 1174.63 2.29 16.49
②集装箱吞吐量 TEU 821294 135547 35.38 48.36
(1) 防城 万吨 5334.77 955.95 -0.82 10.71
(2) 钦州 万吨 3408.55 587.42 6.63 8.01
(3) 北海 万吨 1274.40 296.84 13.33 9.32
2 ､内河港口 万吨 5183.35 969.47 2.93 -0.43`
  // 形态二：2020-09（t7315590 检索原文）：无「广西」前缀、集装箱为显式子行、万TEU 单位
  const fixture2020 = `2020年9月公路水路运输､港口生产完成情况一览表
三､全区港口货物吞吐量 总 计 万吨 34505 4388 28.8 28.6
1.北部湾港 万吨 22186 2642 19.6 19.7
(1)防城港 万吨 9176 1093 23.2 25.5
(2)钦州 万吨 10143 1177 17.3 17.5
(3)北海 万吨 2867 372 16.8 11.3
3.全区港口外贸货物吞吐量 万吨 11161 1217 6.3 0.9
(1)北部湾港 万吨 11084 1209 6.3 1.0
4.全区港口集装箱吞吐量 万TEU 430 58 26.2 27.7
(1)北部湾港 万TEU 351 48 34.9 36.8`
  const assert = (cond, msg, rec) => {
    if (!cond) throw new Error(`自检失败：${msg}\n${JSON.stringify(rec, null, 1)}`)
  }

  const r16 = parseReportText(fixture2016.split('\n'), 'fixture://2016-06')
  assert(r16.year === 2016 && r16.month === 6, '2016 年月', r16)
  assert(r16.fang_cargo?.month === 955.95 && r16.fang_cargo?.cum === 5334.77, '2016 防城', r16)
  assert(r16.qin_cargo?.month === 587.42 && r16.bei_cargo?.month === 296.84, '2016 钦州/北海', r16)
  assert(r16.beibu_cargo?.cum === 10017.72, '2016 主合计不被外贸行覆盖', r16)
  assert(
    r16.beibu_container?.month === 135547 && r16.beibu_container?.cum === 821294,
    '2016 集装箱嵌套第二行',
    r16
  )
  assert(Math.abs(r16.sum_check_pct) < 0.1, '2016 分港对账', r16)

  const r20 = parseReportText(fixture2020.split('\n'), 'fixture://2020-09')
  assert(r20.year === 2020 && r20.month === 9, '2020 年月', r20)
  assert(
    r20.beibu_cargo?.cum === 22186 && r20.beibu_cargo?.month === 2642,
    '2020 无前缀北部湾港',
    r20
  )
  assert(
    r20.qin_cargo?.month === 1177 && r20.fang_cargo?.month === 1093 && r20.bei_cargo?.month === 372,
    '2020 三港',
    r20
  )
  assert(r20.beibu_container?.month === 48 * 10000, '2020 显式行 + 万TEU→TEU', r20)
  assert(Math.abs(r20.sum_check_pct) < 0.1, '2020 分港对账', r20)

  console.log('selftest: OK（2016/2020 双形态，含外贸防覆盖与万TEU归一）')
}

// ---------- main ----------
const argv = process.argv.slice(2)
const mode = argv[0] ?? '--help'

if (mode === '--selftest') {
  selftest()
} else if (mode === '--crawl') {
  const outIdx = argv.indexOf('--out')
  const out =
    outIdx > 0
      ? argv[outIdx + 1]
      : path.join(
          path.dirname(fileURLToPath(import.meta.url)),
          '..',
          '..',
          'backend',
          'data',
          'forecast',
          'jtt_monthly.csv'
        )
  console.log('抓取栏目列表…')
  const urls = await crawlReportUrls()
  console.log(`发现 ${urls.size} 期公报`)
  const records = []
  let fail = 0
  const rawDir = path.join(path.dirname(out), 'jtt_raw')
  mkdirSync(rawDir, { recursive: true })
  for (const [url, title] of urls) {
    try {
      const buf = await fetchBuf(url)
      const hash = createHash('md5').update(url).digest('hex').slice(0, 10)
      writeFileSync(path.join(rawDir, `${hash}.html`), buf) // 原始页归档，可复算
      const rec = parseReportText(htmlToLines(await decodeBuffer(buf)), url)
      if (rec) records.push(rec)
      else console.warn(`  ! 解析不出年月/表格：${title} ${url}`)
    } catch (err) {
      fail += 1
      console.warn(`  ! 下载失败：${url} (${err.message})`)
    }
  }
  writeFileSync(out, toCsv(records), 'utf-8')
  const bad = records.filter(
    (r) => typeof r.sum_check_pct === 'number' && Math.abs(r.sum_check_pct) > 0.5
  )
  console.log(`完成：${records.length} 期入库 → ${out}；失败 ${fail}；对账异常 ${bad.length} 期`)
  bad.forEach((r) =>
    console.warn(
      `  对账异常 ${r.year}-${String(r.month).padStart(2, '0')}: ${r.sum_check_pct}% ${r.source_url}`
    )
  )
} else if (mode === '--local') {
  const dir = argv[1]
  if (!dir || !existsSync(dir)) throw new Error('用法：--local <已保存HTML的目录>')
  const records = readdirSync(dir)
    .filter((f) => f.endsWith('.html'))
    .map((f) =>
      parseReportText(htmlToLines(readFileSync(path.join(dir, f), 'utf-8')), `local://${f}`)
    )
    .filter(Boolean)
  const out = path.join(dir, 'jtt_monthly.csv')
  writeFileSync(out, toCsv(records), 'utf-8')
  console.log(`完成：${records.length} 期 → ${out}`)
} else {
  console.log('用法见文件头注释：--crawl（在线）/ --local <dir>（离线）/ --selftest（解析器自检）')
}
