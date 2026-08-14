// 为 47 项已修复做"主本重复匹配"扫描: 每项给关键词, 在主本已解决问题.md 找同主题条目
import fs from 'node:fs'
const main = fs.readFileSync('docs/已解决问题.md', 'utf8')
const lines = main.split('\n')

// 编号 → 该条目全文(跨行, 到下一个 | p 行)
const entries = []
let cur = null
for (const l of lines) {
  const m = l.match(/^\|\s*p[0-3]\s*\|\s*([a-z]\d{3})/)
  if (m) {
    if (cur) entries.push(cur)
    cur = { id: m[1], text: l }
  } else if (cur) {
    cur.text += '\n' + l
  }
}
if (cur) entries.push(cur)

// 修复项 → 关键词(命中即候选重复)
const items = {
  '8-1 查表键': ['查表', '251 档', 'toFixed', '档位表'],
  '8-6 0档虚淹没': ['水位 0', '无淹没', '海面种子'],
  '8-4/8-9 坐标防御': ['坐标无效', 'NaN', 'linearDecay', '衰减'],
  '8-8 bbox': ['bbox', '边界', '105-115'],
  '8-12 错误信封': ['metadata.error', '错误信封', '成功信封'],
  '8-14 缓存键': ['缓存键', 'scenarioLevel', '缓存冗余'],
  '8-2 演算测试': ['演算', 'flood_engine', '连通性'],
  '8-3 缓存单测': ['createReadCache', '缓存测试'],
  'F-3 登出快照': ['登出', '快照', 'resetStores'],
  'F-5 监听具名': ['errorEvent', '匿名监听', 'addEventListener'],
  'F-6 环形上限': ['perfReporter', 'entries', '无限增长'],
  'F-7 死状态': ['死状态', 'cacheData', 'currentData'],
  'F-8 ADR8': ['ADR8', 'useLatestRequest', '竞态'],
  'P0-2 占位符': ['占位符', 'ports.json', '0779'],
  'P1-6 除零': ['除零', '分母', 'reduce'],
  'P1-8 底图键': ['localStorage', '底图', 'base-layer'],
  'P1-9 riskLevelCode': ['riskLevelCode', 'riskLevel'],
  'P1-13 契约文档': ['信封', 'code=0', '契约'],
  'P1-10/11/12 日志': ['日志', '可观测', 'logger'],
  '副-18 日志保留': ['MAX_FILES', '保留 14', '日志轮转'],
  '副-28 PII': ['脱敏', 'PII', 'logSanitizer'],
  '副-15 超时': ['testTimeout', '超时', 'flake'],
  '副-09 锁文件': ['requirements', '依赖锁', 'pip'],
  '副-07 CORS': ['CORS', 'allow_origins'],
  '副-08 CSP': ['CSP', 'Content-Security'],
  '副-02 深路径': ['深路径', '桶入口', 'no-restricted'],
  '副-14 plans测试': ['plansController', '方案测试'],
  '副-25 README': ['README', 'business'],
  'd080 plansService': ['plansService', '直连仓库', 'service 层'],
  'b027 参数名': ['waterLevel', '参数名'],
  'z076 pitch': ['pitch', '俯视'],
  'z103 阈值': ['阈值', 'coverage', '覆盖率'],
  'C-1/3/7 类型债': ['类型债', 'renderer: any', ': any'],
  'C-2 OL un': ['un(', 'as any', 'listener'],
  'C-9 unknown': ['Record<string, any>', 'restoreSettings'],
  'C-4/6 schema': ['portsSchema', 'loadStatic', 'schema'],
  'C-10 注释': ['@ts-nocheck', '测试注释'],
  'S7-04 z-index': ['z-index', '刻度', '--GCS-z'],
  'S7-26 token脚本': ['死 token', 'token 统计', 'token-stats'],
  'S7-10 SOP': ['SOP', 'token 变更'],
  'S7-03 渲染色': ['rgba', 'LAYER_DEFAULTS', '渲染色'],
  'S7-21 placeholder': ['placeholder', '对比度'],
  'S7-19 thumb': ['thumb', '滑块'],
  'S7-06 focus': ['focus-visible', 'a11y'],
  'S7-18 边框': ['边框色', 'dashed'],
  'S7-12 渐变': ['渐变', 'LinearGradient'],
  'S7-01 风险色': ['风险等级配色', 'FLOOD_RISK'],
}

for (const [name, kws] of Object.entries(items)) {
  const hits = []
  for (const e of entries) {
    if (kws.some((k) => e.text.includes(k))) hits.push(e.id)
  }
  console.log(`${name}: ${hits.length ? hits.slice(0, 6).join(',') : '(无命中)'}`)
}
