# 北部湾港 WebGIS 平台 — 编码规范

> **版本**：1.0
> **编制**：2026-07-27
> **维护人**：姜皓源
> **语言**：中文，术语使用 GIS 英文原词
> **定位**：不是从 Airbnb 或 Google 抄的通用规范。这套规范从北部湾项目代码里长出来，每一个规则都有具体的项目文件可以对照。

---

## 目录

1. [核心原则](#1-核心原则)
2. [文件组织与命名](#2-文件组织与命名)
3. [命名规范](#3-命名规范)
4. [注释规范](#4-注释规范)
5. [Vue 组件规范](#5-vue-组件规范)
6. [后端规范（Express / NestJS）](#6-后端规范express--nestjs)
7. [Git 提交规范](#7-git-提交规范)
8. [工具配置](#8-工具配置)
9. [自检表](#9-自检表)
10. [渐进式迁移计划](#10-渐进式迁移计划)

---

## 1. 核心原则

记住这三条，规范的其余部分是它们的展开：

```
1. 地理术语优先于通用术语
   lng/lat（不是 lon/lat） ｜ elevation（不是 altitude） ｜ feature（不是 item） ｜ crs（不是 coordSystem）

2. 代码自解释，注释写"为什么"和"地理背景"
   不写 "// 遍历数组"
   写 "// 北部湾区域存在大量凹多边形，turf.union 可能返回 MultiPolygon，需降级处理"

3. 双引擎思维渗透到命名
   凡是可能同时存在 2D/3D 两种实现的，必须用策略模式命名（Renderer / Adapter / Strategy）
```

---

## 2. 文件组织与命名

### 2.1 目录结构（已固定，不可再改）

```
src/
  types/              # 全局类型契约
    business/         #   业务数据模型（小区、设施、洪水……）
    components/       #   组件 Props/Emits 类型
  core/               # 引擎层
    config/           #   天地图配置、地图常量
    map/              #   地图引擎
      renderers/      #     渲染器实现（OL + Cesium）
      composables/    #     地图相关组合式函数
    layout/           #   GCS 面板系统
      components/     #     GcsPanel / GcsButton / BottomNavBar……
  business/           # 业务模块
    site-selection/   #   选址分析
    flood-analysis/   #   浸没分析
    forecast/         #   预测分析
      components/     #     业务专属组件
      composables/    #     业务专属组合式函数
  stores/             # Pinia Store（统一 Setup Store 语法）
  shared/             # 跨业务复用
    components/       #   通用组件
    composables/      #   通用组合式函数
    utils/            #   纯工具函数
  visualization/      # 可视化
    charts/           #   图表组件
      composables/    #     ECharts 组合式函数
    panels/           #   信息面板
  router/             # Vue Router
  views/              # 通用页面（HomePage / ProfilePage）
  services/           # 静态数据服务 + Adapter
    adapters/         #   数据源适配器（mock / API）
server/
  routes/             # 路由注册（只转发，不写逻辑）
  controllers/        # 请求解析 + 响应组装
  services/           # 业务逻辑（选址评分 / 空间计算 / 水文模拟）
  middleware/         # 横切关注点（auth / error / logger）
  repositories/       # 数据访问（JSON 读写 + 缓存）
  utils/              # 纯函数工具
  data/               # 业务数据文件（JSON）
```

### 2.2 文件命名

| 类型 | 规则 | 示例 | 禁止 |
|------|------|------|------|
| Vue 页面组件 | `PascalCase + Page.vue` | `SiteSelectionPage.vue` / `FloodAnalysisPage.vue` | `siteSelection.vue` |
| Vue 面板组件 | `PascalCase + Panel.vue` | `GcsPanel.vue` / `LayerControlPanel.vue` | `GCSPanel.vue` |
| Vue 通用组件 | `PascalCase.vue` | `NavButton.vue` / `ErrorPopup.vue` | `nav-button.vue` |
| TS/JS 模块 | `camelCase.ts` | `useMapRenderer.ts` / `useGCS.ts` | `UseMapRenderer.ts` |
| Store | `camelCase + Store/State.ts` | `floodState.ts` / `siteSelectionState.ts` | `useFloodStore.ts` |
| 类型定义 | `camelCase.ts`（在 `types/` 下） | `renderer.ts` / `xiaoqu.ts` | `IRenderer.ts` / `types.ts` |
| 测试文件 | `原文件名.test.ts` | `map.test.ts` / `useApiRequest.test.ts` | `map-spec.ts` |

### 2.3 Barrel 导出原则

**不要**大量使用 `index.ts` barrel 导出。

```
✅ 唯一例外：types/index.ts（类型目录以 barrel 为统一入口是合理的）

❌ stores/index.ts     → import { useMapStore } from '@/stores'（多余的抽象层）
❌ shared/index.ts     → 同上
❌ components/index.ts → 同上
```

显式导入路径的好处：
1. IDE 可以精准跳转到具体文件
2. tree-shaking 不会因为 barrel 导出而失效
3. 新人读代码时能一眼看到文件来源

---

## 3. 命名规范

### 3.1 地理术语词汇表

| 场景 | 使用 | 弃用 | 理由 |
|------|------|------|------|
| 经纬度 | `lng`, `lat` | `lon`, `latitude` | GIS 行业惯例；lon 易与 London 缩写混淆 |
| 海拔高程 | `elevation` | `altitude`, `height` | elevation = 大地水准面高程；height = 相对高度 |
| 坐标数组 | `coordinates` | `points`, `path` | GeoJSON 规范术语 |
| 单个要素 | `feature` | `item`, `data` | GeoJSON Feature（geometry + properties） |
| 要素集合 | `featureCollection` | `list`, `array` | GeoJSON FeatureCollection |
| 投影坐标 | `projectedX`, `projectedY` | `x`, `y` | 必须与地理坐标 `lng/lat` 区分 |
| 缓冲区 | `bufferRadius` / `bufferDistance` | `range`, `distance` | buffer 是 GIS 专有空间操作 |
| 渲染器实例 | `olRenderer`, `csRenderer` | `map1`, `map2` | 一眼看出双引擎身份 |

> **历史字段归一化**：`types/crs.ts` 的 `normalizePoint` 函数显式接受 `lon`/`longitude`/`latitude` 等历史字段名并归一化为 `lng`/`lat`。这是应对历史数据源的务实设计，**不是**鼓励新代码使用历史字段。新代码必须用 `lng`/`lat`，只有读取历史数据文件时才通过 `normalizePoint` 归一化。

### 3.2 变量命名

```ts
// ✅ 正确
const portLngLat: [number, number] = [108.6, 21.9]
const bufferDistance = 3000  // 米
const featureCollection = turf.featureCollection([pointFeature])
const affectedFacilities: FloodFeature[] = []

// ❌ 错误
const portPosition = [108.6, 21.9]   // 是 lngLat 还是 projectedXY？
const range = 3000                    // 什么范围？
const features = [...]                // 可能是 Feature[] 或 FeatureCollection
const data = []                       // 太泛
```

### 3.3 函数命名

规则：`动词 + 地理对象 + 动作细节`

```ts
// ✅ 正确
function queryFacilitiesByPolygon(polygon: PolygonFeature): FacilityFeature[]
function flyToCoordinate(lng: number, lat: number, elevation?: number): void
function calculateBufferUnion(features: FeatureCollection): Polygon | MultiPolygon

// ❌ 错误
function getData()          // 什么 data？
function handleClick()      // 点击了什么？哪张地图？
function doAnalysis()       // 什么分析？
```

### 3.4 类型与接口

```ts
// ✅ 正确：无 I/T 前缀，业务语义优先
interface MapRenderer {
  readonly engine: 'ol' | 'cesium'
  addPointLayer(id: string, features: PointFeature[], options?: LayerOptions): void
  destroy(): void
}

interface SiteSelectionParams {
  selectedKeys: FacilityType[]
  typeSettings: Record<FacilityType, TypeConfig>
  weights?: Partial<Record<FactorType, number>>
}

// ❌ 错误
interface IMapRenderer {}    // 不要 I 前缀（Java 遗毒）
type TFeature = {}           // 不要 T 前缀
```

### 3.5 常量

```ts
// ✅ 正确：模块级常量 + 语义分组 + as const
export const CRS = {
  WGS84: 'EPSG:4326',
  WEB_MERCATOR: 'EPSG:3857',
  CGCS2000: 'EPSG:4490',
} as const

export const DEFAULT_BUFFER_RADIUS = 3000   // 米，选址默认缓冲半径
export const MAX_SELECTABLE_FACILITIES = 5

// ❌ 错误
const BUFFER = 3000        // 什么单位？什么语义？
const CRS_WGS84 = 4326     // 不是 EPSG 编码，容易混淆
```

---

## 4. 注释规范

### 4.1 不写的注释（代码自解释）

```ts
// ❌ 不要写这些 —— 代码本身已经在说
// 遍历设施数组
facilities.forEach(f => { ... })

// 设置地图中心
map.setCenter([lng, lat])

// 创建新图层
const layer = new VectorLayer({ ... })
```

### 4.2 要写的注释（地理背景 + 工程决策）

```ts
// ✅ 写"为什么选这个坐标系"
// 北部湾区域横跨 108°E，处于 UTM 49N 和 50N 交界带。
// 前端展示统一用 WGS84(EPSG:4326)，投影到 Web Mercator 由 OL/Cesium 内部处理。
const DISPLAY_CRS = 'EPSG:4326'

// ✅ 写"Turf.js 的已知坑"
// turf.union 在输入多边形存在共享边界时可能返回 MultiPolygon，
// 下游业务组件（SiteSelectionPage）只接受 Polygon，需做几何降级。
const merged = turf.union(featureA, featureB)
const normalized = merged.geometry.type === 'MultiPolygon'
  ? turf.convex(merged)            // 退而求其次用凸包
  : merged

// ✅ 写"性能决策"
// xiaoqu.json 约 1200 个要素，全量遍历在移动端会掉帧。
// 第一步：rbush BBox 过滤（O(log n)）→ 第二步：turf.distance 精确计算（O(m), m << n）
const candidates = spatialIndex.search(bbox)
const matched = candidates.filter(f => turf.distance(f, target) <= bufferRadius)

// ✅ 写"数据档位的设计意图"
// GCS 浸没分析使用"向上取档"策略：请求 2.5m 水位时实际返回 3.0m 档位数据。
// 这是故意为之 —— 宁可高估风险（多返回淹没区域），不可低估（遗漏潜在受灾设施）。
// 前端通过对比 requestedWaterLevel / actualWaterLevel 感知档位差异。
```

### 4.3 文件头注释（可选，但鼓励留个人印记）

```ts
/**
 * 选址分析评分引擎
 *
 * 北部湾港口区域设施分布稀疏，传统"最近距离"评分会过度惩罚边缘小区。
 * 本算法采用"可达性衰减函数"：距离 < bufferRadius 时线性衰减，> bufferRadius 时归零。
 *
 * @author 姜皓源
 * @since 2026-03
 */
```

> **注意**：不写 `@param` `@returns` 这类 JSDoc 重复代码的八股文。TypeScript 已经提供了参数类型，不需要再写一遍。

### 4.4 标记约定（已存在，保持不变）

```
FIX: <编号或描述>      // Bug，需要修
TODO: <描述>           // 计划中的功能
@arch-note <描述>      // 架构层面的设计意图说明
```

---

## 5. Vue 组件规范

### 5.1 单文件组件结构

```vue
<script setup lang="ts">
// 1. 类型导入（import type）
import type { MapRenderer, PointFeature } from '@/types'

// 2. 组件导入
import GcsPanel from '@/core/layout/components/GcsPanel.vue'

// 3. 组合式函数
import { useMapStore } from '@/stores/map'
const mapStore = useMapStore()

// 4. Props / Emits 定义
interface Props { title: string; visible?: boolean }
const props = withDefaults(defineProps<Props>(), { visible: false })
const emit = defineEmits<{ close: []; confirm: [result: AnalysisResult] }>()

// 5. 响应式数据（ref → computed → 方法 → 生命周期）
const selectedFeature = ref<Feature | null>(null)

function handleSelect(feature: Feature) { ... }

onMounted(() => { ... })
onUnmounted(() => { ... })
</script>

<template>
  <!-- 语义化 HTML + GCS 组件 -->
  <GcsPanel :w="4" :h="6" anchor="top-left">
    <div class="panel-content">
      <h3 class="panel-title">{{ title }}</h3>
    </div>
  </GcsPanel>
</template>

<style scoped>
.panel-title {
  color: var(--gcs-text-primary);
  font-size: 16px;
}
</style>
```

### 5.2 Props / Emits

```ts
// ✅ 用 withDefaults + 泛型 + 元组坐标
interface Props {
  title: string
  visible?: boolean
  initialLngLat?: [number, number]  // [lng, lat]，元组比对象更紧凑
}

const props = withDefaults(defineProps<Props>(), {
  visible: false,
  initialLngLat: () => [108.6, 21.9],  // 钦州市中心
})

const emit = defineEmits<{
  close: []
  confirm: [result: AnalysisResult]
}>()

// ❌ 禁止
// const { title } = defineProps<...>()   // 解构会丢失响应性
// const emit = defineEmits(['close'])    // 无类型
```

### 5.3 模板规则

```vue
<!-- ✅ 正确 -->
<GcsPanel :w="4" :h="4" anchor="top-left" :offset-x="0" :offset-y="1.25">
  <PanelTitle :text="title" />
  <div class="content">...</div>
</GcsPanel>

<!-- ❌ 禁止 -->
<!-- v-for 和 v-if 不要同级 -->
<!-- 不要 $refs（用模板 ref） -->
```

### 5.4 样式规则

- 全部使用 `var(--gcs-xxx)` 引用全局 CSS 变量，禁止硬编码色值
- GCS 尺寸通过 `useGCS()` 的 `v-bind()` 动态计算
- `pointer-events: none` 在页面根元素 → `:deep(.gcs-panel) { pointer-events: auto }` 恢复面板交互
- 详见 `docs/GCS工程规范.md` §1

---

## 6. 后端规范（Express / NestJS）

### 6.1 三层严格分离

```
routes/       — 只做路由注册和中间件挂载，不写逻辑
controllers/  — 只做请求解析 + 响应组装
services/     — 写业务逻辑（选址评分 / 空间计算 / 水文模型）
```

```js
// ✅ routes/siteAnalysis.js
router.post('/site-analysis', authenticate, siteAnalysisController.analyze)

// ✅ controllers/siteAnalysisController.js
export const analyze = async (req, res, next) => {
  try {
    const { selectedKeys, typeSettings, weights } = req.body
    const result = await siteAnalysisService.calculate(selectedKeys, typeSettings, weights)
    res.status(200).json(result)
  } catch (err) {
    next(err)  // 统一错误处理中间件
  }
}

// ✅ services/siteAnalysisService.js
export const calculate = async (selectedKeys, typeSettings, weights) => {
  // 选址评分核心算法 —— 写在这里
}
```

### 6.2 错误处理：统一错误码

不要直接 `throw new Error('xxx')`，用业务错误类：

```js
const ErrorCode = {
  INVALID_PARAMS:  { code: 400001, status: 400, message: '参数验证失败' },
  UNAUTHORIZED:     { code: 401001, status: 401, message: '认证令牌无效或已过期' },
  FORBIDDEN:        { code: 403001, status: 403, message: '无权访问此资源' },
  NOT_FOUND:        { code: 404001, status: 404, message: '资源不存在' },
  ANALYSIS_FAILED:  { code: 422001, status: 422, message: '分析计算失败' },
}

class BusinessError extends Error {
  constructor(errorCode, detail = '') {
    super(detail || errorCode.message)
    this.code = errorCode.code
    this.status = errorCode.status
  }
}

// 使用
throw new BusinessError(ErrorCode.ANALYSIS_FAILED, 'turf.union 返回类型不一致')
```

### 6.3 NestJS 迁移注意

如果后续用 NestJS 替代 Express，保持三层分离：

```
Express          →  NestJS
routes/          →  @Controller 装饰器
controllers/     →  Controller 类中的方法
services/        →  @Injectable() Provider
middleware/      →  Guard / Interceptor / Pipe
```

---

## 7. Git 提交规范

### 7.1 格式

```
<type>(<scope>): <subject>

<body>  — 写"为什么改"和"影响范围"
```

### 7.2 Type 定义

| Type | 使用场景 | 示例 |
|------|---------|------|
| `feat` | 新增业务功能 | `feat(flood): 新增港口浸没分析水位滑块交互` |
| `fix` | 修复 bug | `fix(auth): 修复 JWT 硬编码密钥泄露` |
| `refactor` | 重构，不新增功能 | `refactor(store): stores/map.ts 重命名为 mapStore.ts 符合命名规范` |
| `perf` | 性能优化 | `perf(ol): 矢量图层添加 rbush 空间索引` |
| `docs` | 文档 | `docs(api): 补充选址分析接口契约` |
| `style` | 纯格式调整 | `style: 统一 ESLint + Prettier 配置` |
| `chore` | 工程化杂项 | `chore(ci): 添加 GitHub Actions 构建流水线` |

### 7.3 Scope 定义

| Scope | 含义 | 涉及目录 |
|-------|------|---------|
| `core` | 引擎层 | `src/core/map/` | `src/core/layout/` |
| `business` | 业务模块 | `src/business/` |
| `store` | Pinia 状态管理 | `src/stores/` |
| `api` | 后端接口 | `server/` |
| `gis` | 空间分析 / Turf.js / 坐标系 | `src/core/map/` + `src/services/` |
| `deps` | 依赖升级 | `package.json` |

### 7.4 示例

```
feat(site-selection): 选址分析支持多设施权重自定义

之前权重硬编码在 scoringService 中，无法适配不同港口区域。
现在将 weights 暴露为接口参数，前端通过滑块实时调整。

影响范围：SiteSelectionPage / useSiteSelectionStore / siteAnalysisService


fix(gis): 修复 queryByPolygon 仅用 BBox 导致凹多边形误匹配

北部湾区域海岸线曲折，小区边界多为凹多边形。
原实现仅用 rbush BBox 查询，外接矩形内非多边形区域的设施被错误返回。
现增加 turf.booleanPointInPolygon 二次精确过滤。

Closes #5
```

---

## 8. 工具配置

### 8.1 VS Code（`.vscode/settings.json`，提交到仓库）

```json
{
  "editor.formatOnSave": true,
  "editor.defaultFormatter": "esbenp.prettier-vscode",
  "editor.codeActionsOnSave": {
    "source.fixAll.eslint": "explicit"
  },
  "typescript.preferences.importModuleSpecifier": "relative",
  "eslint.validate": ["javascript", "typescript", "vue"],
  "files.associations": {
    "*.env.*": "dotenv"
  }
}
```

### 8.2 package.json scripts

```json
{
  "scripts": {
    "dev": "vite",
    "build": "vite build",
    "preview": "vite preview",
    "lint": "eslint . --cache",
    "lint:fix": "eslint . --fix --cache",
    "format": "prettier --write .",
    "format:check": "prettier --check .",
    "test": "vitest run",
    "test:watch": "vitest",
    "typecheck": "vue-tsc --noEmit",
    "build:analyze": "vite build --mode analyze"
  }
}
```

### 8.3 CI 流水线（`.github/workflows/ci.yml`）

```yaml
name: CI
on: [push, pull_request]
jobs:
  check:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 22 }
      - run: npm ci
      - run: npm run format:check
      - run: npm run lint
      - run: npm run typecheck
      - run: npm run build
      - run: npm run test
```

---

## 9. 自检表

提交代码前，问自己这 5 个问题：

| # | 检查项 | 标准 | 反例 |
|---|--------|------|------|
| 1 | 坐标变量叫什么？ | `lng` / `lat` / `elevation` | `lon` / `latitude` / `height` |
| 2 | 空间对象叫什么？ | `feature` / `featureCollection` / `geometry` | `item` / `list` / `shape` |
| 3 | 注释写了什么？ | "为什么这样设计" + "地理/业务背景" | "做什么" / "遍历数组" |
| 4 | 渲染器怎么命名？ | `OLRenderer` / `CesiumRenderer` / `BaseRenderer` | `map1` / `map2` / `map3D` |
| 5 | Git 提交信息？ | `type(scope): 做什么 + 为什么`，带地理语义 | `fix bug` / `update code` |

---

## 10. 渐进式迁移计划

不要试图一次性改完整个项目。按文件类型分批：

| 批次 | 文件 | 动作 | 状态 | 预估 |
|:----:|------|------|:----:|:----:|
| 1 | `src/types/*.ts` | 统一类型命名（去 I/T 前缀），补充地理注释 | ✅ 已完成 | 30min |
| 2 | `src/core/map/renderers/*.ts` | 统一方法签名中的坐标参数名为 `lngLat` | ⏳ 待迁移（.js → .ts） | 30min |
| 3 | `src/stores/*.ts` | 统一 Setup Store 风格，消灭 `any` | ✅ 已完成 | 20min |
| 4 | `server/services/*.js` | 引入 BusinessError 统一错误码 | ✅ 已完成 | 30min |
| 5 | 全部 `.vue` 文件 | Props 从对象语法迁移到泛型语法 | ✅ 已完成 | 1h |

每一批一个 `style` 或 `refactor` 类型的 commit，方便回滚。

---

> **自述**：这不是从网上抄的规范模板。里面的每一行都和北部湾项目对齐 —— 你可以打开项目里的任意文件，对照着看这条规范是否已经在用、是否应该用。
