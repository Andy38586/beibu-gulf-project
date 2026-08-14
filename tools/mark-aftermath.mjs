// 后遗症副本: 已核实/已注明/已登记 标注(2026-08-14 审查批次复核)
import fs from 'node:fs'
const P = 'docs/问题副本-2026-08-14-已解决后遗症.md'
let t = fs.readFileSync(P, 'utf8')

const marks = [
  ['a043', '**✅ 已核实（2026-08-14）**：UnifiedMap.vue L474-475 onUnmounted 确有 `resizeObserver?.disconnect(); resizeObserver = null`（配对契约注释）；待解决 md 无残留——已解决档案正确，矛盾源于旧文本，已消除。'],
  ['b025', '**✅ 已注明设计（2026-08-14）**：berth/traffic 恒为合成示意是 02 §4.2 已知边界（诚实标注）；forecastService SYNTHETIC_INDICATORS 注释明确"文件自带 forecast 直接透传"，不接 VITE_DATA_SOURCE 属设计非半接入。'],
  ['b058', '**✅ 已注明设计（2026-08-14）**：FastAPI 确不返回 riskLevel；前端 `_riskLevelFromFlood` 与后端 deriveRiskLevel 同表映射（floodAdapter L45-49 注释为唯一权威），双模式口径一致，无隐性不一致。'],
  ['c021', '**✅ 已登记（2026-08-14）**：登录态放开（仅收藏需登录）为 02 §4.5 拍板期望 + 03 §六 未完成清单显式登记，承接 v3 阶段1（auth 迁移 Nest）。'],
  ['c029', '**✅ 已补结论（2026-08-14）**：空数据占位处理结论登记——PaginatedListPanel/RadarChart 空态为"已确认豁免"（演示场景 toast 足够，见副-04 裁决）。'],
  ['c031', '**✅ 已解决（2026-08-14 核实）**：useAsyncData 文件全库 0 命中（已不存在），死工具已删。'],
  ['c033', '**✅ 已注明（2026-08-14 核实）**：选择器为 `.GCS-drawer__body .GCS-panel`（精确到面板，非 `.GCS-panel > *` 全部子元素），L235 注释说明 !important 覆盖内联定位的必要性。'],
  ['d055', '**✅ 已登记（2026-08-14）**：边界用例补充项登记为低危可选项（洪涝档位边界测试随 8-2 真演算回归批次已补主路径）。'],
  ['a034', '**✅ 已登记（2026-08-14）**：spatialQuery.js 改名登记为演进项（影响面大，随 v3 后端迁移批处理）。'],
  ['a020', '**📋 人工动作已登记（2026-08-14 核验单）**：浏览器三项验收记录（FCP/2D→3D 切换/557 小区渲染）待执行。'],
  ['d044', '**📋 人工动作已登记（2026-08-14 核验单）**：git-clean-history.sh 上线前执行（明文探针账号清理），与 d056 合并跟踪。'],
  ['d056', '**📋 人工动作已登记（2026-08-14 核验单）**：天地图 key 轮换 + git 历史清理，挂上线核验单。'],
]

let done = 0
for (const [id, mark] of marks) {
  // 定位该编号所在行, 在其"现状与建议处置"列末尾(行尾 | 前)插入标注
  const re = new RegExp(`^(\\|\\s*${id}[^\\n]*?)(\\|\\s*)$`, 'm')
  if (!re.test(t)) { console.log(`⚠️ 未找到: ${id}`); continue }
  t = t.replace(re, `$1<br>${mark}$2`)
  done++
}
fs.writeFileSync(P, t, 'utf8')
console.log(`标注完成: ${done}/${marks.length}`)
