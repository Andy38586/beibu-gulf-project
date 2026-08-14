// 生成 90 条问题裁决总表(从问题副本解析 + 状态映射)
import fs from 'node:fs'

const copy = fs.readFileSync('docs/问题副本-2026-08-12-专项审查总问题.md', 'utf8')
const lines = copy.split('\n')

// 状态映射: 原编号(合并行拆开) -> [状态, 依据]
const STATUS = {
  'P0-2': ['✅已修', '批次1: ports.json 删除伪造 phone'],
  '8-1': ['✅已修', '批次1: toFixed(1) 整数档命中 251 表'],
  '8-6': ['✅已修', '批次1: FastAPI 0 档 floodedKm2 归零'],
  'P1-6': ['✅已修', '批次1: 分母守卫'],
  'F-3': ['✅已修', '批次1: forecastStore.clearState + App.vue'],
  'P1-13': ['✅已修', '批次1: 03 文档 code=同HTTP状态'],
  'P1-8': ['✅已修', '批次1: 底图 key 白名单校验'],
  '副-18': ['✅已修', '批次2: MAX_FILES 30'],
  '副-28': ['✅已修', '批次2: PII 键扩充'],
  '副-31': ['✅已修', '批次2: TODO 上下文'],
  '副-15': ['✅已修', '批次2: testTimeout 20000'],
  '待裁决-1': ['✅已修', '批次2: 注释修正(a059 skip)'],
  'S7-25': ['✅已修', '批次2: ci.yml z101'],
  '副-09': ['✅已修', '批次2: requirements.lock.txt'],
  '副-07': ['✅已修', '批次2: CORS methods/headers 收窄'],
  '副-27': ['✅已修', '批次2: 03 补 fix 附测试约定'],
  'C-4/6': ['✅已修', '批次2: portsSchema + safeParse'],
  'C-10': ['✅已修', '批次2: 4 处测试注释修正'],
  'P1-9': ['✅已修', '批次2: base.ts riskLevelCode'],
  '8-2': ['✅已修', '批次2: 真演算回归测试 4/4 通过'],
  '8-3': ['✅已修', '批次2: createReadCache 单测'],
  'S7-24': ['✅已修', '批次3: DebugToggle 注释'],
  'S7-05': ['✅已修', '批次3: style.css 断点注释'],
  'S7-28': ['✅已修', '批次3: 专项7 H.5 命令修复'],
  'S7-29': ['✅已修', '批次3: 专项7 基线更新'],
  '副-08': ['🟡部分', '批次3: CSP Report-Only 已加, 逐步收紧'],
  'F-1': ['❌不修', '审查误判: local 是 UI 镜像无写回'],
  'P1-1': ['❌不修', '已走统一入口(apiRequest/loadStatic)'],
  'P1-7': ['❌不修', '已集中(facilityLabels.ts 万元/亿)'],
  '8-5': ['❌不修', '已解决: README:12 已诚实标注'],
  '副-11': ['❌不修', '已知权衡(c011/WorkBuddy 注释)'],
  'P1-2': ['❌不修', '对账通过: 无孤儿/断链(脚本留存)'],
  'P1-10/11/12': ['✅已修', '批次3: floodAdapter 补日志'],
  'S7-30': ['🟡豁免', '批次3: 品牌蓝对比度登记豁免注释(redesign 处理)'],
  'S7-31': ['✅已修', '批次3: FACILITY_FALLBACK_COLOR 收口两处 #666'],
  '2.4': ['❌证伪', '文件级 @ts-nocheck=0(仅注释字样), 误导注释批次2已修'],
  '8-4': ['✅已修', '批次4: 设施/小区坐标防御(无效坐标过滤+0分告警)'],
  '8-9': ['✅已修', '批次4: linearDecay NaN 守卫(无效坐标穿透)'],
  '8-8': ['✅已修', '批次4: bbox 统一后端权威 115/25'],
  '8-12': ['✅已修', '批次4: 历史数据不足抛 BusinessError(R7)'],
  '8-14': ['✅已修', '批次4: 模型指标缓存键忽略 scenarioLevel'],
  '8-10': ['❌不修', '已解决: 查表→回退6档→空间筛选同源, 空floodZone返回空'],
  'C-1/3/7': ['✅已修', '批次4: 渲染器类型债收口(15处renderer类型化+42断言+4个真实类型bug), 全前端 :any 剩1处(有注释)'],
  'C-2': ['✅已修', '批次4: OL un 注销 4 处 as any 移除(EventsKey[listener])'],
  'C-9': ['✅已修', '批次4: restoreSettings unknown+守卫'],
  'F-5': ['✅已修', '批次5: errorEvent 回调具名化(provider生命周期绑定)'],
  'F-6': ['✅已修', '批次5: perfReporter entries 环形上限 1000'],
  'F-7': ['✅已修', '批次5: dataCache/currentData 死状态移除'],
  'F-8': ['✅已修', '批次5: ADR8 备注更新(useLatestRequest 分工+z071)'],
  '副-02': ['✅已修', '批次5: 9 处深路径收口 @/shared 桶入口'],
  '副-14': ['✅已修', '批次5: plansController 17 用例(207/207 全量通过)'],
  '副-25': ['✅已修', '批次5: business 三模块 README'],
  'P2-1': ['✅已修', '批次5: API契约文档补 flood-online/impact'],
  'P2-2': ['❌不修', '命名合规(动词+对象+细节), 落位模块内可接受'],
  'P2-4': ['❌不修', '已注明(语义注释落地); ports id vs berth portId 属不同键体系'],
  'P3-1': ['❌不修', '已解决: .env.local 无 mock 残留, loadStatic 注释正常'],
  '副-04': ['🟡部分', '批次5: c036 错误呈现已落地(showWarning); retry 按钮缺→可接受'],
  '副-03': ['⏳v3', '批次6: 与 a066 命名空间化同批(阶段2 热插拔)'],
  'S7-03': ['✅已修', '批次6: 水面/覆盖层 rgba 收口 LAYER_FILL_WATER/COVERAGE'],
  'S7-10': ['✅已修', '批次6: 03 §三.5 Token 变更 SOP'],
  'S7-26': ['✅已修', '批次6: tools/token-stats.mjs(实测 45 token 全活)'],
  'S7-01': ['✅已修', '批次6: flood 风险色绑定注释(防 shared 双份漂移)'],
  'S7-07': ['❌不修', '已解决: 死 token 实测 0(占比 0%)'],
  'S7-11': ['✅已修', '批次6: §三.5 SOP 第3条双份同步规则'],
  'S7-14': ['❌不修', '已注明: style.css L10"系统只有一个交互色"即来源注释'],
  'S7-16': ['❌不修', '已解决: RadarScoreTooltip 已全 token 化(var(--GCS-shadow-sm))'],
  'S7-27': ['✅已修', '批次6: §三.5 SOP 删除先验(死 token 清单机制)'],
  '3.3': ['🟡可接受', '模拟批: 内部函数无返回类型 111 处, TS 推断安全, 抽样确认'],
  '3.4': ['🟡可接受', '模拟批: composable 无显式返回类型, as const 安全'],
  '4.6': ['⏳v3', '模拟批: 类型生成脚本随 v3 OpenAPI 契约先行'],
  '5.4': ['🟡可接受', '模拟批: 选项式 store 推断安全'],
  '5.6': ['🟡可接受', '模拟批: ref(null) 3 处, 均无 any 泄漏(推断类型安全)'],
  '5.7': ['🟡待确认', '模拟批: provide/inject 5/4 处, 待确认 injectionKey 用法'],
  '6.5': ['🟡可接受', '模拟批: interface 160/type 47, 语义优先选择一致'],
  '7.2': ['🟡待确认', '模拟批: zod 覆盖率人工核对(承诺 100%)'],
  '7.3': ['🟡可接受', '模拟批: 依赖 43 个 @types 覆盖已确认'],
}

// 解析"三、新立案"表格(到 "## 四、" 为止; 含 08-14 模拟并行批次与 S7-30/31 追加行)
const rows = []
let inNew = false
for (const l of lines) {
  if (l.startsWith('## 三、')) { inNew = true; continue }
  if (inNew && l.startsWith('## ')) break
  if (!inNew) continue
  const m = l.match(/^\|\s*(专项\d\s+([\u4e00-\u9fa5A-Za-z0-9\-/\.]+))\s*\|\s*(P[0-3])\s*\|\s*([^|]+)\|/)
  if (m) rows.push({ spec: m[1].trim(), id: m[2], level: m[3], title: m[4].trim() })
}

// 行级裁决(合并行如 P1-4/5 按一组计——副本同根因合并, 状态映射以合并组为单位)
const expanded = rows
const byLevel = { P0: [], P1: [], P2: [], P3: [] }
for (const r of expanded) {
  const st = STATUS[r.id]
  byLevel[r.level].push({ ...r, status: st ? st[0] : '⏳待处理', why: st ? st[1] : '' })
}

let out = `# 00-裁决总表（问题副本 95 行 · 2026-08-14 裁决）

> 裁决基准：根基文档 01/02/03 + API契约文档(活文档) + v3-发展路径。
> 状态：✅已修（含批次）/ ❌不修（审查误判/已解决/刻意设计/证伪）/ 🟡部分（渐进/豁免）/ ⏳待处理（批次4+）。
> 刻意设计与设计冲突项明细见批次记录「已裁决不修」节。回滚手段见各批次记录。
> 统计：95 行（08-12 批次 83 + 模拟批次 10 + S7-30/31 追加 2；合并行按组计，拆分约 102 项）——
> ✅已修 ${Object.values(STATUS).filter((s) => s[0] === '✅已修').length} 条，❌不修/证伪 ${Object.values(STATUS).filter((s) => s[0].startsWith('❌')).length} 条，🟡 ${Object.values(STATUS).filter((s) => s[0].startsWith('🟡')).length} 条，其余 ⏳ 待批次4+。

`

for (const lv of ['P0', 'P1', 'P2', 'P3']) {
  out += `\n## ${lv}（${byLevel[lv].length} 条）\n\n| 原编号 | 标题 | 状态 | 依据/批次 |\n| --- | --- | --- | --- |\n`
  for (const r of byLevel[lv]) {
    out += `| ${r.id} | ${r.title.slice(0, 42)} | ${r.status} | ${r.why || '待批次4+'} |\n`
  }
}
fs.writeFileSync('docs/audits/2026-08-14-问题修复批/00-裁决总表.md', out, 'utf8')
console.log(`生成完成: ${expanded.length} 条（P0=${byLevel.P0.length} P1=${byLevel.P1.length} P2=${byLevel.P2.length} P3=${byLevel.P3.length}）`)
console.log(`已裁决: ${Object.keys(STATUS).length} 组映射`)
