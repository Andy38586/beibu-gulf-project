const fs = require('fs')
const path = require('path')

const file = path.join(__dirname, '..', 'docs', '已解决问题.md')
let content = fs.readFileSync(file, 'utf8')
const lines = content.split('\n')

// 1. 移出 27 条设计豁免/证伪条目
const removeIds = [
  'a021',
  'b001',
  'b002',
  'b003',
  'b006',
  'b007',
  'b013',
  'b014',
  'b015',
  'b016',
  'b017',
  'b023',
  'b038',
  'b055',
  'b056',
  'c021',
  'd001',
  'd008',
  'd010',
  'd039',
  'd055',
  'z006',
  'z007',
  'z015',
  'z016',
  'z017',
  'z041',
]
const entryRe = /^\|\s*p\d\s*\|\s*([a-z]\d{3})[-\s]/
const kept = lines.filter((line) => {
  const m = line.match(entryRe)
  return !(m && removeIds.includes(m[1]))
})
content = kept.join('\n')

// 2. 清理外部文档引用
content = content.replace(/\s*`来源:[^`]*`/g, '')
content = content.replace(/\s*\(详见 `[^`]*`\)/g, '')
content = content.replace(/面试压力测试审查报告[^`，;。()]*/g, '')
content = content.replace(/面试压力测试报告-2026-08-03\.md/g, '')
content = content.replace(/8\.2审计·[^`，;。]*/g, '')
content = content.replace(/原 `docs\/遗留问题\.md` 复查/g, '2026-08-11 复查')
content = content.replace(/\*\*解决方案\*\*\(\):/g, '**解决方案**:')

// 3. 文件头纪律说明
content = content.replace(
  '> **来源整合**：整合原《已解决问题.md》六节全部已闭环项，并承接《待解决问题.md》经 2026-07-30 基准复核迁出的设计意图类（A01–A04、E01、E16、D08、E14残留、S01–S06）。',
  '> **来源整合**：整合原《已解决问题.md》六节全部已闭环项。\n> **台账纪律（2026-08-11 定）**：①设计豁免/有意拍板/证伪类条目**不再入档**——"问题无需存在"，由各设计文档（根基文档/ADR）承载决策，不占已解决名额；②条目描述/解决**不引用其他文档**——描述自包含（file:line 代码证据保留），解决靠代码/测试/验证闭环。'
)

// 4. 补录 b027
content = content.replace(
  '| p2 | b063-预测指标切换覆盖手动隐藏<br>`discover:20260811`<br>`solve:20260812` | useForecastLayer 指标切换 watch 无条件 `setVisible(newKey, true)`——用户在面板手动隐藏过的图层被强制重开，覆盖用户意图。 | 2026-08-12 修复：newKey 以 registry 显隐意图为准——renderer 已有实例（用户操作过）不强制重开，仅首次激活（无实例）自动显示。typecheck 绿 + 前端测试全绿。 |',
  '| p2 | b063-预测指标切换覆盖手动隐藏<br>`discover:20260811`<br>`solve:20260812` | useForecastLayer 指标切换 watch 无条件 `setVisible(newKey, true)`——用户在面板手动隐藏过的图层被强制重开，覆盖用户意图。 | 2026-08-12 修复：newKey 以 registry 显隐意图为准——renderer 已有实例（用户操作过）不强制重开，仅首次激活（无实例）自动显示。typecheck 绿 + 前端测试全绿。 |\n| p2 | b027-waterLevel传参姿势分裂（核实为契约差异）<br>`discover:20260801`<br>`solve:20260811` | api 模式 GET 用 `params:{waterLevel}`、POST 影响评估用 `body:{waterLevel}`、online 模式用 `params:{level}`——三套参数形态并存曾被质疑"前后端易漂移"。 | 2026-08-11 核实闭环（非 bug）：GET 用 query / POST 用 body 属标准 REST 实践（各语义正确）；online 的 `level` 参数名是 FastAPI 契约（`main.py` `Query(..., ge=-1, le=25)`），与 Express 的 `waterLevel` 各对齐各自后端——**契约差异而非缺陷**，无需统一；仅需在 adapter 注释说明差异缘由。移出 `待解决问题.md`。 |'
)

fs.writeFileSync(file, content, 'utf8')
console.log('移出+清理+补录+文件头完成')
