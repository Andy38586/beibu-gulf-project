// md → 可手写 PDF（A4 大边距）转换脚本
// 用法: node md-to-handwrite-pdf.js <input.md> <output.html>
// 然后: msedge --headless --disable-gpu --print-to-pdf=out.pdf out.html
const fs = require('fs')

const input = process.argv[2]
const output = process.argv[3]
let md = fs.readFileSync(input, 'utf8')

// 1. 代码块先占位（避免被后续规则破坏）
const codeBlocks = []
md = md.replace(/```(\w*)\n([\s\S]*?)```/g, (m, lang, code) => {
  const idx = codeBlocks.length
  codeBlocks.push({ lang, code: code.replace(/\n$/, '') })
  return `@@CODE${idx}@@`
})

// 2. 表格
md = md.replace(/\n\|[^\n]+\|\n\|[-| :]+\|\n((?:\|[^\n]+\|\n)*)/g, (m, rows) => {
  const lines = rows.trim().split('\n').map((r) =>
    r
      .replace(/^\||\|$/g, '')
      .split('|')
      .map((c) => c.trim())
  )
  const head = lines[0]
  const body = lines.slice(1)
  let html = '<table>'
  html += '<thead><tr>' + head.map((c) => `<th>${c}</th>`).join('') + '</tr></thead>'
  html += '<tbody>' + body.map((r) => '<tr>' + r.map((c) => `<td>${c}</td>`).join('') + '</tr>').join('') + '</tbody>'
  html += '</table>'
  return '\n' + html + '\n'
})

// 3. 行内代码
md = md.replace(/`([^`]+)`/g, '<code>$1</code>')

// 4. 标题
md = md.replace(/^### (.*)$/gm, '<h3>$1</h3>')
md = md.replace(/^## (.*)$/gm, '<h2>$1</h2>')
md = md.replace(/^# (.*)$/gm, '<h1>$1</h1>')

// 5. 加粗/斜体
md = md.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
md = md.replace(/\*([^*]+)\*/g, '<em>$1</em>')

// 6. 引用
md = md.replace(/^&gt; (.*)$/gm, '<blockquote>$1</blockquote>')

// 7. 无序列表
md = md.replace(/^- (.*)$/gm, '<li>$1</li>')
md = md.replace(/(<li>[\s\S]*?<\/li>)(?=\n<li>|$)/g, '<ul>$1</ul>')

// 8. 手写留白标记：==写== 转成答题区
md = md.replace(/==写==/g, '<div class="write-area"></div>')

// 9. 段落
md = md.replace(/\n\n/g, '</p><p>')
md = md.replace(/^(?!<)/gm, '')

// 10. 恢复代码块
md = md.replace(/@@CODE(\d+)@@/g, (m, idx) => {
  const { lang, code } = codeBlocks[idx]
  return `<pre class="code" data-lang="${lang}"><code>${code.replace(/</g, '&lt;').replace(/>/g, '&gt;')}</code></pre>`
})

const html = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<style>
  @page { size: A4; margin: 14mm 12mm 16mm 12mm; }
  body { font-family: "Microsoft YaHei", "PingFang SC", sans-serif; font-size: 10.5pt; line-height: 1.7; color: #1a1a1a; }
  h1 { font-size: 20pt; border-bottom: 3px solid #2b5c8a; padding-bottom: 6px; color: #2b5c8a; }
  h2 { font-size: 15pt; margin-top: 18px; padding: 5px 10px; background: #eef3f8; border-left: 5px solid #2b5c8a; color: #2b5c8a; }
  h3 { font-size: 12pt; margin-top: 14px; color: #1a4a72; }
  table { border-collapse: collapse; width: 100%; margin: 8px 0; font-size: 9.5pt; page-break-inside: auto; }
  th { background: #2b5c8a; color: #fff; padding: 5px 8px; text-align: left; }
  td { border: 1px solid #bbb; padding: 5px 8px; vertical-align: top; }
  tr { page-break-inside: avoid; }
  code { background: #f4f4f4; padding: 1px 4px; border-radius: 3px; font-family: Consolas, monospace; font-size: 9pt; }
  pre.code { background: #f7f7f7; border: 1px solid #ddd; border-radius: 4px; padding: 8px 10px; font-family: Consolas, "Courier New", monospace; font-size: 8pt; line-height: 1.45; white-space: pre-wrap; word-break: break-all; margin: 6px 0; page-break-inside: avoid; }
  .write-area { height: 55px; border-bottom: 1.5px dashed #bbb; margin: 8px 0 14px 0; }
  blockquote { border-left: 4px solid #ccc; margin: 8px 0; padding: 4px 12px; color: #555; background: #fafafa; }
  ul { margin: 4px 0; padding-left: 22px; }
  li { margin: 2px 0; }
  p { margin: 6px 0; }
</style>
</head>
<body>
<p>${md}</p>
</body>
</html>`

fs.writeFileSync(output, html, 'utf8')
console.log(`HTML 已生成: ${output}`)
