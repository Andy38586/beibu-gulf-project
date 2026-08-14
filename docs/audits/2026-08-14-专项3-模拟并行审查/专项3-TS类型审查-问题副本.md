# 专项3-TS类型审查-问题副本（2026-08-14 模拟并行）

> 产出统一规范见 `00-审查体系约定.md` §4；经用户裁决后转正主台账（discover = 2026-08-14）。

## 2.1（P1，切片 A）
- **证据**：frontend/src/core/map/renderers/CesiumRenderer.ts:26处
- **风险等级**：P1
- **发现**：: any 共 26 处(文件数 1)
- **整改建议**：修复或进待解决问题清单
- **验收标准**：复跑对应机械检查项，计数归零或人工确认豁免

## 2.2（P3，切片 A）
- **证据**：frontend/src/core/map/renderers/CesiumRenderer.ts:1处; frontend/src/core/map/renderers/OLRenderer.ts:5处
- **风险等级**：P3
- **发现**：as any 共 6 处
- **整改建议**：可接受或顺手修
- **验收标准**：复跑对应机械检查项，计数归零或人工确认豁免

## 2.4（P1，切片 A）
- **证据**：frontend/src/core/map/renderers/__tests__/CesiumRenderer.geojson.test.ts:1处; frontend/src/core/map/renderers/__tests__/CesiumRenderer.waterSurface.test.ts:2处
- **风险等级**：P1
- **发现**：@ts-nocheck 共 5 处(整文件关闭类型检查)
- **整改建议**：修复或进待解决问题清单
- **验收标准**：复跑对应机械检查项，计数归零或人工确认豁免

## 3.3（P3，切片 B）
- **证据**：frontend/src(抽样)
- **风险等级**：P3
- **发现**：内部函数无返回类型标注 111 处为常见形态, 需人工抽样判定
- **整改建议**：可接受或顺手修
- **验收标准**：复跑对应机械检查项，计数归零或人工确认豁免

## 3.4（P3，切片 B）
- **证据**：frontend/src/business/forecast/composables/useForecastComparison.ts; frontend/src/business/forecast/composables/useForecastLayer.ts; frontend/src/business/forecast/composables/useForecastRequest.ts
- **风险等级**：P3
- **发现**：23 个 composable 中 23 个未见显式返回类型声明(as const 也算安全)
- **整改建议**：可接受或顺手修
- **验收标准**：复跑对应机械检查项，计数归零或人工确认豁免

## 4.3（P3，切片 B）
- **证据**：frontend/src
- **风险等级**：P3
- **发现**：未发现静态数据文件, 该项 N/A
- **整改建议**：可接受或顺手修
- **验收标准**：复跑对应机械检查项，计数归零或人工确认豁免

## 4.6（P3，切片 B）
- **证据**：package.json
- **风险等级**：P3
- **发现**：无类型生成脚本, 类型同步为手工维护(4.4/4.5 需人工核对)
- **整改建议**：可接受或顺手修
- **验收标准**：复跑对应机械检查项，计数归零或人工确认豁免

## 5.4（P3，切片 C）
- **证据**：frontend/src/stores/factories/createPersistedState.ts; frontend/src/stores/floodStore.ts; frontend/src/stores/index.ts
- **风险等级**：P3
- **发现**：10 个 store 中 9 个未见泛型形式(需人工确认)
- **整改建议**：可接受或顺手修
- **验收标准**：复跑对应机械检查项，计数归零或人工确认豁免

## 5.6（P3，切片 C）
- **证据**：frontend/src
- **风险等级**：P3
- **发现**：ref(null) 无泛型 3 处(推断为 any 型 ref, 应 ref<T>(null))
- **整改建议**：可接受或顺手修
- **验收标准**：复跑对应机械检查项，计数归零或人工确认豁免

## 5.7（P3，切片 C）
- **证据**：frontend/src
- **风险等级**：P3
- **发现**：provide 5 处 / inject 4 处, 需人工确认使用 injectionKey 或泛型(默认 string key 为 any)
- **整改建议**：可接受或顺手修
- **验收标准**：复跑对应机械检查项，计数归零或人工确认豁免

## 6.1（P2，切片 C）
- **证据**：frontend/src
- **风险等级**：P2
- **发现**：as 断言共 321 处, 需人工抽样判定是否绕过类型
- **整改建议**：排期修复
- **验收标准**：复跑对应机械检查项，计数归零或人工确认豁免

## 6.5（P3，切片 C）
- **证据**：frontend/src
- **风险等级**：P3
- **发现**：interface 160 个 / type 47 个, 需人工确认选择一致性
- **整改建议**：可接受或顺手修
- **验收标准**：复跑对应机械检查项，计数归零或人工确认豁免

## 7.1（P1，切片 D）
- **证据**：frontend/src/business/site-selection/components/SiteAnalysisControlPanel.vue:202; frontend/src/core/map/composables/useBoundaryLayer.ts:27; frontend/src/shared/composables/useApiRequest.ts:176; frontend/src/shared/composables/useAuth.ts:19; frontend/src/shared/composables/useAuth.ts:90
- **风险等级**：P1
- **发现**：JSON.parse 无运行时校验 8 处(外部数据边界)
- **整改建议**：修复或进待解决问题清单
- **验收标准**：复跑对应机械检查项，计数归零或人工确认豁免

## 7.2（P3，切片 D）
- **证据**：frontend/src
- **风险等级**：P3
- **发现**：zod 相关 12 处 / 7 个文件, 覆盖率需人工核对(承诺 100%)
- **整改建议**：可接受或顺手修
- **验收标准**：复跑对应机械检查项，计数归零或人工确认豁免

## 7.3（P3，切片 D）
- **证据**：package.json
- **风险等级**：P3
- **发现**：依赖 43 个, 需人工确认 @types 缺失情况(机械仅能列依赖清单)
- **整改建议**：可接受或顺手修
- **验收标准**：复跑对应机械检查项，计数归零或人工确认豁免


---
*本副本为模拟并行审查产出（机械核对版）；人工复核项见执行记录 §3 豁免清单。*
