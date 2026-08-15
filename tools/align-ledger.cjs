// 台账表格源码对齐脚本 v4（2026-08-14）
// 目标：一个文档内所有分区表格共用同一列宽模板，竖线 | 上下左右全部对齐（等宽字体下）。
// v4：检测全空装饰列（首尾空列）并移除；按显示宽度 pad（全角=2、半角=1）；
// 单元格内 <br> 分段取最大段宽；\| 转义按 2 半角计；反引号感知拆列。
const fs = require('fs');

function dispWidth(s) {
  let w = 0;
  for (const c of s) {
    if (c === '\u0000') continue;
    w += c.charCodeAt(0) > 0xff ? 2 : 1;
  }
  return w;
}

// 状态机拆列（反引号内 | 不分割；\| 转义不分割）；去掉首尾空段
function splitRow(line) {
  const parts = [];
  let cur = '';
  let inCode = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '`') { inCode = !inCode; cur += ch; continue; }
    if (ch === '|' && !inCode) {
      if (i > 0 && line[i - 1] === '\\') { cur += ch; continue; }
      parts.push(cur);
      cur = '';
      continue;
    }
    cur += ch;
  }
  parts.push(cur);
  if (parts.length && parts[0].trim() === '') parts.shift();
  if (parts.length && parts[parts.length - 1].trim() === '') parts.pop();
  return parts;
}

// 单元格显示宽度：<br> 分段取 max
function cellWidth(cell) {
  const segs = cell.split(/<br\s*\/?>/i);
  let max = 0;
  for (const seg of segs) {
    max = Math.max(max, dispWidth(seg.replace(/\\\|/g, '\\|')));
  }
  return max;
}

// pad 单元格到目标显示宽度（右补空格）
function padCell(cell, target) {
  const w = cellWidth(cell);
  const pad = Math.max(0, target - w);
  return cell + ' '.repeat(pad);
}

const file = process.argv[2];
const dry = process.argv[3] === 'dry';
let text = fs.readFileSync(file, 'utf8');
const lines = text.split(/\r?\n/);

// 收集所有表格行
const tableLines = lines.filter((l) => /^\|/.test(l));
const rows = tableLines.map((l) => splitRow(l));
const nColsRaw = rows.length ? rows[0].length : 0;

// 计算每列是否全空（装饰列）
const allEmpty = new Array(nColsRaw).fill(true);
for (const parts of rows) {
  for (let c = 0; c < nColsRaw; c++) {
    const cell = (parts[c] || '').trim();
    if (cell !== '' && !/^-{3,}$/.test(cell)) allEmpty[c] = false;
  }
}
// 保留列：非全空列
const keepCols = [];
for (let c = 0; c < nColsRaw; c++) if (!allEmpty[c]) keepCols.push(c);
const nCols = keepCols.length;

// 全局列宽
const widths = new Array(nCols).fill(3);
for (const parts of rows) {
  for (let k = 0; k < nCols; k++) {
    const cell = (parts[keepCols[k]] || '').trim();
    widths[k] = Math.max(widths[k], cellWidth(cell));
  }
}

// 重新生成所有行
const outLines = lines.map((line) => {
  if (!/^\|/.test(line)) return line;
  const parts = splitRow(line);
  let out = '|';
  for (let k = 0; k < nCols; k++) {
    const cell = (parts[keepCols[k]] || '').trim();
    if (/^-{3,}$/.test(cell)) {
      out += ' ' + '-'.repeat(widths[k]) + ' |';
    } else {
      out += ' ' + padCell(cell, widths[k]) + ' |';
    }
  }
  return out;
});

const result = outLines.join('\n');
console.log(`文件: ${file} | 列宽模板: ${widths.join('/')} | 字符数: ${text.length} -> ${result.length}`);
if (!dry) fs.writeFileSync(file, result, 'utf8');
