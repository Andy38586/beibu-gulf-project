#!/usr/bin/env node
/**
 * reanchor-hubs.mjs — 按**施工影像**实测的偏移，平移交付包里三枢纽的落位。
 *
 * ## 为什么是改 child.transform
 * 交付包 pinglu/tiles/tileset.json 的 17 个 child **各自带 transform**（root 只是外包络），
 * 所以按枢纽整体平移 = 改该枢纽 depth-1 child 的 transform 平移量（ENU 米），子孙自动跟随。
 *
 * ## 判据从哪来（不是我拍的）
 * .local/3d-review/align-hub3.py：在运河带 ±120 m 走廊内，取「影像水面」与「枢纽模型水面」
 * 逐行重心之差，中位滤波后取中位数。该脚本自带阳性对照（人为平移已知量必须复原，实测复原 0.0 px）。
 * 2026-10-03 实测（模型-影像，负=模型在西侧）：马道 -96 m / 企石 -87 m / 青年 -76 m；
 * MAD 分别 ±51/±39/±70 m —— 方向与量级可信，**精度只到十米级**，故按 5 m 取整。
 *
 * ## 用法
 *   node tools/3dtiles-build/reanchor-hubs.mjs --hub madao --dE 95 --dN 0
 *   node tools/3dtiles-build/reanchor-hubs.mjs --hub madao --dE 95 --dN 0 --apply
 * 未给 --apply 时只打印将要做的改动，不落盘。
 */
import fs from 'node:fs'
import path from 'node:path'

const TILESET = 'backend/static/pinglu/tiles/tileset.json'
const LEDGER = '.local/3d-review/reanchor-hubs-log.json'
const HUBS = ['madao', 'qishi', 'qingnian']

function arg(k, d) {
  const i = process.argv.indexOf('--' + k)
  return i > -1 ? process.argv[i + 1] : d
}

const hub = arg('hub', null)
const dE = Number(arg('dE', 0))
const dN = Number(arg('dN', 0))
const dH = Number(arg('dH', 0))
const apply = process.argv.includes('--apply')

if (!hub || !HUBS.includes(hub)) {
  console.error(
    '用法: node tools/3dtiles-build/reanchor-hubs.mjs --hub <madao|qishi|qingnian> --dE <米> [--dN <米>] [--dH <米>] [--apply]'
  )
  process.exit(2)
}

const ts = JSON.parse(fs.readFileSync(TILESET, 'utf8'))
const child = (ts.root.children || []).find((c) =>
  ((c.content || {}).uri || '').startsWith(hub + '-')
)
if (!child) {
  console.error('找不到 ' + hub + ' 的 depth-1 child')
  process.exit(3)
}

const before = child.transform ? child.transform.slice(12, 15) : [0, 0, 0]
if (!child.transform) {
  // 没有自身 transform 的补一个「单位旋转 + 平移」（列主序：平移在最后一行）
  child.transform = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, dE, dN, dH, 1]
} else {
  child.transform[12] += dE
  child.transform[13] += dN
  child.transform[14] += dH
}
const after = child.transform.slice(12, 15)
console.log('枢纽 ' + hub + '：uri=' + child.content.uri)
console.log(
  '  平移 ' +
    JSON.stringify(before) +
    ' -> ' +
    JSON.stringify(after) +
    '  (dE=' +
    dE +
    ' dN=' +
    dN +
    ' dH=' +
    dH +
    ')'
)
if (!apply) {
  console.log('  （未给 --apply，未落盘）')
  process.exit(0)
}

fs.mkdirSync(path.dirname(LEDGER), { recursive: true })
const log = fs.existsSync(LEDGER) ? JSON.parse(fs.readFileSync(LEDGER, 'utf8')) : []
log.push({
  at: new Date().toISOString(),
  hub,
  dE,
  dN,
  dH,
  before,
  after,
  source: '.local/3d-review/align-hub3.py',
})
fs.writeFileSync(LEDGER, JSON.stringify(log, null, 2))
// 保持与原文件同款缩进（探测第二行的前导空格）：压成一行或换缩进都会让整份 diff 变成
// 「1 增 1506 删」，复核不了（上一窗口与本会话都踩过）
const raw = fs.readFileSync(TILESET, 'utf8')
const l2 = raw.split('\n')[1] ?? ''
const ind = l2.length - l2.replace(/^ +/, '').length || 2
fs.writeFileSync(TILESET, JSON.stringify(ts, null, ind) + '\n')
console.log('  写出缩进=' + ind)
console.log('  已写入 ' + TILESET + '（记录 ' + LEDGER + '）')
