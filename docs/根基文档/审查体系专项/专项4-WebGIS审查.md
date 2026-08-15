# WebGIS专项审查指标体系

> 版本：v1.0
> 定位：项目代码深度审查体系的 WebGIS 专项，可独立并行执行
> 与审查体系关系：见 `00-审查体系约定.md`（一级质量属性 #6 WebGIS 工程正确性）
> 适用：AI 辅助代码审查、地图模块技术体检、双引擎（Cesium + OpenLayers）项目专项审查、图层/坐标系/渲染器故障根因定位
> 聚焦范围：地图实例、图层生命周期、坐标系链路、渲染器适配器、空间数据性能、地图交互与工具组件
> 原则约束：所有结论必须来自真实代码证据；坐标系必须显式可追溯；图层有生必有灭；渲染器可替换

---

## 0. 文档使用说明

### 0.1 文档定位

本文档是「WebGIS 专项审查标准库」，是审查体系 8 专项之一（见 `00-审查体系约定.md` §3）。

本专项覆盖 WebGIS 项目特有的：
- 双渲染器（Cesium + OpenLayers）适配器边界与切换
- 图层显隐/重建/数据源更新的完整生命周期
- 空间索引、视口裁剪、聚合简化等大数据量渲染策略
- 地图事件监听、交互模式、弹窗、光标状态管理
- 测量/绘制/控件等地图工具的创建与销毁

本专项覆盖 42 个指标：
- 坐标系的识别、转换、显式性、配置化、格式一致性
- 图层的创建、销毁、显隐、切换、z-order、数据更新、多入口
- 渲染器接口、适配器边界、切换清理、能力差异、实例生命周期
- Cesium/OL 地图实例的创建销毁、单例性、DOM 引用、置空
- 空间索引、视口裁剪、聚合简化、瓦片缓存、要素数量、地形加载
- 图层状态同步、显隐单一来源、样式配置化、图例同步、过滤状态
- 地图事件注册注销、交互状态、弹窗生命周期、光标状态、模式切换
- 测量工具、绘制工具、地图控件、组件卸载清理

本专项可与数据链专项、生命周期专项、TS 专项、工程化专项、架构耦合专项并行执行，互不依赖结论，但可交叉引用指标编号。

### 0.2 与其他专项的边界

本专项**只管 WebGIS 特有问题**：地图实例、图层、坐标系、渲染器、空间数据、地图交互与工具。

本专项**不管**以下内容（属于其他专项）：
- 数据来源真伪、请求治理、字段映射 → 数据链专项（本专项仅在 1.2/2.6 引用坐标系与图层数据源链路）
- 变量作用域、闭包、定时器等通用生命周期 → 生命周期专项（本专项仅在 4.4/7.3/8.1 引用 DOM 引用与卸载清理）
- 类型覆盖率、any 治理、strict 模式 → TS 专项（本专项仅在 3.1 引用渲染器接口类型契约）
- 目录结构、模块边界、循环依赖 → 架构耦合专项（本专项仅在 3.2 引用渲染器适配器边界）
- 构建配置、CI、Docker、安全 → 工程化专项

但当问题落在「地图实例/图层/坐标系/渲染器/空间数据/地图交互/地图工具」时，**专属本专项**，其他专项不应重复审查。例如：
- Cesium Viewer 未调用 `destroy()` → 本专项 4.1，不归生命周期专项
- 图层 `addLayer` 无 `removeLayer` → 本专项 2.2，不归生命周期专项
- 坐标数据未做 EPSG 转换直接渲染 → 本专项 1.2/1.3，不归数据链专项

当本专项审查中发现跨域问题时，会标注「转 XX 专项」并标注目标专项（如「详见专项2 生命周期」「详见专项1 数据链」）。

### 0.3 指标条目格式约定

每一个指标采用 `00-审查体系约定.md` §2 的 11 字段结构：

```
指标名称：该指标的唯一标识名
检查目标：这个指标要确认什么事实
为什么需要检查：不检查会带来什么风险
检查范围：该指标适用于哪些代码实体
检查方法：具体如何执行检查（步骤化）
需要查看：必须阅读哪些证据材料
正常标准：满足什么条件算通过
异常情况：出现什么现象算不通过
风险等级：P0 / P1 / P2 / P3
整改方向：发现问题后的修复路径
验收标准：整改完成后如何证明已修复
```

### 0.4 风险等级定义

见 `00-审查体系约定.md` §2，本专项不再重复定义，仅引用：

| 等级 | 含义 | 触发条件 | 处置要求 |
|------|------|----------|----------|
| P0 | 阻断级 | 直接导致功能错误、数据错误、崩溃、安全漏洞 | 必须立即修复，不允许带病上线 |
| P1 | 高危 | 高概率引发故障、维护困难、性能问题 | 本轮审查必须修复 |
| P2 | 中危 | 存在隐患，特定场景下会出问题 | 计划修复，限期完成 |
| P3 | 低危 | 规范性、可读性、轻度冗余 | 择机优化，不阻断 |

本专项中以下情况直接判 P0：
- 坐标系未转换或隐式转换导致空间数据错位（地图数据「差几百米」「跑到海里」）
- Cesium Viewer / OL Map 实例未销毁导致内存泄漏与 WebGL 上下文耗尽
- 图层只 add 不 remove 导致切换页面后图层数量无限增长
- 渲染器切换时未清理旧实例资源导致 WebGL 上下文冲突崩溃
- 双引擎状态传递（exportState/importState）丢失或错位导致视角跳变
- 地形/DEM 数据未按需加载导致首屏卡死或浏览器崩溃

### 0.5 本专项核心原则

**原则 1：坐标系必须显式**
- 所有空间数据必须有明确的 CRS 标注（EPSG:4326 / 4490 / 3857 / 4547 等）
- 坐标系转换必须是显式调用（fromLonLat / toLonLat / transform），禁止依赖框架默认行为
- 业务层不应做投影运算，仅声明 CRS 并在数据入口校验

**原则 2：图层有生有灭**
- 任何图层有 addLayer 就必须有对应的 removeLayer
- 显隐优先用 setVisibility，禁止用「删除 + 重建」模拟显隐
- 切换业务模块、切换渲染器、卸载组件时，相关图层必须清理

**原则 3：渲染器可替换**
- 业务层通过抽象接口（MapRenderer）操作地图，不直接依赖 OL 或 Cesium API
- Cesium 与 OL 适配器互不污染，能力差异通过降级策略处理
- 渲染器切换时旧实例资源必须清理，新实例必须重新应用图层状态

**原则 4：空间数据需索引**
- 大数据量（点要素 > 阈值）必须有空间索引（R-tree / quadtree）
- 必须做视口裁剪与按需加载，禁止一次性渲染全部要素
- 瓦片图层、地形数据必须有缓存与分级加载策略

**原则 5：地图实例单例**
- 同一时刻同一容器只有一个活跃地图实例
- 渲染器实例切换不等于销毁重建，复用需保证状态正确传递
- 实例销毁后所有引用必须置空，防止僵尸引用继续操作已销毁实例

**原则 6：状态单一来源**
- 图层显隐状态只能有一个权威来源（store 或 manager）
- 禁止 store 与渲染器内部各存一份并手动同步
- 派生状态用 computed，不用 watch 手动同步

---

### 0.6 Agent 并行执行契约（2026-08-11 统一改造）

- **独立线程**：本专项可单独作为一条 agent 审查线程执行，与其余专项**零执行依赖**（支持 8 窗口并行）；跨专项交叉点见 0.2 边界表，仅在产出层面汇总，不在执行层面依赖。
- **输入**：本文档（可按「部分」切片，仅加载本子 agent 负责的部分）+ 对应代码范围 + 设计文档对应章节（见 `00-审查体系约定.md` §4「标准输入资产」，本专项映射：01 三.2/四；02 5.1-5.3；03 1.2）。
- **输出**：发现清单（每条含：指标编号 / 证据 file:line / 风险等级 / 整改建议）→ 写入 `docs/audits/<日期>-<批次名>/专项4-WebGIS审查-问题副本.md`（产出统一规范见 `00-审查体系约定.md` §4；副本规则见 docs/待解决问题.md 头部），经用户裁决转正主台账；执行记录存同批次目录 `专项4-WebGIS审查-执行记录.md`（模板见 §0.7）。
- **子 agent 拆分**：按「第 X 部分」切分（拆分规则见 `00-审查体系约定.md` §4：① 1 部分=1 子 agent；② 相邻部分证据重叠>50% 可合并；③ 单专项上限 6；④ 禁止二次拆分）。
  - 本专项 8 部分共享地图/渲染器证据，建议 **4–5 个**子 agent（坐标系+图层 合 1、渲染器 1、实例+性能 合 1、状态+事件 合 1、工具+卸载 合 1）。
  - 每个子 agent 领 1 个切分单元独立执行（输入 = 该单元指标 + 对应代码），主 agent 汇总去重、合并同根因、统一定级。
- **格式约定**：结论必须来自真实代码证据（file:line）；指标编号用本文档编号（如 3.2）；跨专项引用写「专项N X.Y」；**禁止使用草稿/临时编号**（唯一合法编号 = 台账编号体系）。

### 0.7 执行记录报告模板（2026-08-11 强制）

> 每份执行记录必须按此模板产出（8 份专项 §0.7 逐字同构），缺一项视为未完成：

```markdown
# <专项N> 审查执行记录 · <日期>
## 摘要
- 指标覆盖：<完成数>/<总数>（注明逐条判定/抽样/未检查）
- 发现总数：<N>｜P0 × <n>｜P1 × <n>｜P2 × <n>｜P3 × <n>
- 主要结论：<3 句>
## 发现清单（逐条，四要素缺一视为未完成）
### 发现 <编号>：<标题>
- 指标：<X.Y>
- 证据：<file:line + 摘录>
- 等级：<P0-P3>
- 影响：<后果>
- 整改建议：<做法>
- 状态：<open/已修/豁免>
## 豁免清单（本次确认非违约项）
| 文件:行 | 命中 | 豁免理由 | 依据 |
## 通过/证伪项（负结果，防重复立案）
## 复验（修复后待跑）
```

> 产出位置与命名见 `00-审查体系约定.md` §4「产出统一规范」；发现条目禁止使用草稿编号。


## 第一部分：坐标系审查

> 目标：还原项目所有空间数据的坐标系链路，回答「数据是什么坐标系」「渲染前是否正确转换」「是否所有节点都显式声明」
> 本部分是整个 WebGIS 审查的起点，坐标系错误是 GIS 项目最高频且最隐蔽的 P0 故障

### 指标 1.1：项目坐标系识别

**指标名称**：项目坐标系识别
**检查目标**：确认项目中所有空间数据使用的坐标系（WGS84 / CGCS2000 / Web 墨卡托 / 自定义投影）被显式识别并记录
**为什么需要检查**：坐标系识别不清是「数据错位」「点位跑到海里」「边界偏移几百米」的根因，且这类错误在数据量小时不显现，集成后才会暴露
**检查范围**：所有包含坐标字段的类型定义、所有 GeoJSON 文件、所有接口响应、所有图层渲染入参、所有配置文件中的坐标常量
**检查方法**：
1. 全局搜索坐标字段（lng / lat / lon / longitude / latitude / x / y / coordinates）
2. 为每类空间数据标注其声明 CRS（从类型定义的 `crs` 字段）与实际 CRS（从数据来源推断）
3. 检查是否存在「无 CRS 标注的坐标数据」（裸的 `{ lng, lat }`）
4. 检查默认 CRS 常量是否定义且被引用（如 `DEFAULT_CRS = 'EPSG:4326'`）
5. 检查渲染层使用的 CRS（OL View projection / Cesium 默认 WGS84 椭球）与数据 CRS 是否一致或显式转换
6. 检查是否区分了业务数据 CRS（4326/4490）与渲染投影 CRS（3857）
**需要查看**：types/crs.ts、所有 GeoJSON 文件、mapStore、渲染器初始化代码、MAP_CONFIG 配置、后端返回的坐标字段
**正常标准**：
- 项目有 `DEFAULT_CRS` 常量定义且全局引用
- 业务数据 CRS 与渲染 CRS 明确区分并文档化
- 每类空间数据有 CRS 标注或可从默认值推导
- CRS 类型为受控枚举（如 `'EPSG:4326' | 'EPSG:4490' | 'EPSG:3857' | 'EPSG:4547'`），非字符串自由值
- 北部湾业务区域有边界 bbox 校验常量（如 `BEIBU_GULF_BBOX`）
**异常情况**：
- 坐标字段无 CRS 标注，靠「经验默认是 4326」
- 同一项目混用 WGS84 与 CGCS2000 但未说明（虽 web 精度下可互换，但需显式声明）
- 业务数据直接使用 3857 米坐标却未标注，导致渲染层二次投影错误
- CRS 为 `string` 而非受控枚举，可传入任意值
- 无业务区域 bbox 校验，越界坐标直接渲染到错误位置
**风险等级**：P0
**整改方向**：建立 `DEFAULT_CRS` 常量；CRS 类型受控枚举化；空间数据入口强制 CRS 标注或校验；业务区域 bbox 校验
**验收标准**：所有空间数据有 CRS 标注或可从默认推导；CRS 类型为枚举；有业务区域边界校验

### 指标 1.2：坐标系转换链路完整性

**指标名称**：坐标系转换链路完整性
**检查目标**：确认空间数据从数据源到渲染前的每一跳都有明确的坐标系处理，不存在断链或隐式跳转
**为什么需要检查**：转换链路断裂会导致「数据正确但渲染错位」，且 OL 的 `fromLonLat`/`toLonLat` 调用错位会静默产生数百米偏移
**检查范围**：数据源（接口/GeoJSON）→ adapter → store → 渲染器入参 → 渲染层投影 的完整链路
**检查方法**：
1. 对每类空间数据画出完整链路：`数据源 → 业务层接收 → adapter 归一化 → store 存储 → 渲染器 addXxxLayer → OL/Cesium 内部投影`
2. 检查链路中是否有跳过的环节（如组件直接传入原始坐标，未经归一化）
3. 检查每一跳的 CRS 是否一致或有显式转换函数调用
4. 检查 OL 渲染器是否在正确位置调用 `fromLonLat`（4326→3857）和 `toLonLat`（3857→4326，用于点击坐标回传）
5. 检查 Cesium 渲染器是否依赖默认 WGS84 椭球，未做额外投影（Cesium 内部就是 4326）
6. 检查 GeoJSON 数据是否标注 CRS 或在加载时声明（GeoJSON 规范默认 4326）
**需要查看**：adapter 实现、normalizePoint 实现、OLRenderer 中 fromLonLat/toLonLat 调用、CesiumRenderer 坐标处理、点击事件 coordinate 回传
**正常标准**：
- 每条空间数据链路可画出且环节完整
- 业务数据 CRS（4326）与渲染投影 CRS（3857）的转换在渲染器内部完成，业务层不感知
- 点击事件回传的 coordinate 为 4326（业务层统一坐标系）
- GeoJSON 数据默认按 4326 处理或在加载时显式声明
- 每一跳有可观测的日志或类型契约
**异常情况**：
- 组件直接传原始接口坐标给渲染器，未做归一化
- OL 渲染器遗漏 `fromLonLat`，导致 4326 坐标被当作 3857 渲染（点位偏移巨大）
- 点击事件回传 3857 坐标，业务层按 4326 处理（选址计算错误）
- GeoJSON 数据是 3857 但未声明，被按 4326 加载
- Cesium 中误用 OL 投影函数导致坐标错乱
**风险等级**：P0
**整改方向**：补全链路环节；统一转换调用位置；点击坐标回传统一为 4326；GeoJSON 显式声明 CRS
**验收标准**：每条空间数据链路可画出且转换显式；点击坐标回传为业务统一 CRS；无隐式投影跳转

### 指标 1.3：坐标系转换显式性

**指标名称**：坐标系转换显式性
**检查目标**：确认所有坐标系转换都是显式函数调用，不存在依赖框架默认行为的隐式转换
**为什么需要检查**：隐式转换在框架升级、底图切换、引擎切换时极易产生不可预期的偏移，且调试困难
**检查范围**：所有涉及坐标转换的代码，包括 OL 的 fromLonLat/toLonLat/transform、Cesium 的 fromDegrees/fromRadians、自定义 transform 函数
**检查方法**：
1. 全局搜索 `fromLonLat` / `toLonLat` / `transform` / `fromDegrees` / `fromRadians` / `proj.transform` 调用
2. 检查每个调用的源 CRS 与目标 CRS 是否显式传参
3. 检查是否存在「依赖 OL View 默认 projection」的代码（未显式传 projection 参数）
4. 检查是否存在「Cesium Cartesian3.fromDegrees」与「OL fromLonLat」混用却未对齐
5. 检查是否有「坐标直接传给渲染器不转换」的反模式（依赖渲染器内部自动处理）
6. 检查渲染器抽象层是否屏蔽了底层投影差异（业务层不应直接调 fromLonLat）
**需要查看**：OLRenderer / CesiumRenderer 实现、adapter 层、业务组件中坐标使用、渲染器接口 MapRenderer 的入参类型
**正常标准**：
- 所有坐标转换显式调用且显式传 CRS 参数
- 业务层不直接调用 OL/Cesium 投影函数，由渲染器内部处理
- 渲染器接口入参坐标统一为业务 CRS（4326）
- 同一坐标在 2D/3D 引擎中转换方式一致
**异常情况**：
- 业务组件直接调 `fromLonLat` 后传给渲染器（业务层做了本该渲染器做的事）
- OL View 未显式声明 projection（依赖默认 3857）
- Cesium 中 `Cartesian3.fromDegrees` 调用未说明这是 4326→笛卡尔
- 同一坐标在 OL 和 Cesium 中走不同转换路径，未对齐
- 渲染器接口入参坐标类型未标注 CRS（裸 `[number, number]`）
**风险等级**：P0
**整改方向**：业务层移除投影函数直接调用；转换收口到渲染器内部；接口入参坐标显式标注 CRS
**验收标准**：业务层无投影函数直接调用；转换全部在渲染器内部显式完成；接口入参坐标类型标注 CRS

### 指标 1.4：坐标系配置化

**指标名称**：坐标系配置化
**检查目标**：确认 CRS 常量、业务区域 bbox、默认中心点、投影参数等均通过配置管理，非硬编码散落在代码中
**为什么需要检查**：硬编码的 CRS 与坐标常量在业务区域扩展、底图切换、坐标系迁移时需要全局搜索修改，易遗漏
**检查范围**：MAP_CONFIG 配置、DEFAULT_CRS 常量、BEIBU_GULF_BBOX、各渲染器的初始化参数、业务组件中硬编码的坐标
**检查方法**：
1. 检查是否存在集中的 MAP_CONFIG 配置文件
2. 检查默认中心点、默认 zoom、bbox 边界是否从配置读取
3. 全局搜索硬编码的经纬度数值（如 `108.5, 21.9` 直接出现在代码中）
4. 检查 CRS 字符串是否硬编码而非引用常量（如直接写 `'EPSG:4326'` 而非 `DEFAULT_CRS`）
5. 检查天地图 / 瓦片 URL 中的 CRS 参数是否配置化
6. 检查配置是否区分环境（开发/生产可能用不同底图）
**需要查看**：core/config/map 配置、types/crs.ts、渲染器初始化、业务组件中的坐标使用
**正常标准**：
- 有集中 MAP_CONFIG 配置且被全局引用
- 默认中心、zoom、bbox 从配置读取
- 无硬编码的业务坐标数值散落在组件中
- CRS 字符串引用常量而非字面量
- 瓦片 URL 与 CRS 参数配置化
**异常情况**：
- 多个组件各自硬编码中心点坐标，且数值不一致
- CRS 字符串字面量散落（`'EPSG:4326'` 出现在多处而非引用常量）
- 业务区域 bbox 在多处定义且数值不一致
- 瓦片 URL 硬编码在渲染器内部
**风险等级**：P1
**整改方向**：建立集中 MAP_CONFIG；硬编码坐标迁移到配置；CRS 字符串引用常量
**验收标准**：无硬编码业务坐标；CRS 引用常量；配置集中管理

### 指标 1.5：坐标格式一致性

**指标名称**：坐标格式一致性
**检查目标**：确认全项目坐标字段的命名、顺序、格式（十进制度 / 度分秒 / 弧度）一致
**为什么需要检查**：lng/lon/longitude 混用、经纬度顺序错乱、度分秒与十进制度混用是 GIS 项目经典 bug，且难以通过类型系统发现
**检查范围**：所有坐标类型定义、接口字段命名、GeoJSON coordinates 顺序、Cesium/OL 入参顺序
**检查方法**：
1. 全局搜索 `lng` / `lon` / `longitude` / `lat` / `latitude` 字段命名
2. 检查项目是否有统一命名约定（如全项目用 `lng/lat` 而非 `lon/lat`）
3. 检查 GeoJSON coordinates 顺序是否符合规范（`[lng, lat]` 而非 `[lat, lng]`）
4. 检查 Cesium API 调用顺序（`fromDegrees(lng, lat)` 而非 `(lat, lng)`）
5. 检查 OL API 调用顺序（`fromLonLat([lng, lat])` 数组顺序）
6. 检查是否有度分秒格式（如 `108°30'15"`）与十进制度混用
7. 检查是否有弧度与度混用（Cesium 部分API用弧度）
8. 检查 LaxPoint 类型是否有归一化函数（兼容历史 lon/longitude 字段）
**需要查看**：types/crs.ts 的 GeoPoint / LaxPoint、normalizePoint 实现、GeoJSON 数据、Cesium/OL 调用
**正常标准**：
- 全项目统一命名约定（如统一 `lng/lat`）且有文档说明
- GeoJSON coordinates 顺序为 `[lng, lat]`
- Cesium `fromDegrees(lng, lat)` 顺序正确
- OL `fromLonLat([lng, lat])` 顺序正确
- 度分秒不混用，统一十进制度
- 弧度/度不混用，Cesium 弧度 API 显式转换
- 历史混用字段有 normalizePoint 归一化
**异常情况**：
- 同一项目 `lng` 与 `lon` 与 `longitude` 三种命名混用
- GeoJSON coordinates 写成 `[lat, lng]`
- Cesium `fromDegrees(lat, lng)` 顺序错（坐标跑到错误位置）
- OL `fromLonLat([lat, lng])` 顺序错
- 度分秒与十进制度混用未转换
- 无归一化函数，历史字段直接使用导致 undefined
**风险等级**：P0（顺序错乱）/ P1（命名混用）
**整改方向**：统一命名约定；归一化函数处理历史字段；API 调用顺序校验；度分秒显式转换
**验收标准**：命名统一；坐标顺序正确；历史字段有归一化；无度分秒混用

---

## 第二部分：图层生命周期审查

> 目标：还原项目所有图层的完整生命周期，回答「图层何时创建、何时显隐、何时销毁」「是否有遗漏」
> 图层只 add 不 remove 是 GIS 项目内存泄漏与性能退化的核心来源

### 指标 2.1：图层类型全量清单

**指标名称**：图层类型全量清单
**检查目标**：确认项目中所有图层类型（矢量点、矢量面、GeoJSON、瓦片、热力、地形、水面、3D 模型等）被识别并记录
**为什么需要检查**：图层类型清单不全会导致后续生命周期审查漏项，且每种类型的清理方式不同（瓦片清理 source、矢量清理 feature、3D 清理 primitive）
**检查范围**：所有 addXxxLayer 调用、所有 LayerType 枚举值、所有 layerAdapter 注册条目
**检查方法**：
1. 全局搜索 `addPointLayer` / `addPolygonLayer` / `addGeoJsonLayer` / `addHeatmapLayer` / `addWaterSurface` 等渲染器方法调用
2. 列出 LayerType 枚举的所有取值
3. 列出 LAYER_ADAPTERS 注册表的所有 key
4. 检查每种图层类型是否有对应的 adapter（create / update / remove 三件套）
5. 检查是否有「未注册到 adapter 但直接调渲染器」的图层
6. 检查瓦片底图图层是否单独管理（通常不在业务图层 manager 中）
7. 检查 3D 专属图层（水面、呼吸灯）与 2D 专属图层（热力图）的标识
**需要查看**：layerAdapters.ts、LayerType 类型定义、渲染器接口的可选方法、BusinessLayerManager 调用、UnifiedMap 中的底图注册
**正常标准**：
- 图层类型清单完整且与枚举/adapter 对齐
- 每种类型有 adapter 三件套
- 2D/3D 专属能力在接口中标注为可选方法
- 瓦片底图与业务图层分离管理
- 无游离的图层创建调用（绕过 adapter/manager）
**异常情况**：
- 存在 LayerType 枚举值但无对应 adapter
- 业务组件直接调 `renderer.addXxxLayer` 绕过 BusinessLayerManager
- 2D/3D 专属方法未在接口中标注可选，导致另一引擎调用报错
- 瓦片底图混入业务图层 manager 导致清理时被误删
- 图层类型清单与实际调用不符
**风险等级**：P1
**整改方向**：补全 adapter；收口到 BusinessLayerManager；可选方法标注；底图分离管理
**验收标准**：图层类型清单完整；每类有 adapter；无游离调用；2D/3D 能力标注清晰

### 指标 2.2：图层创建与销毁配对

**指标名称**：图层创建与销毁配对
**检查目标**：确认每个图层的 addLayer/create 都有对应的 removeLayer/destroy，且配对次数匹配
**为什么需要检查**：图层只创建不销毁是 GIS 内存泄漏的首要来源，长时间运行的 SPA 会因图层数量无限增长而卡死
**检查范围**：所有 addXxxLayer / removeLayer / removeAll / destroy 调用，以及 BusinessLayerManager 的 register/remove/removeAll
**检查方法**：
1. 列出所有 addXxxLayer 调用点及其图层 id
2. 列出所有 removeLayer / removeAll 调用点及其图层 id
3. 对每个图层 id 检查是否有配对的创建与销毁
4. 检查销毁时机是否正确（组件卸载 / 路由切换 / 业务模块切换）
5. 检查「创建多次但只销毁一次」或「创建一次但销毁多次」的情况
6. 检查 BusinessLayerManager.destroy 是否清理所有注册图层
7. 检查渲染器 destroy 是否清理内部 _layers Map
8. 检查更新数据时的「remove + add」重建是否会造成短暂无图层状态或资源未释放
**需要查看**：UnifiedMap 的 onUnmounted、BusinessLayerManager 的 remove/destroy、渲染器 destroy 实现、各业务 composable 的图层创建
**正常标准**：
- 每个图层 id 有配对的创建与销毁
- 销毁在正确时机（onUnmounted / 路由切换 / 模块切换）
- 创建与销毁次数匹配
- BusinessLayerManager.destroy 清理所有图层
- 渲染器 destroy 清理 _layers
- 更新数据时的重建不泄漏旧资源
**异常情况**：
- 业务组件 onMounted 创建图层但 onUnmounted 无 removeLayer
- BusinessLayerManager.register 后无对应 remove
- 渲染器 destroy 未清理内部图层 Map
- 更新数据时 removeLayer 后 addLayer 失败导致图层丢失
- 切换页面后图层残留导致下次进入重复添加
- 同一图层 id 被多次 addLayer 但只 removeLayer 一次
**风险等级**：P0
**整改方向**：补全销毁逻辑；统一生命周期钩子；销毁次数匹配；更新数据用增量更新而非 remove+add
**验收标准**：每个图层有配对销毁；销毁时机正确；次数匹配；无残留

### 指标 2.3：图层显隐控制

**指标名称**：图层显隐控制
**检查目标**：确认图层显隐通过 setVisibility 控制，而非通过「removeLayer + addLayer」模拟显隐
**为什么需要检查**：删除重建会丢失图层内部状态（如样式、选中态、缓存数据），且性能远差于 setVisibility
**检查范围**：所有图层显隐控制点，包括 LayerControlPanel、BusinessLayerManager.setVisible、渲染器 setVisibility
**检查方法**：
1. 全局搜索 setVisibility / setVisible / layer.setVisible 调用
2. 检查是否存在「显隐通过 removeLayer + addLayer 实现」的反模式
3. 检查 BusinessLayerManager.setVisible 是否调渲染器 setVisibility 而非 remove+add
4. 检查 setVisibility 后图层数据是否仍保留在渲染器内部（toggle 回来直接可见）
5. 检查 OL layer.setVisible 与 Cesium entity.show 的实现是否正确
6. 检查显隐状态是否同步到 store 的 layerCatalog
7. 检查初始 visible=false 的图层是否仍被创建（仅不可见）而非跳过创建
**需要查看**：BusinessLayerManager.setVisible、渲染器 setVisibility 实现、LayerControlPanel、layerCatalog store
**正常标准**：
- 显隐统一通过 setVisibility
- 无 removeLayer + addLayer 模拟显隐
- setVisibility 后数据保留，toggle 回来直接可见
- 显隐状态同步到 store
- 初始 visible=false 的图层被创建但不可见
**异常情况**：
- 隐藏图层时调 removeLayer，显示时重新 addLayer（数据丢失或重新请求）
- setVisibility 实现内部是 removeLayer（伪 setVisibility）
- 显隐状态只改 store 未同步到渲染器，或反之
- 初始 visible=false 的图层被跳过创建，导致首次显示时数据未加载
**风险等级**：P1
**整改方向**：统一 setVisibility；移除 remove+add 模拟显隐；显隐状态双向同步
**验收标准**：显隐统一 setVisibility；无 remove+add 模拟；状态同步；数据保留

### 指标 2.4：图层切换时旧图层清理

**指标名称**：图层切换时旧图层清理
**检查目标**：确认切换业务模块、切换数据源、切换渲染器时，旧业务图层被正确清理
**为什么需要检查**：切换不清会导致「上个业务的图层残留」「图层叠加混乱」「内存持续增长」
**检查范围**：路由切换、业务模块切换、渲染器 2D↔3D 切换、数据源切换时的图层处理
**检查方法**：
1. 检查路由切换时是否清理上一路由的业务图层
2. 检查业务模块切换时 BusinessLayerManager 是否 removeAll 或精准 remove 旧业务图层
3. 检查 2D↔3D 渲染器切换时旧渲染器图层是否清理（注意：复用模式下是 exportState + importState，不是销毁重建）
4. 检查数据源切换（如切换底图类型）时旧底图是否清理或仅显隐
5. 检查 reapplyAll 在渲染器切换后是否正确重绘业务图层
6. 检查切换过程中是否有「旧图层未清 + 新图层已加」的中间状态导致闪烁
**需要查看**：路由守卫、BusinessLayerManager.reapplyAll、UnifiedMap.switchMapType、layerCatalog 重置逻辑
**正常标准**：
- 路由切换清理旧业务图层
- 渲染器切换通过 reapplyAll 重绘而非依赖残留
- 底图切换通过 setVisibility 而非 remove+add
- 切换过程无图层叠加混乱
- reapplyAll 仅重绘可见图层
**异常情况**：
- 路由切换后旧业务图层残留
- 渲染器切换后图层丢失（未调 reapplyAll）
- 底图切换时旧底图未隐藏导致叠加
- reapplyAll 重绘了不可见图层导致性能浪费
- 切换过程中图层数量临时翻倍
**风险等级**：P1
**整改方向**：路由切换清理图层；渲染器切换调 reapplyAll；底图切换用 setVisibility
**验收标准**：路由切换无残留；渲染器切换图层正确重绘；底图切换无叠加

### 指标 2.5：图层 z-order 管理

**指标名称**：图层 z-order 管理
**检查目标**：确认图层叠放顺序通过 zIndex 配置化管理，而非依赖添加顺序
**为什么需要检查**：依赖添加顺序会导致图层顺序不稳定（异步加载完成顺序不同），且难以调整叠放关系
**检查范围**：所有图层的 zIndex 设置、OL layer.setZIndex、Cesium zIndex 属性
**检查方法**：
1. 检查每个 addXxxLayer 是否支持 zIndex 选项
2. 检查 OL 渲染器是否调 layer.setZIndex
3. 检查 Cesium 渲染器是否设置 entity/primitive 的 zIndex
4. 检查底图 zIndex 是否低于业务图层
5. 检查是否有图层未设 zIndex（依赖默认值或添加顺序）
6. 检查 zIndex 是否配置化（从 LayerOptions 或常量读取）而非硬编码
7. 检查同类型图层的 zIndex 是否一致（如所有边界图层同一 zIndex）
**需要查看**：LayerOptions.zIndex、OLRenderer addXxxLayer 实现、CesiumRenderer 图层创建、LAYER_DEFAULTS 常量
**正常标准**：
- 每个图层显式设置 zIndex
- 底图 zIndex 低于业务图层
- zIndex 配置化（常量或 options）
- 同类型图层 zIndex 一致
- zIndex 不依赖添加顺序
**异常情况**：
- 图层未设 zIndex，依赖添加顺序（异步加载导致顺序不定）
- 底图与业务图层 zIndex 冲突（底图盖住业务图层）
- zIndex 硬编码散落在多处
- 同类型图层 zIndex 不一致导致叠放混乱
**风险等级**：P2
**整改方向**：显式设置 zIndex；配置化管理；底图与业务图层分离
**验收标准**：每个图层显式 zIndex；配置化；底图低于业务图层

### 指标 2.6：图层数据源更新机制

**指标名称**：图层数据源更新机制
**检查目标**：确认图层数据更新时使用增量更新或受控的「remove + add」重建，且不丢失 visible 状态
**为什么需要检查**：更新数据时丢失 visible 状态会导致「隐藏的图层被更新后又显示出来」，且无序重建会造成视觉闪烁
**检查范围**：BusinessLayerManager.updateData、adapter.update、渲染器 updateXxxLayer 方法
**检查方法**：
1. 检查 updateData 是否保留 visible 状态（不覆盖 catalogEntry.visible）
2. 检查 adapter.update 的实现（增量更新 vs remove+add 重建）
3. 检查热力图等 2D 专属图层是否有 updateHeatmapLayer 增量方法
4. 检查水面等 3D 专属图层是否有 updateWaterLevel 增量方法
5. 检查更新时如果图层当前不可见，是否只缓存数据不立即渲染
6. 检查更新过程中是否有「数据为 null/undefined 时直接传给渲染器」导致报错
7. 检查更新后是否触发图例/状态同步
**需要查看**：BusinessLayerManager.updateData、layerAdapters 的 update 实现、渲染器 updateXxxLayer 方法
**正常标准**：
- updateData 不覆盖 visible 状态
- 优先使用增量更新方法（updateHeatmapLayer / updateWaterLevel）
- 不可见图层更新只缓存数据
- null/undefined 数据有兜底处理
- 更新后状态同步
**异常情况**：
- updateData 重置 visible 为 true
- 所有更新都走 remove+add 重建（性能差且闪烁）
- 不可见图层更新时立即渲染（违反显隐意图）
- null 数据直接传给渲染器导致崩溃
- 更新后图例未同步
**风险等级**：P1
**整改方向**：updateData 保留 visible；优先增量更新；不可见只缓存；空值兜底
**验收标准**：updateData 保留 visible；增量更新优先；不可见不渲染；空值有处理

### 指标 2.7：图层控制多入口检查（WebGIS 视角）

**指标名称**：图层控制多入口检查（WebGIS 视角）
**检查目标**：确认同一图层的控制（创建/显隐/销毁）只有单一入口，不存在多头控制
**为什么需要检查**：多头控制会导致「A 入口隐藏了图层，B 入口又显示了」「A 入口销毁了图层，B 入口还在操作」
**检查范围**：LayerControlPanel、业务组件直接调渲染器、BusinessLayerManager、mapStore action
**检查方法**：
1. 列出所有能控制图层显隐的入口（LayerControlPanel、业务组件、路由守卫）
2. 检查是否所有入口都走 BusinessLayerManager.setVisible，而非直接调渲染器
3. 检查是否所有创建都走 BusinessLayerManager.register，而非直接调渲染器 addXxxLayer
4. 检查 mapStore.setLayerVisible 是否只被 BusinessLayerManager 调用（单一修改路径）
5. 检查是否存在「组件 A 创建图层，组件 B 销毁图层」的跨组件控制
6. 检查图层 id 命名是否可能冲突（不同业务用同一 id 导致互相覆盖）
**需要查看**：LayerControlPanel、业务组件图层调用、BusinessLayerManager、mapStore action、图层 id 命名约定
**正常标准**：
- 图层控制单一入口（BusinessLayerManager）
- 无组件直接调渲染器 addXxxLayer / setVisibility / removeLayer
- mapStore action 单一修改路径
- 图层 id 命名有约定且不冲突
**异常情况**：
- LayerControlPanel 直接调渲染器绕过 BusinessLayerManager
- 业务组件直接调 renderer.addXxxLayer 创建图层
- 多个组件能控制同一图层且行为不一致
- 图层 id 冲突导致互相覆盖
- mapStore.layerCatalog 被多处直接修改
**风险等级**：P1
**整改方向**：收口到 BusinessLayerManager；移除直接渲染器调用；图层 id 命名约定
**验收标准**：图层控制单一入口；无直接渲染器调用；id 无冲突

---

## 第三部分：渲染器适配器审查

> 目标：判断双引擎（Cesium + OpenLayers）适配器的设计是否清晰可替换，回答「渲染器接口是否完整」「边界是否清晰」「切换是否安全」
> 渲染器适配器是双引擎架构的核心，设计缺陷会导致 2D/3D 切换崩溃

### 指标 3.1：渲染器接口定义完整性

**指标名称**：渲染器接口定义完整性
**检查目标**：确认 MapRenderer 抽象接口定义完整，覆盖所有业务需要的地图操作
**为什么需要检查**：接口不完整会导致业务层绕过接口直接调底层 API，破坏双引擎可替换性
**检查范围**：MapRenderer 接口定义、所有业务层对渲染器的调用
**检查方法**：
1. 列出 MapRenderer 接口的所有方法（init / destroy / addXxxLayer / setVisibility / removeLayer / hasLayer / flyTo / exportState / importState / on / off / emit / getType）
2. 检查每个方法是否有完整的 TypeScript 类型签名（参数类型 + 返回值类型）
3. 检查可选方法（2D Only / 3D Only）是否标注为 `?` 且有文档说明
4. 检查事件类型 MapRendererEventMap 是否完整（click / pointer-move / camera-changed）
5. 检查业务层是否有「接口未定义但需要」的方法（绕过接口直接调底层）
6. 检查接口是否有类型契约测试（保证 OL/Cesium 实现都满足接口）
7. 检查 LayerOptions / FlyToOptions / CameraState 等入参类型是否完整
**需要查看**：types/renderer.ts、MapRenderer 抽象类、OLRenderer / CesiumRenderer 实现、接口测试
**正常标准**：
- 接口方法完整覆盖业务需求
- 每个方法有完整类型签名
- 可选方法标注清晰且文档化
- 事件类型完整
- 业务层无绕过接口的调用
- 有接口契约测试
**异常情况**：
- 接口缺少业务需要的方法（业务层直接调 renderer.map.xxx 或 renderer.viewer.xxx）
- 方法参数无类型标注（any）
- 可选方法未标注导致另一引擎调用报错
- 事件类型不完整（如缺少 camera-changed）
- 无接口契约测试，OL/Cesium 实现可能偏离接口
**风险等级**：P1
**整改方向**：补全接口方法；完善类型签名；可选方法标注；补接口测试
**验收标准**：接口完整覆盖业务；类型签名完整；可选方法标注；有契约测试

### 指标 3.2：渲染器适配器边界清晰性

**指标名称**：渲染器适配器边界清晰性
**检查目标**：确认 Cesium 与 OL 适配器互不污染，业务层不感知底层引擎差异
**为什么需要检查**：边界模糊会导致「OL 的代码污染 Cesium」「业务层 if 引擎类型」的反模式，使双引擎变成伪双引擎
**检查范围**：OLRenderer / CesiumRenderer 实现、业务组件中的引擎类型判断、shared 工具中的引擎特定代码
**检查方法**：
1. 检查 OLRenderer 是否只 import OL 相关包，CesiumRenderer 是否只 import Cesium 相关包
2. 检查业务组件是否有 `if (renderer.getType() === '2d')` 之类的引擎类型判断
3. 检查 shared 工具是否有引擎特定代码（应放在对应渲染器内部）
4. 检查 OL 与 Cesium 之间是否通过抽象接口通信，而非直接互调
5. 检查状态传递（exportState/importState）是否使用中立的 CameraState 类型，而非引擎特定类型
6. 检查渲染器实现是否继承同一抽象类 MapRenderer
7. 检查是否有「OL 特有配置泄漏到 Cesium」或反之
**需要查看**：OLRenderer / CesiumRenderer 的 import、业务组件的引擎判断、CameraState 类型、MapRenderer 抽象类
**正常标准**：
- OLRenderer 只 import OL，CesiumRenderer 只 import Cesium
- 业务层无引擎类型判断
- shared 无引擎特定代码
- 状态传递用中立类型
- 两渲染器继承同一抽象类
**异常情况**：
- 业务组件用 `if (renderer.getType() === '2d')` 分支调不同方法
- OLRenderer 中 import Cesium 或反之
- shared 工具包含 OL/Cesium 特定逻辑
- 状态传递用引擎特定类型（如直接传 OL View 状态给 Cesium）
- 两渲染器未继承同一抽象类，接口靠 duck typing
**风险等级**：P1
**整改方向**：业务层移除引擎判断；引擎特定代码收口到对应渲染器；状态传递用中立类型
**验收标准**：业务层无引擎判断；import 边界清晰；状态传递中立

### 指标 3.3：渲染器切换时资源清理

**指标名称**：渲染器切换时资源清理
**检查目标**：确认 2D↔3D 渲染器切换时，旧渲染器的资源（事件监听、定时器、WebGL 上下文）被正确清理或复用
**为什么需要检查**：切换不清会导致 WebGL 上下文耗尽（浏览器限制 16 个）、事件监听堆积、内存泄漏
**检查范围**：UnifiedMap.switchMapType、CesiumViewerManager 的 mount/unmount、OLRenderer 的销毁逻辑
**检查方法**：
1. 检查切换策略：是销毁旧实例创建新实例，还是复用实例（v-show 切换）
2. 若复用：检查 CesiumViewerManager 是否在 unmount 时暂停渲染（requestRenderMode）而非销毁
3. 若复用：检查 OL 实例是否在隐藏时仍占用 WebGL 上下文
4. 检查切换时事件监听是否清理（旧 renderer.on 注册的 handler）
5. 检查切换时图层状态是否通过 exportState/importState 正确传递
6. 检查切换失败时是否回滚（mapType 恢复、loading 复位）
7. 检查空闲销毁策略（如 Cesium 30s 空闲自动销毁）是否合理
8. 检查 WebGL 上下文数量是否在浏览器限制内
**需要查看**：UnifiedMap.switchMapType、CesiumViewerManager、OLRenderer 销毁、exportState/importState
**正常标准**：
- 切换策略明确（复用或销毁）且文档化
- 复用时正确暂停渲染降低 GPU 占用
- 切换时事件监听清理或重新绑定
- 状态通过 exportState/importState 传递
- 切换失败有回滚
- 空闲销毁策略合理
- WebGL 上下文不超限
**异常情况**：
- 切换时旧实例未销毁也未暂停，GPU 持续渲染
- 事件监听未清理导致重复触发
- 状态传递丢失导致视角跳变
- 切换失败后 mapType 与实际渲染器不一致
- WebGL 上下文耗尽导致后续地图初始化失败
- 无空闲销毁策略，长时间不用的 3D 实例持续占资源
**风险等级**：P0
**整改方向**：明确切换策略；复用时暂停渲染；清理事件；状态传递；失败回滚；空闲销毁
**验收标准**：切换策略明确；无事件堆积；状态正确传递；失败有回滚；WebGL 不超限

### 指标 3.4：渲染器能力差异处理

**指标名称**：渲染器能力差异处理
**检查目标**：确认 2D 与 3D 引擎的能力差异（如热力图仅 2D、水面仅 3D）有明确的降级策略
**为什么需要检查**：能力差异未处理会导致「在 3D 引擎调用热力图方法崩溃」或「在 2D 引擎调用水面方法报错」
**检查范围**：可选方法（addHeatmapLayer / addWaterSurface 等）的实现、降级策略、DEV warn 机制
**检查方法**：
1. 列出 2D Only 方法（addHeatmapLayer / updateHeatmapLayer）和 3D Only 方法（addWaterSurface / updateWaterLevel / startBreathing 等）
2. 检查 3D 渲染器对 2D Only 方法的实现：是否返回 false + DEV warn 而非抛错
3. 检查 2D 渲染器对 3D Only 方法的实现：同上
4. 检查 adapter 层（layerAdapters）是否断言非空（`renderer.addHeatmapLayer!`）
5. 检查业务层调用可选方法前是否检查能力（`if (renderer.addHeatmapLayer)`）
6. 检查降级时是否有用户可见提示（如「3D 引擎不支持热力图，已切换为点图层」）
7. 检查引擎切换时，仅某引擎支持的图层是否正确处理（如 3D 切 2D 时水面图层如何处理）
**需要查看**：MapRenderer 接口可选方法、OLRenderer / CesiumRenderer 的可选方法实现、layerAdapters 断言
**正常标准**：
- 可选方法在不适配引擎中返回 false + DEV warn
- adapter 层断言非空（明确预期引擎支持）
- 业务层调用前检查能力
- 降级有用户提示
- 引擎切换时能力差异图层正确处理
**异常情况**：
- 3D 引擎调用 2D Only 方法抛错导致崩溃
- 2D 引擎调用 3D Only 方法静默失败（无 warn 无提示）
- 业务层不检查能力直接调用
- 引擎切换时水面图层在 2D 中残留为错误实体
- 无降级提示，用户不知为何功能消失
**风险等级**：P1
**整改方向**：可选方法统一返回 false + warn；业务层检查能力；降级提示；切换时清理不适配图层
**验收标准**：可选方法不抛错；业务层检查能力；有降级提示；切换时正确处理

### 指标 3.5：渲染器实例生命周期

**指标名称**：渲染器实例生命周期
**检查目标**：确认渲染器实例的创建、复用、销毁有明确策略，且与组件生命周期对齐
**为什么需要检查**：渲染器实例是重量级对象（持有 WebGL 上下文、图层、事件），生命周期错乱会导致资源耗尽
**检查范围**：UnifiedMap 的 olRenderer / cesiumRenderer ref、CesiumViewerManager 单例、组件 onMounted/onUnmounted
**检查方法**：
1. 检查 OL 渲染器实例何时创建（首次 onMounted）何时销毁（onUnmounted）
2. 检查 Cesium 渲染器实例何时创建（首次切 3D）何时销毁（onUnmounted 或空闲）
3. 检查 CesiumViewerManager 单例模式：全局唯一 Viewer，按需 mount/unmount
4. 检查组件卸载时两个渲染器实例是否都销毁
5. 检查销毁后 ref 是否置空（currentRenderer.value = null）
6. 检查销毁后是否还有僵尸引用继续操作已销毁实例
7. 检查单例模式下的并发安全（多个 UnifiedMap 实例竞争同一 Viewer）
8. 检查 destroy 方法的实现：是否清理图层、事件、WebGL 上下文
**需要查看**：UnifiedMap onUnmounted、CesiumViewerManager、OLRenderer/CesiumRenderer destroy、currentRenderer ref
**正常标准**：
- 渲染器实例创建/销毁时机明确且与组件生命周期对齐
- CesiumViewerManager 单例正确管理 Viewer
- 组件卸载时两渲染器都销毁
- 销毁后 ref 置空
- 无僵尸引用
- 单例并发安全
- destroy 清理彻底
**异常情况**：
- 组件卸载后渲染器实例未销毁
- 销毁后 ref 未置空，后续代码继续操作
- CesiumViewerManager 单例在多实例下竞争
- destroy 未清理图层或事件
- OL 与 Cesium 销毁顺序错误导致依赖问题
- 销毁后异步回调仍操作实例
**风险等级**：P0
**整改方向**：补全销毁；ref 置空；单例并发保护；destroy 清理彻底；异步回调守卫
**验收标准**：实例销毁完整；ref 置空；无僵尸引用；单例安全；destroy 彻底

---

## 第四部分：地图实例生命周期

> 目标：还原 Cesium Viewer 与 OL Map 实例的完整生命周期，回答「实例何时创建、何时销毁、销毁后引用如何处理」
> 地图实例未销毁是 WebGL 上下文耗尽与内存泄漏的 P0 风险

### 指标 4.1：Cesium 实例创建与销毁

**指标名称**：Cesium 实例创建与销毁
**检查目标**：确认 Cesium Viewer 实例有 `viewer.destroy()` 调用，且销毁时机正确
**为什么需要检查**：Cesium Viewer 持有 WebGL 上下文、imagery provider、terrain provider、entity 集合，未销毁会持续占用 GPU 资源直至浏览器崩溃
**检查范围**：CesiumViewerManager.create / destroy、CesiumRenderer.destroy、UnifiedMap onUnmounted
**检查方法**：
1. 搜索所有 `new Viewer(` 调用点
2. 搜索所有 `viewer.destroy()` 调用点
3. 检查每个 new Viewer 是否有对应的 destroy
4. 检查 destroy 时机：组件卸载 / 空闲超时 / 应用退出
5. 检查 destroy 前是否清理了 viewer 上的资源（entities / dataSources / primitives / imageryLayers）
6. 检查 destroy 后 viewer 引用是否置空
7. 检查 CesiumViewerManager 单例模式下，destroy 是否真的销毁 Viewer 还是仅 unmount
8. 检查空闲销毁定时器（30s）的实现：是否在用户回来时取消
**需要查看**：CesiumViewerManager 实现、CesiumRenderer.destroy、UnifiedMap onUnmounted、空闲销毁定时器
**正常标准**：
- 每个 new Viewer 有对应 destroy
- destroy 时机正确（卸载/空闲/退出）
- destroy 前清理 viewer 资源
- destroy 后引用置空
- 空闲销毁定时器正确取消
- 单例模式下 destroy 策略明确
**异常情况**：
- new Viewer 后无 destroy 调用
- destroy 时机错误（如组件卸载未触发）
- destroy 前未清理 entities 导致警告
- destroy 后 viewer 引用未置空，僵尸代码继续操作
- 空闲定时器未在用户回来时取消，导致使用中 Viewer 被销毁
- 单例模式下误把 unmount 当 destroy，Viewer 实际未释放
**风险等级**：P0
**整改方向**：补全 destroy；destroy 前清理资源；引用置空；定时器正确取消
**验收标准**：每个 Viewer 有 destroy；时机正确；资源清理；引用置空；定时器正确

### 指标 4.2：OL 实例创建与销毁

**指标名称**：OL 实例创建与销毁
**检查目标**：确认 OL Map 实例有 `map.setTarget(null)` 或等价销毁调用，且销毁时机正确
**为什么需要检查**：OL Map 持有 DOM 引用、事件监听、图层、WebGL 上下文，未销毁会导致 DOM 残留与监听堆积
**检查范围**：OLRenderer 构造函数、OLRenderer.destroy、UnifiedMap onUnmounted
**检查方法**：
1. 搜索所有 `new Map(` （OL Map）调用点
2. 搜索所有 `map.setTarget(null)` 或 `map.dispose()` 调用点
3. 检查每个 new Map 是否有对应销毁
4. 检查销毁时机：组件卸载
5. 检查销毁前是否清理图层（map.setLayers([]) 或逐个 remove）
6. 检查销毁前是否移除事件监听（map.on 注册的 click/moveend 等）
7. 检查销毁后 map 引用是否置空
8. 检查 OL View 是否随 Map 一起销毁
**需要查看**：OLRenderer 构造与 destroy、UnifiedMap onUnmounted、OL 事件监听注册
**正常标准**：
- 每个 new Map 有 setTarget(null) 或 dispose
- 销毁时机正确（组件卸载）
- 销毁前清理图层与监听
- 销毁后引用置空
- View 随 Map 销毁
**异常情况**：
- new Map 后无 setTarget(null)
- 销毁时机错误
- 销毁前未清理图层导致 DOM 残留
- 事件监听未移除导致堆积
- 销毁后 map 引用未置空
- View 未随 Map 销毁导致独立泄漏
**风险等级**：P0
**整改方向**：补全 setTarget(null)；销毁前清理图层与监听；引用置空
**验收标准**：每个 Map 有销毁；时机正确；图层监听清理；引用置空

### 指标 4.3：地图实例单例性

**指标名称**：地图实例单例性
**检查目标**：确认同一时刻同一容器只有一个活跃地图实例，不存在重复创建
**为什么需要检查**：重复创建会导致 DOM 中多个地图容器叠加、WebGL 上下文浪费、事件冲突
**检查范围**：UnifiedMap 实例化、CesiumViewerManager 单例、路由中的地图组件复用
**检查方法**：
1. 检查 UnifiedMap 是否在路由切换时复用（keep-alive）还是重新创建
2. 检查 CesiumViewerManager 是否为单例（全局唯一 Viewer）
3. 检查是否存在多个 UnifiedMap 实例同时挂载（如布局组件 + 业务组件各一个）
4. 检查地图容器 DOM 是否可能被重复初始化（initRenderer 前检查 existingRenderer）
5. 检查 HMR（热更新）时是否会导致重复创建
6. 检查路由 meta 中是否有 engine 配置导致与 UnifiedMap mapType 冲突
**需要查看**：路由配置、布局组件、UnifiedMap 实例化、CesiumViewerManager 单例实现
**正常标准**：
- 同一时刻只有一个 UnifiedMap 实例
- CesiumViewerManager 单例正确
- initRenderer 复用已有实例
- HMR 不导致重复创建
- 路由 engine 配置与 mapType 一致
**异常情况**：
- 路由切换时 UnifiedMap 重复创建（无 keep-alive）
- 多个组件各持有 UnifiedMap 实例
- initRenderer 未检查 existingRenderer 导致重复创建
- HMR 后旧实例未销毁新实例已创建
- 路由 engine 与 mapType 冲突导致切换异常
**风险等级**：P1
**整改方向**：路由复用地图组件；单例模式；initRenderer 检查复用；HMR 处理
**验收标准**：单实例；单例正确；复用检查；HMR 安全

### 指标 4.4：地图容器 DOM 引用管理

**指标名称**：地图容器 DOM 引用管理
**检查目标**：确认地图容器的 DOM ref 在组件卸载后被正确清理，无僵尸引用
**为什么需要检查**：DOM ref 未清理会导致组件卸载后仍持有已删除 DOM 节点的引用，阻碍垃圾回收
**检查范围**：UnifiedMap 的 olContainerRef / cesiumContainerRef、CesiumViewerManager 的 container 引用
**检查方法**：
1. 检查 olContainerRef / cesiumContainerRef 在 onUnmounted 是否置空
2. 检查 CesiumViewerManager 是否持有 container 引用（单例模式下可能长期持有）
3. 检查销毁地图时是否同时清理 container 引用
4. 检查 waitForContainerVisible 等 Promise 是否在卸载后仍 resolve（导致操作已删除 DOM）
5. 检查 requestAnimationFrame 回调是否在卸载后仍执行
6. 检查 Cesium viewer.container 在 mount/unmount 时的移动逻辑是否正确
**需要查看**：UnifiedMap 的 ref 声明与 onUnmounted、CesiumViewerManager mount/unmount、waitForContainerVisible、rAF 收集器
**正常标准**：
- DOM ref 在卸载后置空
- CesiumViewerManager 不长期持有 container（或持有但文档说明）
- 销毁地图时清理 container 引用
- 异步 Promise 在卸载后被忽略
- rAF 回调在卸载时取消
- Cesium container 移动逻辑正确
**异常情况**：
- DOM ref 卸载后未置空
- CesiumViewerManager 长期持有已删除 container
- waitForContainerVisible 在卸载后仍 resolve 操作已删除 DOM
- rAF 回调未取消导致卸载后操作 DOM
- Cesium container 移动逻辑错误导致 DOM 残留
**风险等级**：P1
**整改方向**：ref 卸载置空；异步回调守卫；rAF 取消；container 引用清理
**验收标准**：ref 置空；异步安全；rAF 取消；无僵尸 DOM 引用

### 指标 4.5：地图实例销毁后引用置空

**指标名称**：地图实例销毁后引用置空
**检查目标**：确认地图实例销毁后，所有持有该实例的引用（ref / store / 全局变量）都被置空
**为什么需要检查**：销毁后引用未置空会导致后续代码继续操作已销毁实例，引发「viewer is destroyed」错误或静默失败
**检查范围**：UnifiedMap 的 currentRenderer / olRenderer / cesiumRenderer ref、mapStore.currentRenderer、CesiumViewerManager.viewer
**检查方法**：
1. 检查 UnifiedMap onUnmounted 中 currentRenderer.value 是否置空
2. 检查 olRenderer / cesiumRenderer ref 是否置空
3. 检查 mapStore.setCurrentRenderer(null) 是否被调用
4. 检查 CesiumViewerManager.viewer 在 destroy 后是否置空
5. 检查 provide/inject 的 currentRenderer 是否在销毁后失效
6. 检查异步回调（如切引擎的 Promise）在销毁后是否仍操作 currentRenderer
7. 检查 BusinessLayerManager._mapStore 是否在 destroy 后置空
**需要查看**：UnifiedMap onUnmounted、mapStore setCurrentRenderer、CesiumViewerManager destroy、BusinessLayerManager destroy
**正常标准**：
- 所有 ref 在销毁后置空
- mapStore.currentRenderer 置空
- CesiumViewerManager.viewer 置空
- provide/inject 失效
- 异步回调守卫（loadAbort / isMounted 标志）
- BusinessLayerManager._mapStore 置空
**异常情况**：
- currentRenderer.value 未置空，后续代码操作已销毁实例
- mapStore.currentRenderer 未置空，BusinessLayerManager 继续操作
- CesiumViewerManager.viewer 未置空
- 异步回调在销毁后仍操作 ref
- BusinessLayerManager._mapStore 未置空导致僵尸调用
**风险等级**：P0
**整改方向**：所有引用置空；异步回调守卫；provide/inject 失效
**验收标准**：所有引用置空；异步安全；无僵尸引用

---

## 第五部分：空间数据性能

> 目标：评估空间数据渲染的性能表现，回答「大数据量是否会卡死」「是否按需加载」「是否有索引」
> GIS 项目性能问题集中在大数据量渲染与瓦片加载

### 指标 5.1：空间索引使用

**指标名称**：空间索引使用
**检查目标**：确认大数据量（点要素 > 阈值）的图层使用了空间索引（R-tree / quadtree）
**为什么需要检查**：无空间索引的万级点要素渲染会导致首屏卡死、交互卡顿、内存爆炸
**检查范围**：渲染器中 addPointLayer 的实现、spatialIndex 工具、视口裁剪相关代码
**检查方法**：
1. 检查是否有 spatialIndex 工具（如 rbush / 自实现 R-tree）
2. 检查 addPointLayer 是否在要素数量超过阈值时自动建索引
3. 检查阈值常量（如 VIEWPORT_CULL_THRESHOLD）是否合理（通常 1000-5000）
4. 检查索引是否随图层数据更新而重建
5. 检查索引是否随图层销毁而清理
6. 检查索引查询是否用于视口裁剪（moveend 时查询视口内要素）
7. 检查是否有「要素数量未达阈值但已卡顿」的情况（可能阈值过高）
**需要查看**：spatialIndex 工具、OLRenderer addPointLayer、VIEWPORT_CULL_THRESHOLD 常量、moveend 监听
**正常标准**：
- 有空间索引工具
- 要素超阈值时自动建索引
- 阈值合理且有文档说明
- 索引随数据更新重建
- 索引随图层销毁清理
- 索引用于视口裁剪
**异常情况**：
- 万级点要素无空间索引，一次性渲染导致卡死
- 阈值过高（如 10000）导致小数据量也卡
- 索引未随数据更新重建导致查询结果过时
- 索引未随图层销毁清理导致内存泄漏
- 有索引但未用于视口裁剪（索引形同虚设）
**风险等级**：P1
**整改方向**：引入空间索引；自动建索引；合理阈值；随数据更新；随销毁清理
**验收标准**：大数据量有索引；阈值合理；索引随数据更新；随销毁清理；用于视口裁剪

### 指标 5.2：视口裁剪与按需加载

**指标名称**：视口裁剪与按需加载
**检查目标**：确认大数据量图层只渲染当前视口内的要素，非全量加载
**为什么需要检查**：全量加载会导致首屏卡死、内存爆炸，且大部分要素在视口外根本看不到
**检查范围**：OLRenderer 的 moveend 监听、视口裁剪逻辑、_cullLayers、flyTo 后的视口更新
**检查方法**：
1. 检查 moveend 事件是否触发视口裁剪
2. 检查视口范围计算是否正确（map.getView().calculateExtent）
3. 检查询询视口内要素的索引查询是否正确
4. 检查裁剪后的要素是否正确替换 VectorSource（而非追加）
5. 检查 flyTo / zoom 后是否触发视口更新
6. 检查 Cesium 是否利用其内置视口剔除（Cesium 自动剔除视口外要素）
7. 检查视口裁剪是否有节流（避免 moveend 频繁触发）
8. 检查图层不可见时是否暂停视口裁剪
**需要查看**：OLRenderer moveend 监听、_cullLayers、视口范围计算、节流逻辑
**正常标准**：
- moveend 触发视口裁剪
- 视口范围计算正确
- 索引查询正确
- 要素替换而非追加
- flyTo 后更新视口
- 有节流
- 不可见图层暂停裁剪
**异常情况**：
- 无视口裁剪，全量加载导致卡死
- 视口范围计算错误导致裁剪不准
- 要素追加而非替换导致重复渲染
- flyTo 后未更新视口导致新区域空白
- 无节流导致 moveend 频繁触发性能差
- 不可见图层仍裁剪浪费资源
**风险等级**：P1
**整改方向**：实现视口裁剪；正确计算范围；要素替换；flyTo 更新；节流；不可见暂停
**验收标准**：视口裁剪正确；要素替换；flyTo 更新；有节流；不可见暂停

### 指标 5.3：大数据量渲染策略

**指标名称**：大数据量渲染策略
**检查目标**：确认大数据量图层使用了聚合 / 简化 / 分块等渲染优化策略
**为什么需要检查**：单纯视口裁剪在密集数据下仍可能渲染数千要素，需要进一步聚合或简化
**检查范围**：聚合图层配置、几何简化（simplify）、分块加载、LOD（细节层次）
**检查方法**：
1. 检查是否有点聚合（cluster）配置与阈值
2. 检查是否有几何简化（如 turf.simplify / Douglas-Peucker）
3. 检查是否有分块加载（按行政区域或网格分块）
4. 检查瓦片图层是否有 LOD（不同 zoom 加载不同层级）
5. 检查聚合阈值是否随 zoom 自适应（远距离高聚合，近距离低聚合）
6. 检查 Cesium 中是否使用 3D Tiles 处理大场景
7. 检查是否有 WebGL 自定义 shader 优化（如 instanced rendering）
**需要查看**：聚合配置、简化调用、瓦片 LOD 配置、3D Tiles 使用
**正常标准**：
- 大数据量有聚合或简化策略
- 聚合阈值随 zoom 自适应
- 瓦片有 LOD
- 大场景用 3D Tiles
- 策略有性能验证（benchmark）
**异常情况**：
- 万级点要素无聚合直接渲染
- 几何未简化导致复杂多边形渲染慢
- 瓦片无 LOD，低 zoom 加载高精度瓦片
- 大场景未用 3D Tiles 导致帧率低
- 无性能验证
**风险等级**：P1
**整改方向**：引入聚合；几何简化；瓦片 LOD；3D Tiles；性能验证
**验收标准**：大数据量有策略；聚合自适应；瓦片 LOD；有 benchmark

### 指标 5.4：瓦片图层缓存策略

**指标名称**：瓦片图层缓存策略
**检查目标**：确认瓦片图层有合理的缓存策略，避免重复请求与首屏卡顿
**为什么需要检查**：无缓存的瓦片每次切换都重新请求，导致流量浪费与首屏卡顿
**检查范围**：天地图瓦片 URL 构建、OL XYZ source 配置、Cesium imagery provider 配置、HTTP 缓存头
**检查方法**：
1. 检查瓦片 URL 是否带 token（天地图需要）
2. 检查 OL XYZ source 是否配置 cacheSize
3. 检查 Cesium imagery provider 是否配置 minimumTerrainLevel / cache
4. 检查瓦片是否设置 crossOrigin（用于 canvas 导出）
5. 检查是否有离线瓦片缓存（Service Worker / IndexedDB）
6. 检查瓦片请求是否有并发限制
7. 检查瓦片加载失败是否有重试与兜底
8. 检查 HTTP 缓存头是否合理（Cache-Control / ETag）
**需要查看**：buildTiandituUrl、XYZ source 配置、Cesium imagery provider、Service Worker 配置
**正常标准**：
- 瓦片 URL 正确带 token
- OL / Cesium 配置 cacheSize
- crossOrigin 设置
- 瓦片加载失败有重试
- HTTP 缓存头合理
- 大场景有离线缓存考虑
**异常情况**：
- 瓦片无缓存每次重新请求
- 无并发限制导致大量瓦片同时请求
- 加载失败无重试导致白图
- crossOrigin 未设置导致 canvas 导出失败
- token 过期无处理
**风险等级**：P2
**整改方向**：配置缓存；并发限制；失败重试；crossOrigin；token 处理
**验收标准**：瓦片有缓存；失败有重试；crossOrigin 设置；token 处理

### 指标 5.5：矢量图层要素数量限制

**指标名称**：矢量图层要素数量限制
**检查目标**：确认每个矢量图层有要素数量上限，超限时有降级策略
**为什么需要检查**：无上限的图层在数据暴涨时会拖垮整个地图，且单图层万级要素已无意义（看不清）
**检查范围**：addPointLayer / addPolygonLayer / addGeoJsonLayer 的入参数据、要素数量检查、降级策略
**检查方法**：
1. 检查 addXxxLayer 是否校验要素数量
2. 检查超限时的降级策略（拒绝渲染 / 自动聚合 / 提示用户）
3. 检查是否有日志告警超限
4. 检查 GeoJSON 数据加载是否校验要素数量
5. 检查多图层叠加时的总要素数量考虑
6. 检查 Cesium entity 数量限制（Cesium 对 entity 数量敏感）
**需要查看**：渲染器 addXxxLayer 实现、要素数量校验、降级策略
**正常标准**：
- 有要素数量上限校验
- 超限有降级策略
- 有日志告警
- GeoJSON 加载校验
- Cesium entity 数量受控
**异常情况**：
- 无数量限制，数据暴涨时拖垮地图
- 超限直接渲染不降级
- 无日志告警
- GeoJSON 万级要素一次性加载
- Cesium entity 过多导致帧率低
**风险等级**：P1
**整改方向**：加数量上限；超限降级；日志告警；GeoJSON 校验
**验收标准**：有数量上限；超限降级；有告警；GeoJSON 校验

### 指标 5.6：地形与 DEM 数据加载策略

**指标名称**：地形与 DEM 数据加载策略
**检查目标**：确认 Cesium 地形数据有按需加载与 LOD 策略，不会首屏卡死
**为什么需要检查**：DEM 数据量大，全量加载会卡死浏览器，且地形需要与影像配准
**检查范围**：Cesium terrainProvider 配置、地形 LOD、地形加载时机
**检查方法**：
1. 检查 Cesium terrainProvider 是否配置
2. 检查地形加载时机（首屏 / 切 3D / 用户请求）
3. 检查地形 LOD 是否启用（Cesium 内置）
4. 检查地形数据源是否可靠（本地 DEM / 在线服务）
5. 检查地形与影像是否配准
6. 检查地形加载失败是否有兜底（无地形继续运行）
7. 检查地形是否影响 2D 引擎（2D 不应加载地形）
**需要查看**：CesiumRenderer terrainProvider 配置、地形加载逻辑、兜底处理
**正常标准**：
- terrainProvider 配置正确
- 地形按需加载（切 3D 时）
- LOD 启用
- 数据源可靠
- 地形与影像配准
- 加载失败有兜底
- 2D 不加载地形
**异常情况**：
- 首屏加载地形导致卡死
- 无 LOD 全量加载
- 地形与影像不配准
- 加载失败导致 3D 不可用
- 2D 误加载地形浪费资源
**风险等级**：P0
**整改方向**：按需加载；启用 LOD；配准验证；失败兜底；2D 隔离
**验收标准**：地形按需加载；LOD 启用；配准正确；失败有兜底；2D 隔离

---

## 第六部分：图层状态管理

> 目标：评估图层状态的管理方式，回答「状态是否单一来源」「显隐是否同步」「样式是否配置化」
> 图层状态混乱会导致「图例与图层不一致」「显隐状态丢失」「样式硬编码难维护」

### 指标 6.1：图层状态与 store 同步

**指标名称**：图层状态与 store 同步
**检查目标**：确认图层状态（显隐 / 顺序 / 数据）在 store（mapStore.layerCatalog）与渲染器之间保持同步
**为什么需要检查**：状态不同步会导致「图层面板显示可见但地图上不可见」或反之
**检查范围**：mapStore.layerCatalog、BusinessLayerManager.setVisible、渲染器 setVisibility
**检查方法**：
1. 检查 BusinessLayerManager.setVisible 是否同时更新 store 与渲染器
2. 检查 store.setLayerVisible 是否只被 BusinessLayerManager 调用（单一入口）
3. 检查渲染器 setVisibility 后是否同步回 store（反向同步）
4. 检查初始 visible 状态是否在 register 时正确写入 catalog
5. 检查图层销毁时是否同步从 catalog 移除
6. 检查渲染器切换后 catalog 状态是否保留（catalog 是 App 级持久）
7. 检查多个组件读取 catalog 时是否拿到一致状态
**需要查看**：BusinessLayerManager.setVisible/register/remove、mapStore layerCatalog action、渲染器 setVisibility
**正常标准**：
- setVisible 同时更新 store 与渲染器
- store.setLayerVisible 单一入口
- 初始 visible 写入 catalog
- 销毁时从 catalog 移除
- 渲染器切换后 catalog 保留
- 多组件读取一致
**异常情况**：
- setVisible 只改 store 不改渲染器，或反之
- store.setLayerVisible 被多处直接调用
- 初始 visible 未写入 catalog 导致图例显示错误
- 销毁时未从 catalog 移除导致图例残留
- 渲染器切换后 catalog 丢失导致图层状态重置
- 多组件读取不一致
**风险等级**：P1
**整改方向**：setVisible 双向同步；单一入口；初始写入；销毁移除；catalog 持久
**验收标准**：状态双向同步；单一入口；初始正确；销毁移除；切换保留

### 指标 6.2：图层显隐状态单一来源

**指标名称**：图层显隐状态单一来源
**检查目标**：确认图层显隐状态只有一个权威来源（store 或渲染器），不存在两份冲突的副本
**为什么需要检查**：两份副本会导致「改了 store 渲染器没变」「改了渲染器 store 没变」的不一致
**检查范围**：store.layerCatalog.visible、渲染器内部图层 visible 状态、组件本地 visible ref
**检查方法**：
1. 检查显隐状态是否有两份副本（store + 渲染器内部）
2. 检查组件是否有本地 visible ref 复制 store 状态
3. 检查谁是权威来源（建议 store 为权威，渲染器跟随）
4. 检查是否有 watch 手动同步两份副本（易漏）
5. 检查初始化时两份副本是否一致
6. 检查渲染器切换后两份副本是否重新对齐
**需要查看**：mapStore layerCatalog、渲染器内部图层 visible、组件本地 ref
**正常标准**：
- 显隐状态单一来源（store 为权威）
- 无组件本地 visible ref 副本
- 渲染器跟随 store
- 无 watch 手动同步
- 初始化一致
- 切换后对齐
**异常情况**：
- store 与渲染器各存一份且手动同步
- 组件本地 ref 复制 store 状态
- 无明确权威来源
- watch 同步易漏
- 初始化时不一致
- 切换后两份副本不对齐
**风险等级**：P1
**整改方向**：单一来源（store 权威）；移除本地副本；渲染器跟随；computed 派生
**验收标准**：单一来源；无本地副本；渲染器跟随；无手动同步

### 指标 6.3：图层样式管理

**指标名称**：图层样式管理
**检查目标**：确认图层样式（颜色 / 大小 / 描边 / 填充）配置化管理，非硬编码散落在代码中
**为什么需要检查**：硬编码样式在主题切换、品牌调整、批量修改时需要全局搜索，易遗漏且不一致
**检查范围**：LayerOptions 中的样式字段、LAYER_DEFAULTS 常量、BOUNDARY_STYLE / PORT_STYLE 等样式常量
**检查方法**：
1. 检查是否有集中的样式常量（如 LAYER_DEFAULTS、BOUNDARY_STYLE、PORT_STYLE）
2. 检查 addXxxLayer 是否从 LayerOptions 读取样式而非硬编码
3. 检查样式常量是否集中管理（colors.ts / map constants）
4. 检查是否有主题切换支持（CSS 变量 / 配置切换）
5. 检查同类型图层样式是否一致（如所有边界图层同一颜色）
6. 检查 Cesium 与 OL 中相同样式的实现是否对齐（如同一颜色在两引擎中渲染一致）
**需要查看**：LAYER_DEFAULTS、BOUNDARY_STYLE、PORT_STYLE、LayerOptions 样式字段、colors 常量
**正常标准**：
- 样式集中常量管理
- addXxxLayer 从 options 读取
- 同类型图层样式一致
- 有主题切换支持
- 2D/3D 样式对齐
**异常情况**：
- 样式硬编码在渲染器内部
- 无集中常量，样式散落多处
- 同类型图层样式不一致
- 无主题切换
- 同一样式在 2D/3D 中渲染不一致
**风险等级**：P2
**整改方向**：样式常量集中；从 options 读取；同类型一致；主题支持；2D/3D 对齐
**验收标准**：样式集中管理；从 options 读取；同类型一致；2D/3D 对齐

### 指标 6.4：图例与图层状态同步

**指标名称**：图例与图层状态同步
**检查目标**：确认图例（LayerControlPanel）显示的图层状态与实际渲染状态一致
**为什么需要检查**：图例与实际不一致会导致「图例显示可见但地图上没有」「图例显示存在但图层已销毁」
**检查范围**：LayerControlPanel、layerCatalog 读取、图例渲染逻辑
**检查方法**：
1. 检查 LayerControlPanel 是否从 layerCatalog 读取状态（而非本地副本）
2. 检查图层销毁时图例是否同步移除
3. 检查图层显隐切换时图例是否同步更新
4. 检查图层添加时图例是否同步显示
5. 检查图例的 toggle 操作是否走 BusinessLayerManager.setVisible
6. 检查图例排序与图层 z-order 是否对应
**需要查看**：LayerControlPanel、layerCatalog、图例渲染、toggle 调用
**正常标准**：
- 图例从 layerCatalog 读取
- 图层销毁图例移除
- 显隐切换图例更新
- 添加图层图例显示
- toggle 走 setVisible
- 图例排序与 z-order 对应
**异常情况**：
- 图例用本地副本，与 layerCatalog 不同步
- 图层销毁图例残留
- 显隐切换图例未更新
- 添加图层图例未显示
- toggle 直接调渲染器绕过 manager
- 图例排序与 z-order 不对应
**风险等级**：P2
**整改方向**：图例从 catalog 读取；同步销毁/显隐/添加；toggle 走 manager
**验收标准**：图例从 catalog 读取；同步销毁/显隐/添加；toggle 走 manager

### 指标 6.5：图层过滤状态管理

**指标名称**：图层过滤状态管理
**检查目标**：确认图层过滤状态（如按类型 / 时间 / 属性过滤）有明确管理，不与显隐状态混淆
**为什么需要检查**：过滤状态混乱会导致「过滤后切回全部数据时残留过滤」「过滤状态丢失」
**检查范围**：图层过滤逻辑、过滤状态存储、过滤与显隐的关系
**检查方法**：
1. 检查图层是否有过滤功能（按属性 / 时间 / 类型）
2. 检查过滤状态存储位置（store / 组件本地 / URL 参数）
3. 检查过滤与显隐是否混淆（过滤=数据筛选，显隐=图层可见性）
4. 检查过滤状态切换时是否正确更新图层数据（走 updateData）
5. 检查过滤状态在路由切换 / 渲染器切换后是否保留
6. 检查过滤条件清空时是否恢复全量数据
**需要查看**：图层过滤逻辑、过滤状态存储、updateData 调用
**正常标准**：
- 过滤状态有明确存储
- 过滤与显隐分离
- 过滤走 updateData
- 过滤状态切换后保留策略明确
- 清空过滤恢复全量
**异常情况**：
- 过滤状态用本地 ref，路由切换丢失
- 过滤与显隐混淆（用显隐模拟过滤）
- 过滤未走 updateData 导致数据不更新
- 过滤状态在渲染器切换后丢失
- 清空过滤未恢复全量
**风险等级**：P2
**整改方向**：过滤状态明确存储；与显隐分离；走 updateData；切换后保留策略
**验收标准**：过滤状态明确；与显隐分离；走 updateData；保留策略清晰

---

## 第七部分：地图交互与事件

> 目标：评估地图交互与事件管理的正确性，回答「事件是否注销」「交互模式是否正确切换」「弹窗是否泄漏」
> 地图事件未注销是内存泄漏与重复触发的常见来源

### 指标 7.1：地图事件监听注册与注销

**指标名称**：地图事件监听注册与注销
**检查目标**：确认所有地图事件监听（click / pointer-move / camera-changed / moveend）都有对应的注销
**为什么需要检查**：事件只注册不注销会导致重复触发、内存泄漏、组件卸载后仍触发回调
**检查范围**：渲染器 on/off、OL map.on/map.un、Cesium ScreenSpaceEventHandler、UnifiedMap setupEvents
**检查方法**：
1. 全局搜索 `renderer.on(` 调用
2. 全局搜索 `renderer.off(` 或销毁时的清理
3. 检查 OL `map.on('click', ...)` 是否有 `map.un('click', ...)`
4. 检查 Cesium `ScreenSpaceEventHandler` 是否有 `.destroy()`
5. 检查 UnifiedMap onUnmounted 是否注销 setupEvents 注册的事件
6. 检查事件 handler 是否为具名函数（匿名函数无法注销）
7. 检查渲染器切换时事件是否重新绑定
8. 检查 moveend 等高频事件是否有节流
**需要查看**：渲染器 on/off 实现、UnifiedMap setupEvents、OL/Cesium 事件注册、onUnmounted
**正常标准**：
- 每个 on 有对应 off
- handler 为具名函数
- onUnmounted 注销事件
- 渲染器切换重新绑定
- 高频事件有节流
- Cesium handler 有 destroy
**异常情况**：
- 注册事件无注销
- handler 为匿名函数无法注销
- onUnmounted 未注销事件
- 渲染器切换后事件丢失
- moveend 无节流导致性能差
- Cesium handler 未 destroy
**风险等级**：P0
**整改方向**：补全注销；具名 handler；onUnmounted 注销；切换重新绑定；节流
**验收标准**：每个 on 有 off；具名 handler；卸载注销；切换重绑；高频节流

### 指标 7.2：地图交互状态管理

**指标名称**：地图交互状态管理
**检查目标**：确认地图交互模式（绘制 / 测量 / 选取 / 平移）有明确状态管理，且模式切换时正确清理
**为什么需要检查**：交互模式混乱会导致「绘制模式下点击触发选取」「测量未完成就切换模式导致残留」
**检查范围**：交互模式状态存储、模式切换逻辑、模式间互斥关系
**检查方法**：
1. 检查交互模式是否有状态存储（store / composable ref）
2. 检查模式是否互斥（绘制与测量不能同时）
3. 检查模式切换时旧模式是否清理（如未完成的绘制）
4. 检查模式切换时事件监听是否正确切换
5. 检查模式切换时光标是否正确变化
6. 检查 Esc 键是否能取消当前模式
7. 检查组件卸载时是否退出当前模式
**需要查看**：交互模式 store/composable、模式切换逻辑、光标管理
**正常标准**：
- 交互模式有状态存储
- 模式互斥
- 切换时清理旧模式
- 事件监听正确切换
- 光标正确变化
- Esc 可取消
- 卸载时退出模式
**异常情况**：
- 模式无状态管理，多个模式同时激活
- 切换时未清理旧模式导致绘制残留
- 事件监听未切换导致错误触发
- 光标未变化用户不知当前模式
- 无法 Esc 取消
- 卸载后模式残留
**风险等级**：P1
**整改方向**：模式状态管理；互斥；切换清理；事件切换；光标管理；Esc 取消
**验收标准**：模式状态管理；互斥；切换清理；光标正确；Esc 可取消

### 指标 7.3：地图弹窗生命周期

**指标名称**：地图弹窗生命周期
**检查目标**：确认地图弹窗（Popup / Overlay）有完整的创建、更新、销毁生命周期
**为什么需要检查**：弹窗只创建不销毁会导致 DOM 堆积、内存泄漏、多个弹窗同时显示
**检查范围**：OL Overlay、Cesium InfoBox / Popup、Vue 弹窗组件
**检查方法**：
1. 检查弹窗创建方式（OL Overlay / Cesium entity billboard / Vue 组件）
2. 检查弹窗销毁时机（点击空白 / 切换要素 / 关闭按钮 / 组件卸载）
3. 检查同一时刻是否只有一个弹窗
4. 检查弹窗位置是否随地图移动而更新（OL Overlay 自动跟随）
5. 检查弹窗内容数据来源（要素属性）
6. 检查组件卸载时弹窗是否销毁
7. 检查弹窗与要素的关联是否正确（点击 A 要素显示 A 的弹窗）
**需要查看**：OL Overlay 创建/销毁、Cesium 弹窗、Vue 弹窗组件、点击事件处理
**正常标准**：
- 弹窗有完整生命周期
- 销毁时机正确
- 同一时刻一个弹窗
- 位置随地图更新
- 内容数据正确
- 卸载时销毁
- 与要素关联正确
**异常情况**：
- 弹窗只创建不销毁导致 DOM 堆积
- 多个弹窗同时显示
- 位置不更新导致弹窗停留在旧位置
- 内容数据错误
- 卸载后弹窗残留
- 弹窗与要素关联错乱
**风险等级**：P1
**整改方向**：补全弹窗销毁；单弹窗管理；位置更新；卸载清理
**验收标准**：弹窗有销毁；单弹窗；位置更新；卸载清理

### 指标 7.4：地图光标状态管理

**指标名称**：地图光标状态管理
**检查目标**：确认地图光标随交互模式 / hover 状态正确变化，且状态切换时光标重置
**为什么需要检查**：光标状态混乱会让用户困惑当前模式，且残留的光标状态影响体验
**检查范围**：光标样式设置、交互模式切换时的光标更新、hover 时光标变化
**检查方法**：
1. 检查不同交互模式的光标样式（绘制 crosshair / 测量 crosshair / 平移 grab）
2. 检查模式切换时光标是否更新
3. 检查 hover 要素时光标是否变化（pointer）
4. 检查退出模式时光标是否重置为默认
5. 检查光标样式是否硬编码（应配置化或 CSS 类）
6. 检查组件卸载时光标是否重置
**需要查看**：光标样式设置、模式切换逻辑、hover 处理、CSS 类
**正常标准**：
- 不同模式有不同光标
- 切换时更新
- hover 时变化
- 退出时重置
- 光标样式配置化
- 卸载时重置
**异常情况**：
- 所有模式同一光标用户无法区分
- 切换模式光标未更新
- hover 无变化
- 退出模式光标残留
- 光标样式硬编码
- 卸载后光标残留
**风险等级**：P3
**整改方向**：模式光标区分；切换更新；hover 变化；退出重置；配置化
**验收标准**：模式光标区分；切换更新；hover 变化；退出重置

### 指标 7.5：交互模式切换清理

**指标名称**：交互模式切换清理
**检查目标**：确认交互模式切换时，旧模式的临时状态（未完成的绘制 / 测量 / 选取）被正确清理
**为什么需要检查**：未清理的临时状态会残留为「画了一半的图形」「测了一半的距离」，影响下次使用
**检查范围**：绘制工具的临时要素、测量工具的临时线段、选取工具的高亮要素
**检查方法**：
1. 检查绘制模式切换时未完成的绘制要素是否移除
2. 检查测量模式切换时未完成的测量线段是否移除
3. 检查选取模式切换时高亮要素是否清除
4. 检查 Esc 取消时临时状态是否清理
5. 检查组件卸载时所有临时状态是否清理
6. 检查清理是否包括 OL 临时 layer / Cesium 临时 entity
**需要查看**：绘制/测量/选取工具的临时要素管理、模式切换清理、Esc 处理、卸载清理
**正常标准**：
- 模式切换清理临时状态
- Esc 清理临时状态
- 卸载清理临时状态
- 清理包括 OL layer / Cesium entity
**异常情况**：
- 切换模式未清理导致残留图形
- Esc 未清理
- 卸载后临时图形残留
- 清理不彻底（只清 OL 不清 Cesium 或反之）
**风险等级**：P1
**整改方向**：模式切换清理；Esc 清理；卸载清理；多引擎都清理
**验收标准**：切换清理；Esc 清理；卸载清理；多引擎覆盖

---

## 第八部分：地图工具与组件

> 目标：评估地图工具（测量 / 绘制 / 控件）与组件的生命周期管理，回答「工具是否正确销毁」「控件是否清理」
> 地图工具是 GIS 项目中容易泄漏的资源

### 指标 8.1：测量工具生命周期

**指标名称**：测量工具生命周期
**检查目标**：确认测量工具（距离测量 / 面积测量）有完整的创建、使用、销毁生命周期
**为什么需要检查**：测量工具持有事件监听、临时图层、临时要素，未销毁会泄漏
**检查范围**：测量工具 composable / class、测量事件监听、测量临时要素
**检查方法**：
1. 检查测量工具创建方式（OL Draw / Cesium measure handler / 自实现）
2. 检查测量工具销毁时机（切换模式 / 完成测量 / 组件卸载）
3. 检查测量事件监听是否注销
4. 检查测量临时要素（线段 / 多边形 / 标注）是否清理
5. 检查测量结果数据是否管理（store / 本地）
6. 检查多次测量时旧结果是否保留或清理（策略明确）
7. 检查 2D / 3D 引擎中测量工具是否对齐
**需要查看**：测量工具实现、事件监听、临时要素管理、销毁逻辑
**正常标准**：
- 测量工具有完整生命周期
- 销毁时机正确
- 事件监听注销
- 临时要素清理
- 测量结果管理明确
- 多次测量策略明确
- 2D/3D 对齐
**异常情况**：
- 测量工具未销毁导致事件堆积
- 事件监听未注销
- 临时要素残留
- 测量结果无管理导致内存增长
- 多次测量策略不清
- 2D/3D 测量行为不一致
**风险等级**：P1
**整改方向**：补全销毁；注销事件；清理临时要素；结果管理；2D/3D 对齐
**验收标准**：测量工具销毁完整；事件注销；临时要素清理；2D/3D 对齐

### 指标 8.2：绘制工具生命周期

**指标名称**：绘制工具生命周期
**检查目标**：确认绘制工具（点 / 线 / 面 绘制）有完整的创建、使用、销毁生命周期
**为什么需要检查**：绘制工具持有事件监听、临时图形、绘制状态，未销毁会泄漏且影响后续交互
**检查范围**：绘制工具 composable / class、OL Draw / Cesium 绘制 handler、绘制临时图形
**检查方法**：
1. 检查绘制工具创建方式
2. 检查绘制工具销毁时机（完成绘制 / 取消 / 切换模式 / 组件卸载）
3. 检查绘制事件监听是否注销
4. 检查绘制中的临时图形（未完成的草图）是否清理
5. 检查绘制完成后的要素是否正确添加到目标图层
6. 检查绘制工具与交互模式的互斥（绘制时禁用平移？）
7. 检查 2D / 3D 引擎中绘制工具是否对齐
**需要查看**：绘制工具实现、事件监听、临时图形管理、完成处理
**正常标准**：
- 绘制工具有完整生命周期
- 销毁时机正确
- 事件监听注销
- 临时图形清理
- 完成要素正确添加
- 与交互模式互斥
- 2D/3D 对齐
**异常情况**：
- 绘制工具未销毁导致事件堆积
- 事件监听未注销
- 草图残留
- 完成要素未添加到图层
- 绘制时平移冲突
- 2D/3D 行为不一致
**风险等级**：P1
**整改方向**：补全销毁；注销事件；清理草图；完成添加；模式互斥；2D/3D 对齐
**验收标准**：绘制工具销毁完整；事件注销；草图清理；完成添加；2D/3D 对齐

### 指标 8.3：地图控件管理

**指标名称**：地图控件管理
**检查目标**：确认地图控件（缩放 / 比例尺 / 指南针 / 全屏）有明确管理，且可配置开关
**为什么需要检查**：控件硬编码在渲染器中会导致无法定制，且不同业务页面可能需要不同控件
**检查范围**：OL control / Cesium widget 配置、控件开关、控件样式
**检查方法**：
1. 检查 OL Map 是否配置了默认控件（zoom / attribution / scaleLine）
2. 检查 Cesium Viewer 创建时哪些 widget 被禁用（baseLayerPicker / fullscreenButton 等）
3. 检查控件是否可配置开关（不同业务页面不同控件）
4. 检查控件样式是否与项目主题一致
5. 检查控件位置是否合理
6. 检查 2D / 3D 引擎中控件行为是否对齐
7. 检查控件是否随地图实例销毁而清理
**需要查看**：OL Map controls 配置、Cesium Viewer 创建参数、控件开关配置
**正常标准**：
- 控件配置明确
- 不需要的 widget 禁用
- 控件可配置开关
- 样式与主题一致
- 位置合理
- 2D/3D 对齐
- 随实例销毁清理
**异常情况**：
- 默认控件全开导致 UI 混乱
- 需要的控件被禁用
- 控件无法配置
- 样式与主题冲突
- 位置遮挡业务内容
- 2D/3D 控件不一致
- 销毁后控件残留
**风险等级**：P3
**整改方向**：控件配置化；禁用不需要的 widget；样式主题化；2D/3D 对齐
**验收标准**：控件配置化；widget 合理；样式主题化；2D/3D 对齐

### 指标 8.4：地图组件卸载清理完整性

**指标名称**：地图组件卸载清理完整性
**检查目标**：确认地图相关组件（UnifiedMap / LayerControlPanel / 测量组件 / 绘制组件）卸载时清理所有资源
**为什么需要检查**：组件卸载清理不彻底是内存泄漏与状态残留的主要来源
**检查范围**：所有地图相关组件的 onUnmounted / onBeforeUnmount、清理的资源类型
**检查方法**：
1. 检查 UnifiedMap onUnmounted 是否清理：渲染器实例、事件监听、rAF、异步回调、DOM ref
2. 检查 LayerControlPanel 卸载是否清理：本地状态、事件监听
3. 检查测量 / 绘制组件卸载是否清理：工具实例、临时要素、事件监听
4. 检查弹窗组件卸载是否清理：弹窗 DOM、关联要素
5. 检查图例组件卸载是否清理：监听、本地状态
6. 检查清理顺序是否正确（先清理依赖再清理主体）
7. 检查清理是否有遗漏（对照创建时的资源清单）
8. 检查 abort 机制（loadAbort）是否正确阻止异步回调
**需要查看**：所有地图组件的 onUnmounted、清理逻辑、abort 机制
**正常标准**：
- 每个组件卸载清理完整
- 渲染器实例销毁
- 事件监听注销
- rAF 取消
- 异步回调 abort
- DOM ref 置空
- 清理顺序正确
- 无遗漏
**异常情况**：
- UnifiedMap 卸载未销毁渲染器
- 事件监听未注销
- rAF 未取消导致卸载后操作 DOM
- 异步回调未 abort 导致卸载后写 ref
- DOM ref 未置空
- 清理顺序错误导致依赖问题
- 清理遗漏（如忘记清弹窗）
**风险等级**：P0
**整改方向**：补全清理；注销事件；取消 rAF；abort 异步；置空 ref；检查顺序
**验收标准**：每个组件清理完整；事件注销；rAF 取消；异步 abort；ref 置空

---

## 附录 A：GIS 风险等级验收标准汇总

| 等级 | 验收要求 | 本专项涉及指标 |
|------|----------|----------------|
| P0 | 必须立即修复，不允许带病上线 | 1.1 坐标系识别、1.2 转换链路完整、1.3 转换显式性、1.5 坐标格式（顺序错乱）、2.2 图层创建销毁配对、3.3 渲染器切换清理、3.5 渲染器实例生命周期、4.1 Cesium 创建销毁、4.2 OL 创建销毁、4.5 销毁后引用置空、5.6 地形加载策略、7.1 事件监听注销、8.4 组件卸载清理 |
| P1 | 本轮审查必须修复 | 1.4 坐标系配置化、1.5 坐标格式（命名混用）、2.1 图层类型清单、2.3 图层显隐控制、2.4 切换时旧图层清理、2.6 数据源更新机制、2.7 图层控制多入口、3.1 渲染器接口完整、3.2 适配器边界清晰、3.4 能力差异处理、4.3 地图实例单例性、4.4 DOM 引用管理、5.1 空间索引、5.2 视口裁剪、5.3 大数据量策略、5.5 要素数量限制、6.1 状态与 store 同步、6.2 显隐单一来源、7.2 交互状态管理、7.3 弹窗生命周期、7.5 交互模式切换清理、8.1 测量工具生命周期、8.2 绘制工具生命周期 |
| P2 | 计划修复，限期完成 | 2.5 z-order 管理、5.4 瓦片缓存策略、6.3 样式管理、6.4 图例同步、6.5 过滤状态管理 |
| P3 | 择机优化 | 7.4 光标状态管理、8.3 地图控件管理 |

---

## 附录 B：与其他专项的协作关系

本专项在审查过程中会与其他专项产生交叉，下表列出交叉点与协作方式：

| 交叉领域 | 本专项指标 | 关联专项 | 协作方式 |
|----------|------------|----------|----------|
| 数据来源与字段映射 | 1.2 坐标系转换链路、2.6 图层数据源更新 | 数据链专项 | 本专项关注空间数据链路，数据链专项关注通用数据链路 |
| 对象生命周期与销毁 | 4.4 DOM 引用管理、7.3 弹窗生命周期、8.1/8.2 工具生命周期 | 生命周期专项 | 本专项关注地图对象销毁，生命周期专项关注通用对象销毁 |
| 异步与竞态 | 3.3 渲染器切换（异步）、8.4 组件卸载（abort） | 生命周期专项 | 本专项关注地图异步切换，生命周期专项关注通用异步 |
| 类型覆盖率 | 3.1 渲染器接口类型契约 | TS 专项 | 本专项关注渲染器接口契约，TS 专项关注类型覆盖率与 any 治理 |
| 模块边界与依赖 | 3.2 渲染器适配器边界 | 架构耦合专项 | 本专项关注渲染器边界，架构耦合专项关注通用模块边界 |
| 性能审查 | 5.1-5.6 空间数据性能 | 工程化专项 | 本专项关注 GIS 特有性能，工程化专项关注通用性能 |
| 错误处理 | 3.4 渲染器能力差异降级、5.6 地形加载兜底 | 工程化专项 | 本专项关注地图降级，工程化专项关注全局错误处理 |
| 响应式正确性 | 6.1 状态与 store 同步、6.2 显隐单一来源 | 生命周期专项 | 本专项关注图层状态响应式，生命周期专项关注通用响应式 |

协作原则：
- 本专项发现跨域问题时，在审查报告中标注「转 XX 专项」并引用对应指标编号
- 不重复审查其他专项的核心领域，仅从 WebGIS 角度切入
- 各专项可并行执行，结论可交叉引用
- 当问题落在地图实例/图层/坐标系/渲染器/空间数据/地图交互/地图工具时，专属本专项

---

## 附录 C：执行清单（可勾选的检查项汇总）

> 使用说明：审查时逐项勾选，未通过项标注风险等级并记录整改计划

### 第一部分：坐标系审查

- [ ] 1.1 有 DEFAULT_CRS 常量定义且全局引用（P0）
- [ ] 1.1 CRS 类型为受控枚举（P0）
- [ ] 1.1 业务数据 CRS 与渲染 CRS 明确区分（P0）
- [ ] 1.1 有业务区域 bbox 校验常量（P0）
- [ ] 1.1 每类空间数据有 CRS 标注或可从默认推导（P0）
- [ ] 1.2 每条空间数据链路可画出且环节完整（P0）
- [ ] 1.2 业务层不感知渲染投影（4326→3857 在渲染器内部）（P0）
- [ ] 1.2 点击事件回传 coordinate 为 4326（P0）
- [ ] 1.2 GeoJSON 数据声明 CRS 或默认 4326（P0）
- [ ] 1.3 所有坐标转换显式调用且显式传 CRS（P0）
- [ ] 1.3 业务层不直接调用 OL/Cesium 投影函数（P0）
- [ ] 1.3 渲染器接口入参坐标统一为业务 CRS（P0）
- [ ] 1.3 同一坐标在 2D/3D 转换方式一致（P0）
- [ ] 1.4 有集中 MAP_CONFIG 配置且被全局引用（P1）
- [ ] 1.4 默认中心、zoom、bbox 从配置读取（P1）
- [ ] 1.4 CRS 字符串引用常量而非字面量（P1）
- [ ] 1.4 无硬编码业务坐标数值散落组件（P1）
- [ ] 1.5 全项目统一坐标命名约定（lng/lat）（P1）
- [ ] 1.5 GeoJSON coordinates 顺序为 [lng, lat]（P0）
- [ ] 1.5 Cesium fromDegrees(lng, lat) 顺序正确（P0）
- [ ] 1.5 OL fromLonLat([lng, lat]) 顺序正确（P0）
- [ ] 1.5 历史混用字段有 normalizePoint 归一化（P1）
- [ ] 1.5 无度分秒与十进制度混用（P1）

### 第二部分：图层生命周期审查

- [ ] 2.1 图层类型清单完整且与枚举/adapter 对齐（P1）
- [ ] 2.1 每种类型有 adapter 三件套（create/update/remove）（P1）
- [ ] 2.1 2D/3D 专属能力在接口标注可选方法（P1）
- [ ] 2.1 瓦片底图与业务图层分离管理（P1）
- [ ] 2.1 无游离的图层创建调用（绕过 manager）（P1）
- [ ] 2.2 每个图层 id 有配对的创建与销毁（P0）
- [ ] 2.2 销毁时机正确（onUnmounted/路由切换/模块切换）（P0）
- [ ] 2.2 创建与销毁次数匹配（P0）
- [ ] 2.2 BusinessLayerManager.destroy 清理所有图层（P0）
- [ ] 2.2 渲染器 destroy 清理内部 _layers（P0）
- [ ] 2.2 更新数据时重建不泄漏旧资源（P0）
- [ ] 2.3 显隐统一通过 setVisibility（P1）
- [ ] 2.3 无 removeLayer + addLayer 模拟显隐（P1）
- [ ] 2.3 setVisibility 后数据保留可 toggle 回来（P1）
- [ ] 2.3 显隐状态同步到 store（P1）
- [ ] 2.3 初始 visible=false 的图层被创建但不可见（P1）
- [ ] 2.4 路由切换清理旧业务图层（P1）
- [ ] 2.4 渲染器切换通过 reapplyAll 重绘（P1）
- [ ] 2.4 底图切换通过 setVisibility 而非 remove+add（P1）
- [ ] 2.4 reapplyAll 仅重绘可见图层（P1）
- [ ] 2.5 每个图层显式设置 zIndex（P2）
- [ ] 2.5 底图 zIndex 低于业务图层（P2）
- [ ] 2.5 zIndex 配置化（常量或 options）（P2）
- [ ] 2.5 同类型图层 zIndex 一致（P2）
- [ ] 2.6 updateData 不覆盖 visible 状态（P1）
- [ ] 2.6 优先使用增量更新方法（P1）
- [ ] 2.6 不可见图层更新只缓存数据（P1）
- [ ] 2.6 null/undefined 数据有兜底处理（P1）
- [ ] 2.7 图层控制单一入口（BusinessLayerManager）（P1）
- [ ] 2.7 无组件直接调渲染器 addXxxLayer/setVisibility（P1）
- [ ] 2.7 mapStore action 单一修改路径（P1）
- [ ] 2.7 图层 id 命名有约定且不冲突（P1）

### 第三部分：渲染器适配器审查

- [ ] 3.1 接口方法完整覆盖业务需求（P1）
- [ ] 3.1 每个方法有完整 TypeScript 类型签名（P1）
- [ ] 3.1 可选方法标注 ? 且文档说明（P1）
- [ ] 3.1 事件类型 MapRendererEventMap 完整（P1）
- [ ] 3.1 业务层无绕过接口直接调底层（P1）
- [ ] 3.1 有接口契约测试（P1）
- [ ] 3.2 OLRenderer 只 import OL（P1）
- [ ] 3.2 CesiumRenderer 只 import Cesium（P1）
- [ ] 3.2 业务层无引擎类型判断（if getType）（P1）
- [ ] 3.2 shared 无引擎特定代码（P1）
- [ ] 3.2 状态传递用中立类型（CameraState）（P1）
- [ ] 3.2 两渲染器继承同一抽象类（P1）
- [ ] 3.3 切换策略明确（复用或销毁）且文档化（P0）
- [ ] 3.3 复用时正确暂停渲染降低 GPU（P0）
- [ ] 3.3 切换时事件监听清理或重新绑定（P0）
- [ ] 3.3 状态通过 exportState/importState 传递（P0）
- [ ] 3.3 切换失败有回滚（mapType 恢复）（P0）
- [ ] 3.3 空闲销毁策略合理（P0）
- [ ] 3.3 WebGL 上下文数量在浏览器限制内（P0）
- [ ] 3.4 可选方法不适配引擎返回 false + warn（P1）
- [ ] 3.4 adapter 层断言非空（P1）
- [ ] 3.4 业务层调用前检查能力（P1）
- [ ] 3.4 降级有用户提示（P1）
- [ ] 3.4 引擎切换时能力差异图层正确处理（P1）
- [ ] 3.5 渲染器实例创建/销毁时机明确（P0）
- [ ] 3.5 组件卸载时两渲染器都销毁（P0）
- [ ] 3.5 销毁后 ref 置空（P0）
- [ ] 3.5 无僵尸引用（P0）
- [ ] 3.5 CesiumViewerManager 单例并发安全（P0）
- [ ] 3.5 destroy 清理图层/事件/WebGL（P0）

### 第四部分：地图实例生命周期

- [ ] 4.1 每个 new Viewer 有对应 destroy（P0）
- [ ] 4.1 destroy 时机正确（卸载/空闲/退出）（P0）
- [ ] 4.1 destroy 前清理 entities/dataSources/primitives（P0）
- [ ] 4.1 destroy 后 viewer 引用置空（P0）
- [ ] 4.1 空闲销毁定时器正确取消（P0）
- [ ] 4.1 单例模式下 destroy 策略明确（P0）
- [ ] 4.2 每个 new Map 有 setTarget(null) 或 dispose（P0）
- [ ] 4.2 OL Map 销毁时机正确（P0）
- [ ] 4.2 销毁前清理图层与监听（P0）
- [ ] 4.2 销毁后 map 引用置空（P0）
- [ ] 4.2 View 随 Map 销毁（P0）
- [ ] 4.3 同一时刻只有一个 UnifiedMap 实例（P1）
- [ ] 4.3 CesiumViewerManager 单例正确（P1）
- [ ] 4.3 initRenderer 复用已有实例（P1）
- [ ] 4.3 HMR 不导致重复创建（P1）
- [ ] 4.3 路由 engine 与 mapType 一致（P1）
- [ ] 4.4 DOM ref 在卸载后置空（P1）
- [ ] 4.4 CesiumViewerManager 不长期持有已删除 container（P1）
- [ ] 4.4 waitForContainerVisible 卸载后被忽略（P1）
- [ ] 4.4 rAF 回调卸载时取消（P1）
- [ ] 4.4 Cesium container 移动逻辑正确（P1）
- [ ] 4.5 currentRenderer.value 销毁后置空（P0）
- [ ] 4.5 olRenderer/cesiumRenderer ref 置空（P0）
- [ ] 4.5 mapStore.setCurrentRenderer(null) 调用（P0）
- [ ] 4.5 CesiumViewerManager.viewer 置空（P0）
- [ ] 4.5 provide/inject 失效（P0）
- [ ] 4.5 异步回调守卫（loadAbort）（P0）
- [ ] 4.5 BusinessLayerManager._mapStore 置空（P0）

### 第五部分：空间数据性能

- [ ] 5.1 有空间索引工具（rbush/自实现 R-tree）（P1）
- [ ] 5.1 要素超阈值时自动建索引（P1）
- [ ] 5.1 阈值合理且有文档说明（P1）
- [ ] 5.1 索引随数据更新重建（P1）
- [ ] 5.1 索引随图层销毁清理（P1）
- [ ] 5.1 索引用于视口裁剪（P1）
- [ ] 5.2 moveend 触发视口裁剪（P1）
- [ ] 5.2 视口范围计算正确（P1）
- [ ] 5.2 裁剪后要素替换而非追加（P1）
- [ ] 5.2 flyTo/zoom 后触发视口更新（P1）
- [ ] 5.2 视口裁剪有节流（P1）
- [ ] 5.2 不可见图层暂停裁剪（P1）
- [ ] 5.3 大数据量有聚合或简化策略（P1）
- [ ] 5.3 聚合阈值随 zoom 自适应（P1）
- [ ] 5.3 瓦片有 LOD（P1）
- [ ] 5.3 大场景用 3D Tiles（P1）
- [ ] 5.3 策略有性能验证（benchmark）（P1）
- [ ] 5.4 瓦片 URL 正确带 token（P2）
- [ ] 5.4 OL/Cesium 配置 cacheSize（P2）
- [ ] 5.4 crossOrigin 设置（P2）
- [ ] 5.4 瓦片加载失败有重试（P2）
- [ ] 5.4 HTTP 缓存头合理（P2）
- [ ] 5.5 有要素数量上限校验（P1）
- [ ] 5.5 超限有降级策略（P1）
- [ ] 5.5 超限有日志告警（P1）
- [ ] 5.5 GeoJSON 加载校验要素数量（P1）
- [ ] 5.5 Cesium entity 数量受控（P1）
- [ ] 5.6 terrainProvider 配置正确（P0）
- [ ] 5.6 地形按需加载（切 3D 时）（P0）
- [ ] 5.6 LOD 启用（P0）
- [ ] 5.6 地形与影像配准（P0）
- [ ] 5.6 加载失败有兜底（P0）
- [ ] 5.6 2D 不加载地形（P0）

### 第六部分：图层状态管理

- [ ] 6.1 setVisible 同时更新 store 与渲染器（P1）
- [ ] 6.1 store.setLayerVisible 单一入口（P1）
- [ ] 6.1 初始 visible 写入 catalog（P1）
- [ ] 6.1 销毁时从 catalog 移除（P1）
- [ ] 6.1 渲染器切换后 catalog 保留（P1）
- [ ] 6.2 显隐状态单一来源（store 为权威）（P1）
- [ ] 6.2 无组件本地 visible ref 副本（P1）
- [ ] 6.2 渲染器跟随 store（P1）
- [ ] 6.2 无 watch 手动同步（P1）
- [ ] 6.3 样式集中常量管理（LAYER_DEFAULTS）（P2）
- [ ] 6.3 addXxxLayer 从 options 读取样式（P2）
- [ ] 6.3 同类型图层样式一致（P2）
- [ ] 6.3 2D/3D 样式对齐（P2）
- [ ] 6.4 图例从 layerCatalog 读取状态（P2）
- [ ] 6.4 图层销毁图例同步移除（P2）
- [ ] 6.4 显隐切换图例同步更新（P2）
- [ ] 6.4 toggle 走 BusinessLayerManager.setVisible（P2）
- [ ] 6.5 过滤状态有明确存储（P2）
- [ ] 6.5 过滤与显隐分离（P2）
- [ ] 6.5 过滤走 updateData（P2）
- [ ] 6.5 过滤状态切换后保留策略明确（P2）

### 第七部分：地图交互与事件

- [ ] 7.1 每个 renderer.on 有对应 off（P0）
- [ ] 7.1 handler 为具名函数（可注销）（P0）
- [ ] 7.1 onUnmounted 注销事件（P0）
- [ ] 7.1 渲染器切换时事件重新绑定（P0）
- [ ] 7.1 moveend 等高频事件有节流（P0）
- [ ] 7.1 Cesium ScreenSpaceEventHandler 有 destroy（P0）
- [ ] 7.1 OL map.on 有 map.un（P0）
- [ ] 7.2 交互模式有状态存储（P1）
- [ ] 7.2 模式互斥（绘制与测量不能同时）（P1）
- [ ] 7.2 切换时清理旧模式（P1）
- [ ] 7.2 事件监听正确切换（P1）
- [ ] 7.2 光标随模式变化（P1）
- [ ] 7.2 Esc 可取消当前模式（P1）
- [ ] 7.2 卸载时退出模式（P1）
- [ ] 7.3 弹窗有完整生命周期（P1）
- [ ] 7.3 弹窗销毁时机正确（P1）
- [ ] 7.3 同一时刻一个弹窗（P1）
- [ ] 7.3 弹窗位置随地图更新（P1）
- [ ] 7.3 卸载时弹窗销毁（P1）
- [ ] 7.4 不同模式有不同光标（P3）
- [ ] 7.4 切换模式光标更新（P3）
- [ ] 7.4 hover 要素光标变化（P3）
- [ ] 7.4 退出模式光标重置（P3）
- [ ] 7.5 模式切换清理临时状态（P1）
- [ ] 7.5 Esc 取消清理临时状态（P1）
- [ ] 7.5 卸载清理临时状态（P1）
- [ ] 7.5 OL/Cesium 临时要素都清理（P1）

### 第八部分：地图工具与组件

- [ ] 8.1 测量工具有完整生命周期（P1）
- [ ] 8.1 测量工具销毁时机正确（P1）
- [ ] 8.1 测量事件监听注销（P1）
- [ ] 8.1 测量临时要素清理（P1）
- [ ] 8.1 测量结果数据有管理（P1）
- [ ] 8.1 2D/3D 测量行为对齐（P1）
- [ ] 8.2 绘制工具有完整生命周期（P1）
- [ ] 8.2 绘制工具销毁时机正确（P1）
- [ ] 8.2 绘制事件监听注销（P1）
- [ ] 8.2 绘制草图清理（P1）
- [ ] 8.2 完成要素正确添加到图层（P1）
- [ ] 8.2 绘制与交互模式互斥（P1）
- [ ] 8.2 2D/3D 绘制行为对齐（P1）
- [ ] 8.3 控件配置明确（P3）
- [ ] 8.3 不需要的 widget 禁用（P3）
- [ ] 8.3 控件可配置开关（P3）
- [ ] 8.3 控件样式与主题一致（P3）
- [ ] 8.3 2D/3D 控件行为对齐（P3）
- [ ] 8.4 UnifiedMap 卸载清理渲染器实例（P0）
- [ ] 8.4 UnifiedMap 卸载注销事件监听（P0）
- [ ] 8.4 UnifiedMap 卸载取消 rAF（P0）
- [ ] 8.4 UnifiedMap 卸载 abort 异步回调（P0）
- [ ] 8.4 UnifiedMap 卸载 DOM ref 置空（P0）
- [ ] 8.4 LayerControlPanel 卸载清理（P0）
- [ ] 8.4 测量/绘制组件卸载清理工具（P0）
- [ ] 8.4 弹窗组件卸载清理弹窗 DOM（P0）
- [ ] 8.4 清理顺序正确（P0）
- [ ] 8.4 清理无遗漏（对照创建资源清单）（P0）

---

## 附录 D：GIS 常见坐标系与转换速查

> 本附录为审查时的速查参考，列出 GIS 项目常见坐标系、转换方法、常见错误

### D.1 常见 EPSG 代码

| EPSG | 名称 | 类型 | 单位 | 典型用途 |
|------|------|------|------|----------|
| EPSG:4326 | WGS84 | 地理坐标系（经纬度） | 度 | GPS、Web 地图业务数据默认、GeoJSON 规范默认 |
| EPSG:4490 | CGCS2000 | 地理坐标系（经纬度） | 度 | 中国国家标准，与 WGS84 在 web 精度下可互换 |
| EPSG:3857 | Web Mercator（球面墨卡托） | 投影坐标系 | 米 | OL/Leaflet/Google Maps 渲染投影 |
| EPSG:900913 | Google Web Mercator（旧） | 投影坐标系 | 米 | 已被 3857 取代，旧代码可能仍在用 |
| EPSG:4547 | CGCS2000 / 3-degree Gauss-Kruger CM 108E | 投影坐标系 | 米 | 中国北部湾区域工程测量（带号 108°E 中央经线） |
| EPSG:4491 | CGCS2000（旧） | 地理坐标系 | 度 | 早期 CGCS2000 代码，已被 4490 取代 |
| EPSG:4610 | Beibu Gulf 1954 | 地理坐标系 | 度 | 北部湾地方坐标系（罕见） |

### D.2 北部湾项目典型坐标系约定

- **业务数据 CRS**：EPSG:4326（WGS84），统一使用 `lng/lat` 字段名
- **国标备选**：EPSG:4490（CGCS2000），与 4326 在 web 地图精度下可互换，无需转换
- **渲染投影 CRS**：EPSG:3857（Web Mercator），由 OL 内部投影，业务层不感知
- **工程测量**：EPSG:4547（CGCS2000 高斯-克吕格 3 度带 108E），用于工程数据，进入 Web 前需转 4326
- **业务区域 bbox**：lng [105.0, 112.0]，lat [18.0, 23.5]

### D.3 常见转换方法

| 转换方向 | OL 方法 | Cesium 方法 | 说明 |
|----------|---------|-------------|------|
| 4326 → 3857 | `fromLonLat([lng, lat])` | 不需要（Cesium 内部 4326） | OL 渲染前转换 |
| 3857 → 4326 | `toLonLat([x, y])` | 不需要 | OL 点击坐标回传 |
| 度 → 弧度 | 不常用 | `Cesium.Math.toRadians(deg)` | Cesium 部分API 用弧度 |
| 弧度 → 度 | 不常用 | `Cesium.Math.toDegrees(rad)` | Cesium 回传坐标 |
| 度 → Cartesian3 | 不直接 | `Cartesian3.fromDegrees(lng, lat, height)` | Cesium 渲染坐标 |
| Cartesian3 → 度 | 不直接 | `Cartographic.fromCartesian()` + toDegrees | Cesium 点击回传 |
| 4326 ↔ 4490 | 不需要 | 不需要 | web 精度下可互换 |
| 4547 → 4326 | `proj.transform([x,y], 'EPSG:4547', 'EPSG:4326')` | 需 proj4js | 工程数据进 Web 前 |

### D.4 常见错误与症状

| 错误 | 症状 | 排查方法 |
|------|------|----------|
| 4326 坐标当 3857 渲染 | 点位偏移巨大（跑到海里或非洲） | 检查 OL 是否调用 fromLonLat |
| 3857 坐标当 4326 渲染 | 点位偏移巨大 | 检查数据 CRS 标注 |
| 经纬度顺序颠倒 | 点位南北镜像或东西镜像 | 检查 [lng, lat] vs [lat, lng] |
| Cesium fromDegrees 顺序错 | 点位跑到错误位置 | 应为 fromDegrees(lng, lat) |
| 点击回传 3857 当 4326 | 选址计算偏移 | 检查 toLonLat 调用 |
| 度分秒未转十进制度 | 坐标解析为 NaN | 检查输入格式 |
| 弧度当度使用 | 坐标数值异常小 | 检查 Cesium API 单位 |
| 4547 未转 4326 直接渲染 | 点位偏移数百米 | 检查工程数据入口转换 |
| CGCS2000 当 WGS84 不转换 | web 精度下无影响（可接受） | 文档说明可互换即可 |
| GeoJSON 未声明 CRS | 默认按 4326（规范）但易误解 | 显式声明 CRS |
| normalizePoint 缺失 | lon/longitude 字段渲染崩溃 | 检查归一化函数 |

### D.5 坐标系审查快速诊断流程

1. **定位症状**：点位偏移 / 镜像 / NaN / 跑到海里
2. **追溯数据源 CRS**：接口返回 / GeoJSON / 配置常量
3. **追溯转换链路**：数据源 → adapter → store → 渲染器 → OL/Cesium
4. **检查每一跳 CRS**：是否一致或显式转换
5. **检查 API 调用顺序**：fromLonLat([lng, lat]) / fromDegrees(lng, lat)
6. **检查回传坐标**：点击事件 coordinate 是否为业务 CRS
7. **检查归一化**：历史字段名是否经 normalizePoint
8. **验证修复**：用已知坐标点（如北部湾 108.5, 21.9）验证渲染位置正确

---

## 附录 E：本专项审查执行流程建议

执行一次 WebGIS 专项审查的建议步骤：

1. **建立坐标系清单**（第一部分 1.1-1.5）：先识别项目所有空间数据的坐标系，画出转换链路
2. **建立图层清单**（第二部分 2.1-2.7）：列出所有图层类型与实例，审查创建销毁配对
3. **审查渲染器适配器**（第三部分 3.1-3.5）：审查接口完整性、边界清晰性、切换安全
4. **审查地图实例生命周期**（第四部分 4.1-4.5）：审查 Cesium/OL 实例创建销毁与引用管理
5. **审查空间数据性能**（第五部分 5.1-5.6）：审查索引、视口裁剪、大数据策略、瓦片缓存
6. **审查图层状态管理**（第六部分 6.1-6.5）：审查状态同步、单一来源、样式配置化
7. **审查地图交互与事件**（第七部分 7.1-7.5）：审查事件注销、交互模式、弹窗生命周期
8. **审查地图工具与组件**（第八部分 8.1-8.4）：审查测量/绘制工具、控件、组件卸载清理
9. **汇总输出**：按 P0/P1/P2/P3 分级，给出整改清单与验收标准

每一步的输出都应能被下一步引用，形成「坐标系 → 图层 → 渲染器 → 实例 → 性能 → 状态 → 交互 → 工具」的完整证据链。

---

> 本专项 v1.0 完成。后续基于实战使用反馈迭代版本，特别是双引擎切换、3D Tiles、WebGL 上下文管理等深度场景。
