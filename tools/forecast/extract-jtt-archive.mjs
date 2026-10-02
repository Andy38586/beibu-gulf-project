#!/usr/bin/env node
/**
 * extract-jtt-archive.mjs — JTT 公报归档深度提取（表格 + OCR 双模式）
 *
 * 输入：fetch-jtt-http.sh 抓的归档目录（manifest.txt + *.html）。
 *   每页按形态分流：
 *   - table 模式（约 30 页）：正文含 <table>，逐 <tr> 抽单元格拼回"标签 单位 累计 本月 …"
 *     合成行，交给 parseReportText（fetch-jtt-monthly.mjs 导出的同一解析器——判据单源）；
 *   - ocr 模式（约 72 页）：正文引用 W0 图片附件，下载后经 win-ocr.ps1（Windows 自带
 *     OCR，zh-Hans-CN）出文本行，同样交给 parseReportText；
 *   - 两不靠（无表格无图，站点改版丢内容）：记入未覆盖清单，**不猜数**（数据红线）。
 *
 * 数值质量双闸（自动，不替代人工抽检）：
 *   1. sum_check：防城+钦州+北海 ≈ 北部湾港合计（parseReportText 内建，偏差 >0.5% 记异常）；
 *   2. cum_diff：同年相邻月 累计差分 ≈ 本月值（本脚本加做，偏差 >2% 记异常）。
 *
 * 用法：node tools/forecast/extract-jtt-archive.mjs <归档目录> [--out <csv>] [--ocr-limit N]
 * 输出：<归档目录>/jtt_extract.csv（比 crawl CSV 多 mode 列）+ 控制台统计。
 */
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { parseReportText } from './fetch-jtt-monthly.mjs'

export { tableToLines, buildTableLines, cumDiffCheck, normalizeOcrWord }

const scriptDir = path.dirname(fileURLToPath(import.meta.url))
const OCR_PS1 = path.join(scriptDir, 'win-ocr.ps1')

// ---------- HTML → 结构 ----------
function stripTags(s) {
  return s
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim()
}

/** 提取页面 <title>（parseReportText 靠标题行定年月） */
function pageTitle(html) {
  const m = html.match(/<title>([^<]+)<\/title>/i)
  return m ? stripTags(m[1]) : ''
}

/** table 模式：每个 <tr> 合成一行"单元格文本 空格连接"（与公报原始行形态同构） */
function tableToLines(html) {
  const out = []
  const trs = html.match(/<tr[^>]*>[\s\S]*?<\/tr>/gi) || []
  for (const tr of trs) {
    const tds = (tr.match(/<t[dh][^>]*>[\s\S]*?<\/t[dh]>/gi) || []).map(stripTags).filter(Boolean)
    if (tds.length >= 2) out.push(tds.join(' '))
  }
  return out
}

/** 找页面的 W0 图片附件引用（相对页 URL） */
function findImageRef(html) {
  const m = html.match(/((?:\.\.\/)*W0\d+\.(?:png|jpg|gif))/i)
  return m ? m[1] : null
}

// ---------- OCR ----------
function ocrImageJson(imgPath, lang = 'zh-Hans-CN') {
  const out = execFileSync(
    'powershell.exe',
    [
      '-NoProfile',
      '-ExecutionPolicy',
      'Bypass',
      '-File',
      OCR_PS1,
      '-Path',
      path.resolve(imgPath),
      '-Lang',
      lang,
    ],
    { encoding: 'utf8', timeout: 180000 }
  )
  return JSON.parse(out)
}

/**
 * OCR 行归一化（词级）：全角标点转半角（'．'→'.'，防数字被拆），去内部空格。
 * 不动任何数字字符本身。
 */
function normalizeOcrWord(w) {
  return w
    .replace(/[．・]/g, '.')
    .replace(/[，]/g, ',')
    .replace(/[－−−]/g, '-')
    .replace(/\s+/g, '')
}

/**
 * 几何表格重建：词框 → y 聚类成行 → 行内 x 排序、小间隙合并成单元格 →
 * 只保留「有单位词（万吨/万TEU）+ ≥2 个数字格」的数据行，合成
 * "label unit cum month yoy…" 形式交给 parseReportText（grabPair 取前两数=累计/本月）。
 * 为什么必须几何：Windows OCR 对该表输出的是"先整列标签、再整列数字"的列优先文本块，
 * 纯文本行无法对回表格行——词框坐标是唯一可靠的行/列对位依据。
 */
function buildTableLines(ocrJson) {
  // 「万」被 OCR 固定误读为「力」（力吨/力人）——单位列的结构性容错，非数据猜测
  const UNIT_RE = /^(?:[万力])(?:吨|人|TEU|teu)$|^万吨公里$/
  const NUM_RE = /^[-]?[\d,.]+$/
  const words = []
  for (const line of ocrJson.lines ?? []) {
    for (const wd of line.words ?? []) {
      const t = normalizeOcrWord(String(wd.t ?? ''))
      if (t) words.push({ t, x: wd.x, y: wd.y + wd.h / 2, h: wd.h, w: wd.w })
    }
  }
  words.sort((a, b) => a.y - b.y || a.x - b.x)
  // y 聚类（中心距 < 行高 60% 视为同表行）
  const clusters = []
  for (const wd of words) {
    const c = clusters.find((cl) => Math.abs(cl.y - wd.y) <= Math.max(cl.h, wd.h) * 0.6)
    if (c) {
      c.words.push(wd)
      c.h = Math.max(c.h, wd.h)
    } else {
      clusters.push({ y: wd.y, h: wd.h, words: [wd] })
    }
  }
  const lines = []
  for (const cl of clusters) {
    const ws = cl.words.sort((a, b) => a.x - b.x)
    // 小间隙合并（汉字词被 OCR 拆成单字）；数字与前一格间距再小也不并（防数字粘连）
    const cells = []
    for (const wd of ws) {
      const prev = cells[cells.length - 1]
      const gap = prev ? wd.x - (prev.x + prev.w) : Infinity
      if (
        prev &&
        gap < Math.max(prev.h, wd.h) * 1.1 &&
        !NUM_RE.test(prev.t) &&
        !NUM_RE.test(wd.t)
      ) {
        prev.t += wd.t
        prev.w = wd.x + wd.w - prev.x
      } else {
        cells.push({ ...wd })
      }
    }
    const unitIdx = cells.findIndex((c) => UNIT_RE.test(c.t))
    if (unitIdx < 0) continue
    const nums = cells.slice(unitIdx + 1).filter((c) => NUM_RE.test(c.t))
    if (nums.length < 2) continue
    const label = cells
      .slice(0, unitIdx)
      .map((c) => c.t)
      .join('')
    const unit = cells[unitIdx].t
    lines.push(`${label} ${unit} ${nums.map((n) => n.t).join(' ')}`)
  }
  return lines
}

// ---------- CSV ----------
function toCsv(records, modeOf) {
  const head = [
    'year',
    'month',
    'mode',
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
        modeOf(r),
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

// ---------- 跨期一致性：同年相邻月 累计差分 ≈ 本月值 ----------
function cumDiffCheck(records) {
  const bad = []
  const byKey = new Map(records.map((r) => [r.year * 100 + r.month, r]))
  for (const r of records) {
    const prev = byKey.get(r.year * 100 + r.month - 1)
    if (!prev) continue
    for (const port of ['fang_cargo', 'qin_cargo', 'bei_cargo', 'beibu_cargo']) {
      const a = r[port]?.cum,
        am = r[port]?.month,
        pc = prev[port]?.cum
      if (!Number.isFinite(a) || !Number.isFinite(am) || !Number.isFinite(pc)) continue
      const diff = a - pc
      if (Math.abs(diff - am) / Math.max(am, 1) > 0.02) {
        bad.push(
          `${r.year}-${String(r.month).padStart(2, '0')} ${port}: 累计差分 ${diff.toFixed(0)} vs 本月 ${am.toFixed(0)}`
        )
      }
    }
  }
  return bad
}

// ---------- main ----------
async function main() {
  const argv = process.argv.slice(2)
  const dir = argv[0]
  if (!dir || !existsSync(path.join(dir, 'manifest.txt'))) {
    console.log('用法：node extract-jtt-archive.mjs <归档目录> [--out <csv>] [--ocr-limit N]')
    process.exit(1)
  }
  const outIdx = argv.indexOf('--out')
  const out = outIdx > 0 ? argv[outIdx + 1] : path.join(dir, 'jtt_extract.csv')
  const ocrLimitIdx = argv.indexOf('--ocr-limit')
  const ocrLimitN = ocrLimitIdx > 0 ? Number(argv[ocrLimitIdx + 1]) : Infinity

  const manifest = readFileSync(path.join(dir, 'manifest.txt'), 'utf-8')
    .trim()
    .split('\n')
    .map((l) => l.split('\t'))
  const imgDir = path.join(dir, 'img')
  mkdirSync(imgDir, { recursive: true })

  const records = []
  const uncovered = []
  let ocrDone = 0
  let ocrFailed = 0
  let tableDone = 0

  for (const [file, url, title] of manifest) {
    const p = path.join(dir, file)
    if (!existsSync(p)) continue
    const html = readFileSync(p, 'utf-8')
    const hasImage = /W0\d+\.(?:png|jpg|gif)/i.test(html)
    const hasTable = /<table/i.test(html)

    let lines = null
    let mode = null
    if (hasTable) {
      lines = tableToLines(html)
      mode = 'table'
    } else if (hasImage && ocrDone < ocrLimitN) {
      const ref = findImageRef(html)
      const imgUrl = new URL(ref, url).href
      const imgFile = path.join(imgDir, path.basename(ref))
      try {
        if (!existsSync(imgFile)) {
          const buf = Buffer.from(await (await fetch(imgUrl)).arrayBuffer())
          writeFileSync(imgFile, buf)
        }
        const ocrJson = ocrImageJson(imgFile)
        lines = buildTableLines(ocrJson)
        mode = 'ocr'
        ocrDone++
      } catch (e) {
        ocrFailed++
        console.warn(`  ! OCR 失败：${title} (${String(e.message).slice(0, 80)})`)
      }
    }
    if (!lines) {
      uncovered.push(title)
      continue
    }

    // 合成标题行在首（parseReportText 靠它定年月），表格页正文行随后
    const rec = parseReportText([pageTitle(html) || title, ...lines], url)
    if (!rec) {
      uncovered.push(title)
      continue
    }
    rec._mode = mode
    if (mode === 'table') tableDone++
    records.push(rec)
  }

  const badSum = records.filter(
    (r) => typeof r.sum_check_pct === 'number' && Math.abs(r.sum_check_pct) > 0.5
  )
  const badCum = cumDiffCheck(records)
  writeFileSync(
    out,
    toCsv(records, (r) => r._mode ?? ''),
    'utf-8'
  )

  console.log(`完成：${records.length} 期（table ${tableDone} / ocr ${ocrDone}）→ ${out}`)
  console.log(`未覆盖（无表格无图/OCR失败）：${uncovered.length} 期；OCR 失败 ${ocrFailed} 次`)
  console.log(
    `sum_check 异常（>0.5%）：${badSum.length} 期；cum_diff 异常（>2%）：${badCum.length} 条`
  )
  badSum
    .slice(0, 5)
    .forEach((r) =>
      console.warn(`  sum_check ${r.year}-${String(r.month).padStart(2, '0')}: ${r.sum_check_pct}%`)
    )
  badCum.slice(0, 8).forEach((l) => console.warn(`  cum_diff ${l}`))
}

// ESM 主模块守卫：被测试导入时不执行主流程
import { pathToFileURL } from 'node:url'
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  await main()
}
