// 2026-08-14 审查批次修复转正: 主本《已解决问题.md》合并补记 + 新编号追加
import fs from 'node:fs'
const P = 'docs/已解决问题.md'
let t = fs.readFileSync(P, 'utf8')

// ---- 1. 合并补记: 编号 → 补记文本(追加到该条目解决方法列末尾) ----
const merges = {
  z046: 'C-10 渲染器测试注释陈旧（4 处称"带 @ts-nocheck"）已修正为"运行时成员经断言暴露"（渲染器本体 z065 已无 @ts-nocheck）。',
  a017: 'S7-04 复核补记：UnifiedMap 4 处 z-index 槽位硬编码（1/100/90）已换 var(--GCS-z-map/-map-status/-map-overlay)。',
  a048: 'F-7 复核补记：forecastStore 残留死状态 dataCache/currentData（无写路径）已移除（类型/state/restore/reset/导出/测试断言）。',
  a059: '待裁决-1 复核补记：types/renderer.ts PointFeature 注释"回退 (0,0)"已同步为"跳过该要素"，配套 heatmap.test 用例标题修正。',
  d075: '8-9 复核补记：linearDecay 补 Number.isFinite 守卫——NaN 源为 turf.distance 对无效坐标返回 NaN（非除零），补 d075 未覆盖路径。',
  z099: 'C-1/3/7 复核补记：导出辅助函数 renderer:any 全部类型化（15 处）+ 42 处 viewer 非空断言；顺带修复 _geoJsonTokens 声明/LayerState 扩展/WaterSurfaceEntry.options/屏幕事件 4 个真实类型 bug；全前端 :any 30+→1（有注释的刻意）。',
  d074: '副-07 复核补记：flood-service CORS allow_methods/headers 从通配收窄为 GET/POST + Content-Type/Authorization。',
  d065: '副-28 复核补记：logSanitizer SENSITIVE_KEYS 扩充 phone/email/idcard/id_card/mobile。',
  a052: 'F-5 复核补记：CesiumRenderer 两处 errorEvent 匿名回调提为具名（imageryErrorHandler/hillshadeErrorHandler），provider 生命周期与图层绑定。',
  d073: '8-1 复核补记：查表键改 (level*10/10).toFixed(1) 对齐表键 "3.0" 格式——整数档此前全部 miss（251 档退化 6 档），修复后实测 0/0.5/1/2.5/3/5/10/15 全命中。',
  c015: 'S7-03/S7-01 复核补记：水面/覆盖层 rgba 散落收口 LAYER_FILL_WATER/COVERAGE；flood 风险色加绑定注释（与 shared 同值对照防漂移）。',
  z050: 'F-6 复核补记：perfReporter dev entries 环形上限 MAX_DEV_ENTRIES=1000（长会话防内存增长）。',
}

// ---- 2. 新编号条目: [分节关键字, 条目行] ----
const sections = {
  地图层: [], 业务层: [], 组件层: [], 后端层: [], 暂未归类: [],
}
const row = (lv, id, title, desc, sol) =>
  `| ${lv} | ${id}-${title}<br>\`discover:20260814\`<br>\`solve:20260814\` | ${desc} | ${sol} |`

sections['地图层'].push(
  row('p2', 'a067', '底图localStorage键无版本/白名单', 'mapStore.readStoredBaseLayer 直接透传 localStorage 值，底图 key 集合演进后旧值静默降级。', 'P1-8：加 BASE_LAYER_KEYS 白名单校验（base-image/base-vector，与 UnifiedMap 注册处同源），非法值回退 null。'),
  row('p2', 'a068', 'OL un注销4处as any', 'OLRenderer 监听注销处 listener as any（类型债）。', 'C-2：listener 声明改 EventsKey[\'listener\']（OL 宽签名），4 处 as any 移除，typecheck 绿。'),
  row('p3', 'a069', 'OLRenderer TODO无上下文', 'OLRenderer:529 TODO 无背景（per-feature 样式）。', '副-31：补"v3 新选址出现差异化标注时再实现"背景，避免为假想需求预留 API。'),
  row('p2', 'a070', '北部湾bbox两处不一致', '前端 crs.ts 112/23.5 vs 后端 siteAnalysisService 115/25。', '8-8：BEIBU_GULF_BBOX 统一后端权威 115/25 + 同源注释。'),
)
sections['业务层'].push(
  row('p2', 'b066', '登出forecast快照残留', 'forecastStore 无 clearState，reset() 刻意不清快照，登出后旧会话状态残留。', 'F-3：forecastStore 补 clearState()，App.vue resetStores 登出时调用（与 flood/siteSelection 对齐）。'),
  row('p1', 'b067', '首页图表除零NaN', 'useOverviewCharts 柱状图 s.data.reduce/0 空系列 NaN。', 'P1-6：分母守卫（空系列按 0），02 §5.6 不变量 5。'),
  row('p2', 'b068', 'riskLevelCode类型缺', 'floodStatistics.json riskLevelCode 前端业务类型无字段。', 'P1-9：base.ts FloodStatistics 补 riskLevelCode?: number（schema 已有）。'),
  row('p0', 'b069', 'ports.json伪造phone', '3 个港口 phone 为 "0779-xxx"/"暂无" 占位符。', 'P0-2：删除伪造字段（前端 phone || 暂无 兜底），演示数据不编造联系方式。'),
  row('p3', 'b070', 'business模块无README', 'site-selection/forecast/flood-analysis 三模块无 README。', '副-25：补三份模块 README（职责/入口/数据流/禁止/已知）。'),
  row('p2', 'b071', 'plansController零测试', 'plansController 0% 覆盖（CRUD/鉴权）。', '副-14：新增 plansController.test.js 17 用例，backend 全量 207/207。'),
  row('p3', 'b072', 'restoreSettings Record<any>', 'SiteAnalysisControlPanel 快照恢复 Record<string,any>。', 'C-9：unknown 承接 + 字段级守卫（selected/importance 窄化）。'),
  row('p3', 'b073', '剖面渐变rgba硬编码', 'WaterLevelProfilePanel 面积渐变 rgba 两处。', 'S7-12：PROFILE_AREA_STOP_STRONG/WEAK 常量（success 绿派生）。'),
  row('p3', 'b074', 'ADR8备注过期', '03 ADR8 "收敛为一处"表述与现状不符。', 'F-8：更新为 useLatestRequest 单实现 + useApiRequest 基础层分工 + z071 路由级取消未做。'),
  row('p1', 'b075', 'mapDataService无zod校验', '/api/ports 边界仅 Array.isArray 守卫。', 'C-4/6：schemas.ts 补 portSchema/portsArraySchema，getPorts safeParse。'),
  row('p2', 'b076', 'floodAdapter零日志', '数据源分流/档位缓存/演算结果链路黑盒。', 'P1-10/11/12：补 logger（online 缓存命中/演算完成/api 分流/impact 两模式）。'),
)
sections['组件层'].push(
  row('p3', 'c039', '自绘按钮无focus环', '键盘导航无可视焦点（a11y）。', 'S7-06：全局 :focus-visible outline（--GCS-border-focus）。'),
  row('p3', 'c040', 'placeholder对比度不足', '亮 1.75:1 / 暗 2.98:1（<4.5:1）。', 'S7-21：两主题提至与 text-muted 同档（亮 #909399 / 暗 #7a8694）。'),
  row('p3', 'c041', '滑块thumb尺寸不一致', 'conf 14px vs t 18px。', 'S7-19：统一 16px + primary 边框/阴影。'),
  row('p3', 'c042', '占位框边框写死', 'FloodAnalysisPage 占位框 rgb(255 255 255 / 20%)。', 'S7-18：改 1px dashed var(--GCS-border-default)。'),
  row('p3', 'c043', '未定义token静默fallback', 'GCSModal/GCSToast 引用 --GCS-cell/--GCS-font-size-body（未定义，fallback 生效）。', 'S7-08/23：style.css 补正式定义（--GCS-cell:80px 与 CELL_PIXEL 同源；--GCS-font-size-body:14px）。'),
  row('p2', 'c044', 'shared深路径导入', '8 个 shared 外部文件 9 处 @/shared/utils/* 穿透。', '副-02：收口 @/shared 桶入口（shared/index.ts 补 perfReporter 导出）。'),
  row('p3', 'c045', '注释漂移两处', 'DebugToggle z-index 1100 过期；style.css 断点 768px 错。', 'S7-24/S7-05：注释修正（z-index 引用 token；断点 <960px 档位 2/3）。'),
)
sections['后端层'].push(
  row('p1', 'd083', '选址坐标零防御', '设施/小区无效坐标致评分 NaN 或整类 0 分。', '8-4：buildFacilityIndex 过滤无效坐标+告警；小区坐标无效按 0 分。'),
  row('p1', 'd084', '错误嵌入成功信封', '历史数据不足 metadata.error 塞 code=0 信封。', '8-12：forecastService 两处抛 BusinessError(ANALYSIS_FAILED)（R7）。'),
  row('p2', 'd085', 'cargo缓存键冗余', '模型指标 scenarioLevel 恒 1.0 致同结果多键。', '8-14：getCacheKey 对 MODEL_INDICATORS 忽略 scenarioLevel。'),
  row('p1', 'd086', '演算无回归测试', 'test_main.py 全 mock engine，真连通演算从未执行。', '8-2：新增 test_real_engine.py 4 用例（0 水位无淹没/面积单调/GeoJSON 合法/性能哨兵），CI 无 DEM 自动 skip，本地 4/4 通过。'),
  row('p2', 'd087', 'createReadCache零单测', '缓存工厂无测试引用。', '8-3：新增 createReadCache.test.js（命中/TTL/FIFO 上限/has/clear）。'),
  row('p2', 'd088', '水位0档虚淹没', '预计算 0 档 floodedKm2=6.87 但 features 空，UI 数字与地图矛盾。', '8-6：main.py flood_online key<=0 时 floodedKm2 归零（02 §4.3 水位 0=无淹没）。'),
  row('p3', 'd089', '日志保留14天偏短', '故障排查无法跨两周回溯。', '副-18：MAX_FILES 30。'),
  row('p3', 'd090', 'backend测试5s超时flake', 'app/health 测试冷启动超时偶发。', '副-15：vitest testTimeout/hookTimeout 20000。'),
  row('p3', 'd091', 'Python依赖无锁', 'requirements.txt 仅 >=。', '副-09：requirements.lock.txt（venv freeze 26 包固定）。'),
  row('p2', 'd092', '无CSP', 'SPA 无内容安全策略。', '副-08：nginx Content-Security-Policy-Report-Only（过渡宽松值+收紧方向注释）。'),
  row('p2', 'd093', 'waterLevel参数名分裂', 'online 模式 level vs api 模式 waterLevel。', 'b027：前端 floodAdapter 两处 params:{waterLevel}；FastAPI online/impact Query(waterLevel)；测试与契约文档同步（pytest 6/6）。'),
  row('p2', 'd094', 'plansController直连仓库', '无 service 层（三层分离违规）。', 'd080：plansService 8 方法收口，controller 改调（207/207）。'),
)
sections['暂未归类'].push(
  row('p2', 'z106', '前后端端点对账', '孤儿/未登记端点需机械核验。', 'P1-2：tools/check-endpoints.mjs 留存——21 端点全对账无孤儿/断链。'),
  row('p3', 'z107', '无token统计脚本', '死 token 检测无工具。', 'S7-26：tools/token-stats.mjs（定义/引用统计，≤5% 门禁，实测 45 token 全活）。'),
  row('p3', 'z108', '无token变更SOP', 'token 改/删无流程。', 'S7-10/11/27：03 §三.5（改前查/改名留映射/双份同步/删除先验/验收）。'),
  row('p2', 'z109', '覆盖率阈值形同虚设', 'frontend 阈值 25/20/15/25 过低。', 'z103：提升 30/25/18/30（留余量防假红，60% 目标挂下阶段）。'),
  row('p3', 'z110', '根缺.env.example', '仓库根无环境变量模板。', '副-04：补 .env.example（VITE_* 占位 + 后端变量注释）。'),
  row('p3', 'z111', '信封code表述漂移', '03 写 code=0，活文档与实现为 code=同 HTTP 状态。', 'P1-13：03 对齐活文档（API契约文档 §1.1 权威）。'),
  row('p3', 'z112', 'fix无测试约定', '历史 15 个 fix 仅 2 个带测试。', '副-27：03 §1.6 补"fix 必须附测试/回归说明"。'),
  row('p2', 'z113', '相机pitch硬编码', '引擎切换 pitch=-90 魔法值。', 'z076：DEFAULT_CAMERA_PITCH_DEG 常量 + 刻意设计注释（引擎切换不传倾斜）。'),
  row('p3', 'z114', 'setTerrainEnabled无调用方', '预留钩子无接线且无标注。', 'z105：@arch-note 预留标注（layerAdapters geotiff 走普通显隐，L350 状态延续依赖）。'),
)

// ---- 3. 合并补记 ----
for (const [id, note] of Object.entries(merges)) {
  const re = new RegExp(`^(\\|\\s*p[0-3]\\s*\\|\\s*${id}[-－][^\\n]*?)(\\|\\s*)$`, 'm')
  if (!re.test(t)) { console.log(`⚠️ 合并目标未找到: ${id}`); continue }
  t = t.replace(re, `$1<br>**2026-08-14 复核补记**：${note}$2`)
}

// ---- 4. 新条目追加(各分节表格末尾 = 下一个 ## 前) ----
const sectionOrder = ['地图层', '业务层', '组件层', '后端层', '暂未归类']
for (const name of sectionOrder) {
  const rows = sections[name]
  if (!rows.length) continue
  const marker = `## ${name}`
  const si = t.indexOf(marker)
  if (si === -1) { console.log(`⚠️ 分节未找到: ${name}`); continue }
  // 找本分节末尾: 下一个 ## 或文件尾
  const next = t.indexOf('\n## ', si + marker.length)
  const end = next === -1 ? t.length : next
  const insert = '\n' + rows.join('\n') + '\n'
  t = t.slice(0, end) + insert + t.slice(end)
  console.log(`${name}: 追加 ${rows.length} 条`)
}

fs.writeFileSync(P, t, 'utf8')
console.log('完成')
