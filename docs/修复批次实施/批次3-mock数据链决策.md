# 批次3 · mock 数据链决策（6 项）

> **定位**：8.2 审计风险观察节"mock 数据贯穿全链路"四件套（b031 默认 mock + b032 waterArea + b025 berth/traffic + b029 DEM）的收口。本批为**决策驱动**批：机械项（z060）先做，决策项（D-1~D-5）等用户拍板。
>
> **涉及文件**：`frontend/.env.example`、`frontend/src/main.ts`、`frontend/src/services/dataSourceConfig.ts`、`frontend/src/services/adapters/forecastAdapter.ts`、`frontend/src/services/adapters/floodAdapter.ts`、后端 `flood`/`forecast` 路由与 service（视决策）。
>
> **⚠️ 本批实码核实更新（相对 8.2 审计）**：
> 1. **b025 部分过时**：`forecastEngine.js:106-110` 已将 `Math.random` 改为**确定性 LCG 伪随机**（REQ-5 阶段2，种子=timePoint+港口索引哈希）。"每请求随机散射"已不存在；剩余问题 = berth/traffic 指标 `INDICATOR_SOURCE` 硬编码 mock + 散射点本质仍是合成数据（非真实热力分布）。
> 2. **b032 属实**：backend `routes/` 下 grep 无 `water-area` 端点，`floodAdapter.ts:181-187` 两模式同实现。
> 3. **b029 属实**：`floodAdapter.ts:308-311` 恒返回 `{source:'mock'}`；但 `tools/dem-pipeline/` 5 个脚本已存在（01-mosaic ~ 05-fix-facility-elevation），DEM 产物已生成（见 D-3 决策背景）。
>
> **边界红线（本批）**：只改数据来源**语义与标注**，不改渲染器/图层逻辑；不引入新依赖；不改主清单 z041 叙事文档（单独决策）。

---

## Part 1 · z060（P2）`.env.example` 缺 VITE_DATA_SOURCE —— 机械项，无需决策

### 现状（实码核实）
`frontend/.env.example` 仅含 `VITE_API_BASE` / `VITE_TIANDITU_KEY` / `VITE_CESIUM_BASE_PATH`，无 `VITE_DATA_SOURCE`。开发者从模板无法得知该变量，易误以为只有 mock 模式（与 b031 联动放大风险）。

### 目标改动（`frontend/.env.example`）
在"1. 后端 API 基础路径"之后追加一节：
```
# ----------------------------------------------------------------------------
# 2. 数据源模式（可选，默认 mock）
#    可选值：mock（前端静态 fixture，无需后端）/ api（走后端接口，生产推荐）/ online（FastAPI 实时演算，仅洪水）
#    生产构建必须显式设 VITE_DATA_SOURCE=api，否则默认 mock 会打包进生产产物。
# ----------------------------------------------------------------------------
VITE_DATA_SOURCE=mock
```
> 若 D-1 拍板"默认改 api"，此处模板值同步改为 `VITE_DATA_SOURCE=api`（模板值与代码默认值保持一致）。

### 验证
1. 无代码逻辑改动，仅模板文件。
2. 独立 commit：`docs(z060): .env.example 补充 VITE_DATA_SOURCE 说明`

---

## Part 2 · b031（P0）生产路径默认含 mock —— ⏸️ 等 D-1

### 现状（实码核实）
- `main.ts:37`：`const dataSource = (import.meta.env.VITE_DATA_SOURCE as 'mock' | 'api') || 'mock'`
- `dataSourceConfig.ts:17`：`let globalDataSource: DataSourceMode = 'mock'`
- **审计未记录的细节**：`main.ts:40` `forecastAdapter.setDataSource('api')` **硬编码**，绕过全局变量——即使 `VITE_DATA_SOURCE=mock`，forecast 全局也走 api（但 berth/traffic 被 INDICATOR_SOURCE 强制 mock，见 b025）。
- `public/data/*.json` 静态文件始终打包进生产产物（Vite 原样拷贝）。

### 目标改动（视 D-1 拍板）
- **若 D-1=A（默认 api）**：
  1. `main.ts:37` → `const dataSource = (import.meta.env.VITE_DATA_SOURCE as 'mock' | 'api' | undefined) || 'api'`
  2. `dataSourceConfig.ts:17` → `let globalDataSource: DataSourceMode = 'api'`（或直接删初始化，改由 main.ts 显式 setGlobalDataSource）
  3. `main.ts:40` 硬编码 `forecastAdapter.setDataSource('api')` 删除或改为 `setGlobalDataSource(dataSource)` 统一驱动（联动 z059 的 DAT-4 预留入口，见 Part 6）
  4. `.env.example` 模板值同步（Part 1）
  5. 检查 dev 工作流：`npm run dev` 需 `.env.local` 设 `VITE_DATA_SOURCE=mock` 才能离线开发——在 README/开发文档注明（不改 README 主体，仅在 `.env.example` 注释说明）
- **若 D-1=B（保持 mock 默认）**：仅做 .env.example 注释强调 + 生产构建脚本（package.json build 命令）检查 `VITE_DATA_SOURCE` 是否设置，未设置则 `console.warn`。

### 验证
1. `npm run typecheck` exit 0。
2. 构建验证：`VITE_DATA_SOURCE=api npm run build` 成功；未设变量时按决策行为（A：仍走 api；B：警告）。
3. 手工：api 模式启动，首页港口/边界数据从后端加载（若后端在跑）。

### 完成检查
- [ ] main.ts/dataSourceConfig.ts/.env.example 三处一致，无硬编码残留（除 INDICATOR_SOURCE，属 b025）
- [ ] 独立 commit：`fix(b031): 生产默认数据源按 D-1 决策收口`

---

## Part 3 · b025（P0）预测热力图合成数据 —— ⏸️ 等 D-2

### 现状（实码核实 + 更新）
1. **已修复部分**：`forecastEngine.js:106-110`（REQ-5 阶段2）已把 `Math.random` 改为确定性 LCG 伪随机，同 timePoint 重复请求结果一致、可 HTTP 缓存。审计"每请求随机"证据**已过时**。
2. **仍成立部分**：散射点（每港口 40 点 ±0.05°）仍是"围绕港口的合成散射"，非真实热力分布；`forecastAdapter.ts:118-121` `INDICATOR_SOURCE` 将 `berth`/`traffic` **硬编码为 'mock'**，不受全局 `VITE_DATA_SOURCE` 影响——生产 api 模式仍展示合成 fixture。

### 目标改动（视 D-2 拍板）
- **若 D-2=A（叙事+标注，推荐）**：
  1. `forecastAdapter.ts` `INDICATOR_SOURCE` 处补注释 + 导出常量，UI 侧（ForecastPage 指标面板）对 berth/traffic 显示"模拟数据"角标（最小实现：面板 label 加 `（模拟）` 后缀或 tooltip）。
  2. `forecastEngine.js` 的 `generateSpatialValues` 头部注释明确"合成散射用于热力可视化，非实测空间分布"。
  3. README/面试叙事在 z041 决策下同步（**本批不动 README 主体**，仅代码注释诚实化）。
- **若 D-2=B（真实聚合）**：需后端补 berth/traffic 真实数据端点 + 前端改真实核密度渲染——工作量数天，且需要真实数据源（当前无），本批仅产出方案不实施。

### 验证
1. `npm run typecheck` exit 0。
2. 预测页：api 模式切换 berth/traffic 指标，确认"模拟数据"标注显示。

### 完成检查
- [ ] 无任何"造假"表述残留（代码注释诚实）
- [ ] 独立 commit：`fix(b025): 预测热力图合成数据标注诚实化（按 D-2 决策）`

---

## Part 4 · b029（P0）getDEM 恒 mock —— ⏸️ 等 D-3

### 现状（实码核实）
- `floodAdapter.ts:308-311`：`getDEM(_region)` 无论模式恒返回 `{ source: 'mock', note: 'DEM 管线待接入（A 路线增量③）' }`。
- `tools/dem-pipeline/` 已有 5 个脚本：01-mosaic（拼接）→ 02-fill-sinks（填洼）→ 03-reproject-4326 → 04-generate-flood-data.py → 05-fix-facility-elevation.py。**DEM 产物已生成**（记忆：08-02 接入真实 DEM 数据，floodArea.json 13 万行等）。
- 需确认：产物在哪、什么格式（GeoTIFF？JSON？）、`getDEM` 的调用方是谁、消费什么形状。

### 目标改动（视 D-3 拍板）
- **若 D-3=A（先核实再接通，推荐）**：
  1. **核实步骤**（0.5 天）：读 `tools/dem-pipeline/04-generate-flood-data.py` 输出格式 → 查 `frontend/public/data/` 或后端数据目录是否有 DEM 产物 → grep `getDEM(` 调用方确认消费形状。
  2. 接通：按产物格式让 `getDEM` 返回真实数据（如 `{ source: 'dem-pipeline', data: <产物> }`）或改为读取后端 DEM 端点（若产物在后端）。
  3. 若产物格式与消费方不匹配 → 退 D-3=B。
- **若 D-3=B（预设水位档位叙事）**：`getDEM` 注释改为"三维水面为预设水位档位可视化，非真实高程"，前端 3D 水面逻辑不动。

### 验证
1. 核实结论记录到批次日志。
2. `npm run typecheck` exit 0。
3. 三维淹没页：若接通，水面随 DEM 高程变化；若 B，标注显示。

### 完成检查
- [ ] getDEM 不再返回"管线待接入"占位（A 接通真实 / B 改为档位叙事）
- [ ] 独立 commit：`fix(b029): getDEM 按 D-3 决策接通真实 DEM / 改档位叙事`

---

## Part 5 · b032（P0）getWaterArea api 模式仍调 mock —— ⏸️ 等 D-4

### 现状（实码核实）
`floodAdapter.ts:181-187`：api 模式与 mock 模式实现**完全相同**（均调 `_fetchMockWaterArea()`），注释"后端无此端点"。数据源为 `public/data/water-area.json`（静态文件）。backend `routes/` 无 water-area 端点（grep 确认）。

### 目标改动（视 D-4 拍板）
- **若 D-4=A（后端补端点，推荐）**：
  1. 后端新增只读端点 `GET /api/flood/water-area`：读 `backend/data/` 下水域坐标 JSON（或复用 `public/data/water-area.json` 复制到后端数据目录），返回 `{ code: 200, data: [[lng,lat],...] }`。
  2. `floodAdapter.getWaterArea` api 分支改调 `apiRequest('/flood/water-area')`（带 signal），mock 分支保留 `_fetchMockWaterArea()`。
  3. 补后端测试（controller 返回结构）+ 前端 adapter 测试。
- **若 D-4=B（标注静态配置）**：`getWaterArea` 注释明确"水域坐标为静态配置数据，前后端共用同一文件"，api 模式不伪装。

### 验证
1. 后端：`node --test` 新增 water-area 路由测试全绿。
2. 前端：`npm run typecheck` + floodAdapter 测试全绿。
3. 手工：api 模式洪涝页水域渲染正常。

### 完成检查
- [ ] api 模式不再调用 `_fetchMockWaterArea`
- [ ] 独立 commit：`fix(b032): getWaterArea api 模式改走后端端点（按 D-4 决策）`

---

## Part 6 · z059（P2）DAT-4 预留死代码 —— ⏸️ 等 D-5

### 现状（实码核实）
- `dataSourceConfig.ts:30-46`：`setGlobalDataSource`/`getGlobalDataSource` 标注"DAT-4 预留未接入"，无调用方（main.ts 直接写 `globalDataSource`——见 :27 注释）。
- `shared/utils/waterLevelValidation.ts` 整文件标注"DAT-4 预留"无前端调用方（**注：该文件同时被 c024 业务污染问题点名，批次7 处理归属**）。

### 目标改动（视 D-5 拍板）
- **若 D-5=A（删除，推荐）**：
  1. 删除 `setGlobalDataSource`/`getGlobalDataSource` 两个函数（git 历史可追溯）。
  2. `dataSourceConfig.ts:17` 初始化改由 `main.ts` 显式调用 `setAdapterDataSource` 或直接改全局常量——**联动 b031 Part 2**：若 D-1=A 选择"main.ts 用 setGlobalDataSource 统一驱动"，则 D-5 反向改判为保留并接入（两个决策联动，实施时以最新拍板为准）。
  3. `waterLevelValidation.ts` 删除前 grep 确认无任何引用（无引用才删，有引用则保留并移交批次7）。
- **若 D-5=C（接入）**：main.ts 初始化改调 `setGlobalDataSource(dataSource)`，两函数从死代码变活。
- 若 D-5=B（__future__ 目录）：移动文件并标注。

### 验证
1. `npm run typecheck` exit 0（删除后无未使用引用报错）。
2. grep `setGlobalDataSource|getGlobalDataSource|waterLevelValidation` 确认无残留引用（除已决策保留者）。

### 完成检查
- [ ] 无死代码残留（或按决策接入/迁移）
- [ ] 独立 commit：`refactor(z059): DAT-4 预留按 D-5 决策处置`

---

## 批次收尾验证

1. `npm run typecheck` exit 0；前端全量 vitest 全绿。
2. 后端（若 D-4=A）：`node --test` 全绿。
3. 手工冒烟：api 模式全链路（港口/边界/预测/洪涝）无 mock 数据泄漏（除已标注的合成项）。
4. 本批编号（b025 b029 b031 b032 z059 z060）从 8.2 清单删除，移入 `已解决问题.md`（补 solve）。
5. 日志追加 `logs/批次3-mock数据链决策-执行日志.md`，**记录各决策拍板结果与日期**（或写入 `logs/决策记录.md`）。

## 顺带发现（记录不处理）

- `main.ts:40` `forecastAdapter.setDataSource('api')` 硬编码——已在 Part 2 处理（若 D-1=A）。
- `floodAdapter.ts:277` `_fetchMockJson('/data/disaster.json')` 属 mock 分支，批次2 z032 已放行（静态 fetch 收口在批次2 Part 4 处理 forecastAdapter，floodAdapter mock 分支的 fetch 收口可顺带确认）。
- `waterLevelValidation.ts` 与 c024 业务污染交叉——批次7 处置归属时以本批 D-5 结果为准。
