# backend/services — 后端业务服务层

> 各业务模块的计算逻辑层。Controller 只做参数校验 + 响应格式化，业务计算在此完成（与 forecast / site-analysis / flood 分层对齐）。

## 一、模块职责

services 承担四类业务计算：

1. **吞吐量预测**：`forecastEngine`（趋势外推算法）+ `forecastService`（数据读取/缓存/接口编排）。
2. **选址分析**：`siteAnalysisService`（覆盖范围/交集/小区筛选/排名）+ `scoringService`（距离评分）+ `decayFunctions`（衰减函数）+ `importanceMapping`（重要性→半径）。
3. **洪涝评估**：`floodService`（受影响设施筛选 + 损失计算）。
4. **用户管理**：`userService`（注册/查询/令牌吊销/密码迁移），基于 `createFileStore` 持久化。

## 二、目录结构

```
services/
├── forecastEngine.js        # computeForecast + generateSpatialValues（预测算法）
├── forecastService.js       # getMapData / getPortData / getIndicatorData / getTimeSeriesData
├── siteAnalysisService.js   # runSiteAnalysis 流程编排（覆盖/交集/筛选/排名）
├── scoringService.js        # scoreXiaoqu + DEFAULT_WEIGHTS（rbush 空间索引）
├── decayFunctions.js        # linearDecay（线性衰减）
├── importanceMapping.js     # importanceToRadius（重要性档位→半径系数）
├── floodService.js          # assessDisaster（洪涝损失评估）
├── userService.js           # 用户 CRUD + tokenVersion + 密码迁移
└── __tests__/               # floodService / forecastEngine / forecastService / siteAnalysisService
```

## 三、各服务职责与关键导出

### `forecastEngine.js` — 预测算法引擎

算法：**历史趋势模型 + 发展情景系数**（当前模拟实现，架构预留 ARIMA/XGBoost）。

- `computeForecast(historicalData, scenarioLevel=1.0, forecastMonths=120)`：按近 5 年同比算平均年增长率，趋势外推 `基值×(1+增长率×情景系数)^年数`，叠加季节性月均比例；输出 `{ forecast, metadata }`。历史数据不足 12 个月返回空预测。
- `generateSpatialValues(historicalData, forecast, timePoint, spatialFeatures)`：围绕各港口中心确定性散射 40 点填热力图。
- **诚实标注**（`b025 / D-2=A`）：散射点为**示意性合成数据**，非实测空间分布，仅用于热力图可视化填充，不可解读为真实空间离散。
- **确定性伪随机**（REQ-5）：固定种子 LCG（Park-Miller），种子由 `timePoint + 港口索引` 哈希，保证同 timePoint 重复请求结果一致、可 HTTP 缓存。
- **输入边界防御**（REQ-4）：`scenarioLevel` 非 finite/≤0 时回退 1.0。

### `forecastService.js` — 预测接口编排

- `getMapData` / `getPortData` / `getIndicatorData` / `getTimeSeriesData`：按指标/港口/时间/粒度切片返回。
- **指标白名单**（`@arch-note SEC-013`）：仅允许 `cargo` / `container`，拒绝路径遍历 `..` 及非法指标名（forecast 路由保持公开，但不接受任意输入）。
- **缓存**（`@arch-note SEC-014` / REQ-2）：`engineCache` Map 缓存引擎计算结果，key=`indicator:scenarioLevel`；条目带 `cachedAt` 时间戳，TTL 5min 超时重算（避免 `data/forecast/*.json` 更新后缓存永不失效）；`MAX_CACHE_SIZE=100` LRU 逐出防内存放大。
- 数据源：`backend/data/forecast/{indicator}.json`。

### `siteAnalysisService.js` — 选址分析流程

`runSiteAnalysis({ selectedKeys, typeSettings, facilityData, xiaoquData, weights })` 主流程：

1. `validateSelection` → `resolveRadiusSettings`（`@arch-note P1-21` 防御 selectedKeys 与 typeSettings 键集不一致；`106` 校验半径为正；`P1-08` 参数错误带码抛出）。
2. `buildTypeCoverage`：POI 去重（`314-002`）+ 过滤异常坐标 `[0,0]` 及非北部湾范围（`314-003`，经度 105-115 / 纬度 18-25）+ turf.buffer 求并（`GIS-001/007` 处理 MultiPolygon）。
3. `intersectCoverages`：多类型覆盖范围 turf.intersect 求交，失败返回 `failKey`。
4. `filterMatchedXiaoqu`：复用空间索引（`@arch-note P1-perf`）做 BBox 粗筛，避免逐点 `booleanPointInPolygon` 退化 O(F)。
5. `rankXiaoqu`：调 `scoreXiaoqu` 评分后取 Top 10。
6. `facilityPoi`：各选中类型经 `extractValidPoi`（去重 + 坐标有效 + 北部湾范围）返回全量合法 POI——评分按最近设施距离线性衰减，覆盖区外的设施同样贡献得分，全量返回保证地图所见与评分依据一致。

### `scoringService.js` — 距离评分

- `scoreXiaoqu(xiaoquList, facilityData, typeSettings, weights, decayFn)`：预构建各设施类型 rbush 索引（`d047` 替代 O(n²)），bbox 粗筛候选点 + turf 精确距离，加权平均得分。
- `DEFAULT_WEIGHTS`：hospital 1.2 / primary_school 1.0 / middle_school 1.0 / park 0.8 / bus_station 0.6 / mall 0.7。
- `distanceScore`：km→度偏移估算（纬度 /111，经度随纬度修正）。

### `decayFunctions.js` / `importanceMapping.js`

- `linearDecay(distance, maxDistance)`：`distance≥maxDistance` 返回 0，否则 `(1 - distance/maxDistance)*100`。
- `importanceToRadius(defaultRadius, importance)`：重要性 1-5 档对应系数 0.4/0.7/1.0/1.5/2.2；`@arch-note P3-10` 非表项输入取整夹取并告警，无效值按 3 处理。

### `floodService.js` — 洪涝损失评估（d041）

- `assessDisaster(facilities, level, floodZone)`：按 `elevation <= level` 筛选受影响设施，`loss = value × damageRate`，汇总 `totalLoss`。
- **脏数据防御**（B-9）：`elevation` 缺失/null 时 `null <= level` 被 JS 隐式转 0 会假阳性，故仅接受有限数值；`value`/`damageRate` 缺失时 `Number()||0` 防 `undefined*0.5=NaN` 污染 totalLoss（NaN 经 JSON 序列化为 null）。

### `userService.js` — 用户服务

- `findByUsername` / `findById` / `userExists` / `createUser` / `updateTokenVersion` / `updatePassword`。
- 持久化：`createFileStore('../data/users.json', { useCache: true })`（`d045` 启用缓存消除认证层每请求读盘）。
- `@arch-note P1-06`：`createUser` 锁内查重消除 TOCTOU 竞态。
- `@arch-note SEC-012`：`crypto.randomUUID()` 生成不可预测用户 ID。
- `@arch-note SEC-007`：`updateTokenVersion` 自增版本号使旧 token 在 `authenticate` 校验时失效（令牌吊销）。
- `@arch-note P2-10`：所有写操作构造新对象/新数组，不原地修改缓存（写盘失败时缓存不脏，避免「幽灵用户」）。
- `@arch-note P1-14`：`updatePassword` 支持登录成功后静默迁移密码哈希。

## 四、依赖关系

- **向 utils 依赖**：`fileStore.js`（userService）、`spatialIndex.js`（siteAnalysisService）、`BusinessError.js` + `ErrorCode`（错误带码）、`logger.js`。
- **向第三方依赖**：`@turf/turf`（buffer/union/intersect/booleanPointInPolygon/distance）、`rbush`（空间索引）、`fs/promises`（forecastService 读数据）。
- **内部依赖**：siteAnalysisService → scoringService + decayFunctions + importanceMapping；forecastService → forecastEngine。
- **被依赖方**：`controllers/` 各 controller 调用对应 service；`middleware/auth.js` 调 `userService.findById`。

## 五、关键约束（@arch-note）

| 标注                                                | 文件                | 约束                                                                    |
| --------------------------------------------------- | ------------------- | ----------------------------------------------------------------------- |
| `b025 / D-2=A`                                      | forecastEngine      | 散射点为示意性合成数据，非实测空间分布，仅热力图填充用                  |
| REQ-5                                               | forecastEngine      | 确定性伪随机（固定种子 LCG），保证可缓存                                |
| REQ-4                                               | forecastEngine      | 输入边界防御，scenarioLevel 非 finite/≤0 回退 1.0                       |
| `SEC-013`                                           | forecastService     | 指标白名单（cargo/container），拒绝路径遍历                             |
| `SEC-014` / REQ-2                                   | forecastService     | 缓存 TTL 5min + MAX_CACHE_SIZE=100 LRU，数据更新后自动失效              |
| `P1-21` / `106` / `P1-08`                           | siteAnalysisService | selectedKeys 与 typeSettings 键集一致性防御，半径校验，参数错误带码抛出 |
| `314-002/003`                                       | siteAnalysisService | POI 去重 + 过滤异常坐标及非北部湾范围                                   |
| `GIS-001/007`                                       | siteAnalysisService | turf.union 结果校验，MultiPolygon 保留全部 Polygon                      |
| `P1-perf`                                           | siteAnalysisService | 复用空间索引 BBox 粗筛，避免 O(F) 全量精确判定                          |
| `d047`                                              | scoringService      | 预构建 rbush 索引替代 O(n²)                                             |
| `P3-10`                                             | importanceMapping   | 非表项输入取整夹取并告警                                                |
| B-9                                                 | floodService        | elevation/value/damageRate 脏数据防御，防假阳性/NaN 污染                |
| `P1-06` / `SEC-012` / `SEC-007` / `P2-10` / `P1-14` | userService         | 锁内查重 / UUID / 令牌吊销 / 不可变更新 / 密码迁移                      |

## 六、测试

`__tests__/`：`forecastEngine.test.js`、`forecastService.test.js`、`siteAnalysisService.test.js`、`floodService.test.js`（vitest）。
