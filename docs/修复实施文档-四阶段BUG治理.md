# 北部湾智慧港口平台 — 四阶段 BUG 修复实施文档

> **日期**: 2026-07-23
> **依据**: 《项目问题汇总.md》全量 71 项问题，已对代码逐项验证
> **实施者**: DeepSeek V4 Pro（分阶段实施）
> **目标**: 修复全部属实 BUG，使项目达到《项目描述报告.md》所描述的预设形态

---

## 第 0 章 实施者必读

### 0.1 本文档的性质

本文档是**唯一实施依据**，自包含全部修复所需的文件路径、行号、现状代码（Before）与目标代码（After）。实施时**不需要**再阅读 `docs/` 下其他文档。

### 0.2 验证结论摘要

对《项目问题汇总.md》标记为"待修复"的 61 项逐项读取代码验证后：

| 验证结论 | 数量 | 说明 |
|---|---|---|
| 属实，需修复 | 53 | 按本文档四阶段执行 |
| 部分属实，需修复 | 5 | P1-03、P1-13、P1-14、P2-07、P3-07，修复范围以本文档为准 |
| 文档标记有误，实际已修复/已不存在 | 3 | P2-05、E-01、E-02，**从清单移除，不要重复修** |
| 文档标记"已修复"但实际未修复 | 2 | **P1-01（收藏弹窗）、P2-03（floodRiskLevel）需重新列入修复** |

### 0.3 文档状态纠正表（重要）

| 编号 | 汇总文档标记 | 代码实际状态 | 处理 |
|---|---|---|---|
| P1-01 | ✅ 已修复 | ❌ 未修复（PaginatedListPanel.vue:370-374 仍未传 `:visible`） | 列入阶段二 |
| P2-03 | ✅ 已修复 | ⚠️ 部分修复（ProfilePage.vue:127-134 加载路径仍漏 `floodRiskLevel`） | 列入阶段二 |
| P2-05 | ❌ 待修复 | ✅ 已修复（useAuth.ts:105-120,176-189 已有 storage 监听） | 移除 |
| E-01 | ❌ 待修复 | ✅ 已不存在（setTimeout(1500) 硬等已被 watch 响应式注册取代） | 移除 |
| E-02 | ❌ 待确认 | ✅ 已修复（FloodAnalysisPage.vue:271,306 已有 ElMessage.error） | 移除 |

### 0.4 铁律

1. **严格按任务卡执行**，每个任务卡给出精确的文件、位置与目标代码，不要自由发挥。
2. **不修复本文档未列出的问题**，不顺手重构、不"优化"无关代码。
3. **每完成一个任务卡**，运行该卡片的"验收"项；**每完成一个阶段**，运行该阶段末的"阶段验收清单"并全部通过后才能进入下一阶段。
4. 修改代码风格必须与所在文件现有风格一致：**无分号、单引号、2 空格缩进、ESM（`import/export`）**。
5. 前端现有修复惯例：修复点上方加一行注释标注编号（如 `// P0-002-FIX: ...`、`// AUDIT-313-003: ...`）。本文档所有修复沿用该惯例，注释前缀统一为 `// BUGFIX-<原编号>: <一句话说明>`。
6. 行号是验证时的快照（2026-07-23），实施时以**代码内容锚点**为准，行号仅作导航参考。

---

## 第 1 章 验证结论总表（61 项全量）

### 1.1 P0 阻断级

| 编号 | 问题 | 验证判定 | 阶段 |
|---|---|---|---|
| P0-01 | useChartBase 快照 bug | ✅ 确已修复（useChartBase.js:15-49 函数式现取 + watch 触发） | — |
| P0-02 | /api/markers 越权三处 | ❌ **属实** | 阶段一 |

### 1.2 P1 功能缺陷

| 编号 | 问题 | 验证判定 | 阶段 |
|---|---|---|---|
| P1-01 | 收藏弹窗缺 `:visible` | ❌ **未修复，文档标记有误** | 阶段二 |
| P1-02 | createPlan/updatePlan 缺 await | ❌ 属实（usePlans.ts:47,80） | 阶段二 |
| P1-03 | flood 方案重命名 TypeError | ⚠️ 部分属实（潜在缺陷，当前 flood 保存路径未接线故不可复现；按防御性修复处理） | 阶段二 |
| P1-04 | 重命名弹窗用错变量 | ❌ 属实（ProfilePage.vue:322 用 `editingPlan` 应为 `editingNamePlan`） | 阶段二 |
| P1-05 | 选址状态恢复丢 selectedTypes + facilityPoi 未保存 | ❌ 属实（SiteSelectionPage.vue:200-211,236-240 + handleResult:92-93 覆盖） | 阶段二 |
| P1-06 | 注册 TOCTOU 竞态 | ❌ 属实（authController.js:22-27 锁外查重） | 阶段一 |
| P1-07 | 标记字段 note/description 分裂 | ❌ 属实（markersController.js:31 存 note vs markersRepository.js:62 白名单 description） | 阶段一 |
| P1-08 | 选址参数错误返回 500 | ❌ 属实（siteAnalysisService.js:22-28 throw → 统一 catch → 500） | 阶段一 |
| P1-09 | 选址业务错误以 200 返回 `{error}` | ❌ 属实（siteAnalysisController.js:43 无条件 res.json） | 阶段一 |
| P1-10 | Cesium flyTo duration=1000（秒） | ❌ 属实（CesiumRenderer.js:601） | 阶段三 |
| P1-11 | addGeoJsonLayer 忽略 markerColor/markerSize | ❌ 属实（CesiumRenderer.js:527-538 只处理 polygon；OLRenderer 同样不支持点样式） | 阶段三 |
| P1-12 | camera.changed 监听器泄漏 | ❌ 属实（CesiumRenderer.js:302 添加，两处 destroy 均未移除） | 阶段三 |
| P1-13 | 已登录分支无退出按钮 | ⚠️ 部分属实（LoginPanel.vue:185-191 确实没有，handleLogout 与 .logout-btn 样式成死代码；但 ProfilePage.vue:311 有登出按钮，"全站无登出途径"不成立） | 阶段二 |
| P1-14 | escapePassword 转义后哈希 | ⚠️ 部分属实（转义行为属实，但注册/登录同样转义故当前自洽可登录；风险是与不转义客户端/未来迁移不兼容，按本文档方案修复） | 阶段一 |

### 1.3 P2 边界与时序

| 编号 | 问题 | 验证判定 | 阶段 |
|---|---|---|---|
| P2-01 | 浸没分析 CSS 类名不匹配 | ❌ 属实（模板 :469 `gcs-analysis-page` vs 样式 :502/519/548 `.flood-analysis-page`，pointer-events 穿透与 backdrop-filter 修复全部失效） | 阶段三 |
| P2-02 | 水位滑块请求乱序覆盖 | ❌ 属实（FloodAnalysisPage.vue:222-309 无序号/取消机制） | 阶段三 |
| P2-03 | floodRiskLevel 被 undefined 覆盖 | ⚠️ **文档标记"已修复"不准确**：保存路径已带（FloodAnalysisPage.vue:176），但 ProfilePage.vue:127-134 加载路径仍漏传 → floodState.js:30 无条件覆盖 | 阶段二 |
| P2-04 | loadPlans 首次双触发 | ❌ 属实（ProfilePage.vue:187-199 watch immediate + :201-205 onMounted 各触发一次） | 阶段二 |
| P2-05 | 多标签页登录态不同步 | ✅ 已修复，移除 | — |
| P2-06 | 登出不清理 Pinia 业务状态 | ❌ 属实（useAuth.ts:156-173 logout 未触碰任何业务 store） | 阶段二 |
| P2-07 | 淹没范围取档语义不透明 | ⚠️ 部分属实（`find(zone => zone.waterLevel >= level)` 为向上取档；getFloodAreas 已回传实际档位，但 analyzeDisaster 返回请求值水位 + 实际档位风险等级，错配无感知） | 阶段三 |
| P2-08 | 权重未校验 | ❌ 属实（scoringService.js:36 `?? 1`，控制器只校验 importance 不校验 weights） | 阶段一 |
| P2-09 | Date.now() ID 碰撞 | ❌ 属实（plansRepository.js:56、markersRepository.js:52；userService.js:44 已用 randomUUID 未对齐） | 阶段一 |
| P2-10 | 缓存脏写 | ❌ 属实（readAll 返回 cache 引用，create/update/saveXiaoqu 在 writeAll 前原地修改共享缓存） | 阶段一 |
| P2-11 | /api/gcs 无认证 | ❌ 属实（routes/gcs.js 全文无 authenticate，其余业务路由均有） | 阶段一 |

### 1.4 P3 技术债务

| 编号 | 问题 | 验证判定 | 阶段 |
|---|---|---|---|
| P3-01 | lon/lng 双轨制 | ❌ 属实（ports.json 用 lon，相机目标用 lng，UnifiedMap.vue:249-253 靠补丁转换） | 阶段四 |
| P3-02 | 水面多边形硬编码 | ❌ 属实（FloodAnalysisPage.vue:78-86 WATER_AREA_COORDINATES） | 阶段三 |
| P3-03 | 选址错误弹窗死代码 | ❌ 属实（SiteSelectionPage.vue:66-68 声明后无任何赋值） | 阶段二 |
| P3-04 | tryZoom 递归 setTimeout 未清理 | ❌ 属实（SiteSelectionPage.vue:281-289） | 阶段三 |
| P3-05 | useGCS 非单例 | ❌ 属实（16 个组件调用 = 16 套独立状态 + 16 个 resize 监听） | 阶段四 |
| P3-06 | mapDataService 无去重无过期 | ❌ 属实（mapDataService.js:3-18） | 阶段四 |
| P3-07 | 天地图 KEY 硬编码 | ⚠️ 部分属实（已支持 `VITE_TIANDITU_KEY` 环境变量，但硬编码兜底 KEY 仍入库，map.js:2） | 阶段四 |
| P3-08 | Math.min(...展开) 栈溢出风险 | ❌ 属实（scoringService.js:15-19） | 阶段四 |
| P3-09 | facilities 缓存永不过期 | ❌ 属实（facilitiesRepository.js:18-29，invalidateCache 无任何调用点） | 阶段四 |
| P3-10 | importance 静默取 1 | ❌ 属实（importanceMapping.js:9） | 阶段四 |
| P3-11 | 生产 console 调试输出 | ❌ 属实（src/ 下 25+ 处无 DEV 守卫） | 阶段四 |
| P3-12 | 路由守卫死代码 | ❌ 属实（router/index.js:43-56 无路由声明 requiresAuth） | 阶段四 |
| P3-13 | CesiumRenderer destroy 重复定义 | ❌ 属实（:332 与 :898 两处，:898 覆盖 :332） | 阶段三 |
| P3-14 | PlanSaveModal emit('error') 未声明 | ❌ 属实（PlanSaveModal.vue:10 vs :30） | 阶段二 |
| P3-15 | formatLoss 无 undefined 防御 | ❌ 属实（AffectedFacilityListPanel.vue:36-41） | 阶段三 |

### 1.5 架构问题 / 重构遗留 / 运行态

| 编号 | 问题 | 验证判定 | 阶段 |
|---|---|---|---|
| A-01 / A-02 | Core 依赖 Business / 渲染器接口不完整 | ✅ 确已修复 | — |
| A-03 | AppLayout 直接 import 图表 | ❌ 属实（AppLayout.vue:30-32） | 阶段四 |
| A-04 | UnifiedMap 职责过重 | ❌ 属实（546 行，≥7 项职责） | 阶段四 |
| A-05 | 不支持同页多引擎 | ❌ 属实，但属能力缺口而非 bug | 不修复（见第 7 章） |
| A-06 | API 调用三方式并存 | ❌ 属实（裸 fetch / useApiRequest / mapDataService 自包装） | 阶段四 |
| A-07 | visualization 反向依赖 business | ❌ 属实（useRadarChart.js:19 导入 facilityConfig） | 阶段四 |
| R-01 | 文件缓存+锁基础设施 ×3 份重复 | ❌ 属实（markers/plansRepository 逐字相同，userService 第三份无缓存版） | 阶段四 |
| R-02 | floodAnalysisController 响应格式分裂 | ❌ 属实（6 端点 `{code,data,message}` vs 其余控制器 `{error}`+状态码） | 阶段四 |
| R-03 | cookie 设置代码重复 | ❌ 属实（authController.js:31-36 vs 65-70 逐字重复） | 阶段一 |
| R-04 | 字号随 cell 浮动 | ❌ 属实（useGCS.js:201-206 为 0.2/0.175/0.15 cell） | 阶段四 |
| R-05 | map store 混合抽象层级 | ❌ 属实（stores/map.js:104-111 地图状态 + :117-118 UI 状态） | 阶段四 |
| E-01 / E-02 | 硬等 / 错误静默 | ✅ 已修复/已不存在，移除 | — |

---

## 第 2 章 全局实施约定

### 2.1 环境

- Node.js `^22.18.0 || >=24.12.0`；全局 `crypto.randomUUID()` 可用。
- 后端启动：`cd server && node --watch index.js`（端口 3000）
- 前端启动：`npm run dev`（Vite，默认 5173，代理 /api → 3000）
- 环境变量：`JWT_SECRET`（后端，`.env` 或默认值）、`VITE_API_BASE`、`VITE_TIANDITU_KEY`

### 2.2 每阶段必须执行的验证命令

```bash
# 前端（项目根目录）
npm run lint        # eslint + oxlint，必须 0 error
npm run test        # vitest run，全部通过
npm run build       # 构建必须通过

# 后端（server/ 目录）
node --check app.js # 语法检查；有测试的目录跑对应测试
```

### 2.3 关键事实（实施前必须知道）

1. **前端 src/ 下无任何 `/markers` API 调用**（已全量 Grep 确认）。标记功能只有后端 API，前端尚未接线。**P0-02 修复无前端回归风险**。
2. `server/middleware/auth.js` 的 `authenticate` 为**命名导出**：`import { authenticate } from '../middleware/auth.js'`。挂载两式：逐路由 `router.post('/', authenticate, handler)` 或整组 `router.use(authenticate)`（plans.js:7 用的后者）。
3. `authenticate` 成功后 `req.user = { id, username }`；无 token 或无效返回 `401 { error }`。
4. `server/data/users.json` 现有 11 个账号，全部注册于 escapePassword 存在期间（开发期测试数据）。
5. 后端响应格式两派并存：主流 `{ error }` + HTTP 状态码（auth/markers/plans/facilities/siteAnalysis），仅 `floodAnalysisController` 6 端点用 `{ code, data, message }` + 恒 200。**本文档决策：阶段四统一为 `{ error }` + 状态码**。
6. 前端 `useApiRequest` 对非 2xx 会抛 `ApiError`，对 401 抛 `ApiError(UNAUTHORIZED)`。
7. 页面根元素样式约定：业务页根 div `pointer-events: none`，面板经 `:deep(.gcs-panel)` 恢复 `auto`（P2-01 修复的正确性依赖此约定）。

---

## 第 3 章 阶段一：安全与数据契约（后端为主）

> **目标**: 堵住唯一 P0 越权漏洞，修复认证与数据层正确性问题，统一选址 API 错误契约。
> **包含**: P0-02、P1-06、P1-07、P1-08、P1-09、P1-14、P2-08、P2-09、P2-10、P2-11、R-03（共 11 项）
> **预计工作量**: 1 ~ 1.5 天
> **前置**: 无，可从干净工作区直接开始。

### 任务 S1-01【P0-02】/api/markers 越权三件套

**问题**: ① GET 匿名全量返回所有用户标记；② PUT/DELETE 只校验登录不校验归属；③ 更新白名单含 `userId` 可篡改归属；且 `createOne` 从不写入 `userId`，归属从未被记录。

**修复（3 个文件）**:

**1. `server/routes/markers.js`** — 整组加认证，删除匿名注释：

```js
// Before
// GET 接口允许匿名访问（只读数据）
router.get('/', markersController.getAll) // R - 读取列表
router.get('/:id', markersController.getOne) // R - 读取单个

// 写操作需要认证（AUDIT-SEC-005 修复）
router.post('/', authenticate, markersController.createOne) // C - 创建
router.put('/:id', authenticate, markersController.updateOne) // U - 更新
router.delete('/:id', authenticate, markersController.deleteOne) // D - 删除

// After
// BUGFIX-P0-02: 标记为个人数据，全部接口需登录
router.use(authenticate)

router.get('/', markersController.getAll) // R - 读取列表（按用户过滤）
router.get('/:id', markersController.getOne) // R - 读取单个
router.post('/', markersController.createOne) // C - 创建
router.put('/:id', markersController.updateOne) // U - 更新
router.delete('/:id', markersController.deleteOne) // D - 删除
```

**2. `server/controllers/markersController.js`** — getAll 按用户过滤、createOne 写入归属、updateOne/deleteOne 校验归属：

```js
export async function getAll(req, res) {
  try {
    // BUGFIX-P0-02: 只返回当前用户的标记
    const markers = await markersRepo.findByUserId(req.user.id)
    res.json(markers)
  } catch (error) {
    console.error('获取标注列表失败:', error)
    res.status(500).json({ error: '获取标注列表失败' })
  }
}
```

`createOne` 中 `markersRepo.create(...)` 调用改为：

```js
// BUGFIX-P0-02: 归属强制取自登录身份，不接受客户端传入
const newMarker = await markersRepo.create({ name, lng, lat, note: note || '', userId: req.user.id })
```

`updateOne` / `deleteOne` 在调用 repo 前加归属校验（两个函数各加一段，逻辑相同）：

```js
// BUGFIX-P0-02: 归属校验，非本人标记返回 403
const existing = await markersRepo.findById(req.params.id)
if (!existing) {
  return res.status(404).json({ error: '标注不存在' })
}
if (existing.userId !== req.user.id) {
  return res.status(403).json({ error: '无权操作他人标注' })
}
```

（updateOne 校验后继续走原有 `markersRepo.update(...)`；deleteOne 校验后继续走 `markersRepo.remove(...)`；二者原有的 404 分支保留作为并发兜底。）

**3. `server/repositories/markersRepository.js`** — 白名单移除 `userId`，新增 `findByUserId`：

```js
// Before
const MARKER_UPDATE_FIELDS = ['name', 'lng', 'lat', 'type', 'description', 'userId']

// After
// BUGFIX-P0-02: 白名单移除 userId，禁止篡改归属；description → note 见 BUGFIX-P1-07
const MARKER_UPDATE_FIELDS = ['name', 'lng', 'lat', 'type', 'note']
```

在 `findById` 后新增：

```js
// BUGFIX-P0-02: 按归属用户查询
export async function findByUserId(userId) {
  const markers = await readAll()
  return markers.filter((m) => m.userId === userId)
}
```

**验收**（curl 或 Postman，后端运行在 3000）:
- 无 token `GET /api/markers` → 401
- 用户 A token `PUT /api/markers/<用户B的标记id>` → 403
- 用户 A token `PUT /api/markers/<自己的id>` body 带 `{"userId":"<B的id>"}` → 200 但返回体 userId 仍为 A
- `GET /api/markers` 只返回自己的标记

---

### 任务 S1-02【P1-07】标记字段名统一为 note

**问题**: 创建时存 `note`（markersController.js:31），更新白名单却是 `description`（markersRepository.js:62），PUT 传 `note` 被静默丢弃、传 `description` 产生平行字段。

**修复**: 已在 S1-01 第 3 步将白名单改为 `'note'`（两个任务共用同一行）。再检查存量数据：

```bash
# 检查 server/data/markers.json 是否存在 description 字段
# 若存在，手工或写一次性脚本将其合并到 note 后删除 description 键
```

**验收**: 创建带 note 的标记 → PUT 更新 note → 返回体 note 为更新值，且无 description 键。

---

### 任务 S1-03【P1-06】注册 TOCTOU 竞态

**问题**: authController.js:22-27 先 `userExists` 再 `createUser` 分两步，并发同名注册可双双通过查重。`createUser` 的 `sequential` 锁内只 push 不查重。

**修复（2 个文件）**:

**1. `server/services/userService.js`** — 锁内查重：

```js
export async function createUser(username, hashedPassword) {
  return sequential(async () => {
    const users = await readAll()
    // BUGFIX-P1-06: 锁内查重，消除 TOCTOU 竞态
    if (users.some((u) => u.username === username)) {
      const err = new Error('用户名已存在')
      err.code = 'DUPLICATE_USERNAME'
      throw err
    }
    // AUDIT-SEC-012: 使用 crypto.randomUUID() 生成不可预测的用户ID
    const newUser = {
      id: crypto.randomUUID(),
      username,
      password: hashedPassword,
      createdAt: new Date().toISOString(),
    }
    users.push(newUser)
    await writeAll(users)
    return { id: newUser.id, username: newUser.username, createdAt: newUser.createdAt }
  })
}
```

**2. `server/controllers/authController.js`** — register 的 catch 识别冲突错误；前置 `userExists` 预检保留（快速路径，提升体验），锁内检查才是权威：

```js
} catch (error) {
  // BUGFIX-P1-06: 并发注册冲突返回 409
  if (error.code === 'DUPLICATE_USERNAME') {
    return res.status(409).json({ error: '用户名已存在' })
  }
  // AUDIT-016 (错误): 使用结构化日志替代 console
  if (process.env.NODE_ENV !== 'test') {
    console.error('注册失败:', error.message)
  }
  res.status(500).json({ error: '注册失败' })
}
```

**验收**: 并发发起 2 个同名注册请求（`Promise.all` 或两个终端同时 curl）→ 一个 201，一个 409；users.json 中无重复用户名。

---

### 任务 S1-04【R-03】cookie 设置代码提取

**问题**: authController.js:31-36 与 65-70 的 `res.cookie(...)` 逐字重复。

**修复**: `server/controllers/authController.js` 顶部（import 之后）新增私有函数，register/login 各替换为一次调用：

```js
// BUGFIX-R-03: 提取公共 cookie 设置，register/login 复用
function setAuthCookie(res, token) {
  // AUDIT-SEC-001: 使用 HttpOnly Cookie 存储 token
  res.cookie('auth_token', token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'strict',
    maxAge: 7 * 24 * 60 * 60 * 1000, // 7 天
  })
}
```

**验收**: 注册/登录响应头仍含 `Set-Cookie: auth_token=...; HttpOnly; SameSite=Strict`。

---

### 任务 S1-05【P1-14】移除 escapePassword + 历史账号兼容

**问题**: LoginPanel.vue:52-57 把密码中 `&<>"'` 转 HTML 实体后再发送。密码经 JSON + bcrypt 处理，HTML 转义无安全收益，反而静默改写密码。当前注册/登录同样转义故自洽，但必须向"不转义"的正态迁移，且不能锁死老账号。

**决策**: 前端删除转义；后端登录加**双通道比对 + 静默迁移**（老账号首次登录成功后用原始密码重哈希，之后即走正常通道）。users.json 为开发期数据，本方案保证 11 个存量账号无感迁移。

**修复（3 个文件）**:

**1. `src/shared/components/LoginPanel.vue`** — 删除 `escapePassword` 函数（52-57 行整段），`handleSubmit` 中：

```js
// Before
const escapedPassword = escapePassword(password.value)
if (mode.value === 'login') {
  await login(trimmedUsername, escapedPassword)
} else {
  await register(trimmedUsername, escapedPassword)
}

// After
// BUGFIX-P1-14: 密码不再 HTML 转义，原样传输（后端 bcrypt 处理，转义无安全收益）
if (mode.value === 'login') {
  await login(trimmedUsername, password.value)
} else {
  await register(trimmedUsername, password.value)
}
```

**2. `server/controllers/authController.js`** — login 双通道比对 + 静默迁移：

```js
// BUGFIX-P1-14: 历史转义密码兼容（与前端旧版 escapePassword 规则一致）
function escapeHtmlLegacy(str) {
  return str.replace(/[&<>"']/g, (char) => {
    const escapeMap = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }
    return escapeMap[char]
  })
}
```

login 中密码比对段（现 58-61 行）改为：

```js
let valid = await bcrypt.compare(password, user.password)
if (!valid) {
  // BUGFIX-P1-14: 旧版前端转义密码的存量账号回退通道
  const legacy = escapeHtmlLegacy(password)
  if (legacy !== password && (await bcrypt.compare(legacy, user.password))) {
    valid = true
    // 静默迁移：用原始密码重哈希，下次登录走正常通道
    const rehashed = await bcrypt.hash(password, 10)
    await userService.updatePassword(user.id, rehashed)
  }
}
if (!valid) {
  return res.status(401).json({ error: '用户名或密码错误' })
}
```

**3. `server/services/userService.js`** — 新增：

```js
// BUGFIX-P1-14: 支持登录成功后静默迁移密码哈希
export async function updatePassword(userId, hashedPassword) {
  return sequential(async () => {
    const users = await readAll()
    const target = users.find((u) => u.id === userId)
    if (!target) return false
    target.password = hashedPassword
    await writeAll(users)
    return true
  })
}
```

**验收**: ① 新注册密码 `Abc&12<>` 的账号可登录；② 手工用旧转义规则构造的账号（密码哈希对应转义后串）可登录，且登录后 users.json 中哈希变化、再次登录仍成功。

---

### 任务 S1-06【P2-09】ID 改为 crypto.randomUUID()

**问题**: plansRepository.js:56 与 markersRepository.js:52 用 `Date.now().toString()`，同毫秒并发碰撞；userService 已用 `crypto.randomUUID()` 未对齐。

**修复（2 个文件，各 1 行）**:

```js
// plansRepository.js:56 与 markersRepository.js:52
// Before
id: Date.now().toString(),
// After
// BUGFIX-P2-09: UUID 防并发碰撞，与 userService 对齐
id: crypto.randomUUID(),
```

**验收**: 连续创建两个方案/标记，id 为 UUID 格式（36 字符含连字符）且不重复；旧数字 id 数据读取不受影响（find 按字符串全等匹配，兼容）。

---

### 任务 S1-07【P2-10】修复缓存脏写

**问题**: `readAll()` 命中时返回 cache 数组**引用**；`create` 的 `push`、`update` 的 `plans[index] = ...`、`saveXiaoqu/removeXiaoqu` 的原地修改都在 `writeAll` 之前污染共享缓存——一旦 `fs.writeFile` 失败，缓存与磁盘永久不一致。

**修复**: `server/repositories/plansRepository.js` 与 `server/repositories/markersRepository.js` 所有写路径改为**先构造新数组、writeAll 成功后才替换缓存**（`writeAll` 内部 `cache = 入参` 的逻辑不变）：

```js
// create（两个 repo 同构）
const newPlan = { id: crypto.randomUUID(), ...planData, savedXiaoqu: [], createdAt: ..., updatedAt: ... }
// BUGFIX-P2-10: 不原地修改缓存数组，构造新数组，写盘失败时缓存不脏
const next = [...plans, newPlan]
await writeAll(next)
return newPlan

// update（两个 repo 同构）
const updated = { ...plans[index], ...safeUpdates, ... }
const next = plans.map((p, i) => (i === index ? updated : p))
await writeAll(next)
return updated

// saveXiaoqu（plansRepository）：
// 构造新 plan 对象 + 新 plans 数组，杜绝原地修改
const updatedPlan = { ...plan, savedXiaoqu: 新数组, updatedAt: new Date().toISOString() }
const next = plans.map((p) => (p.id === planId ? updatedPlan : p))
await writeAll(next)
return updatedPlan

// removeXiaoqu（plansRepository）：同上，filter 生成新 savedXiaoqu 后构造新 plan 与新 plans 数组
// remove（两个 repo 已是 filter 生成新数组，无需改）
```

注意 `saveXiaoqu` 中"更新已存在小区"与"新增小区"两个分支都要在**新数组**上完成。

**验收**: 正常 CRUD 回归通过；审查 diff 确认所有写路径不再出现对 `readAll()` 返回值的原地修改（无 `plans.push(`、`plans[index] =`、`plan.savedXiaoqu.push(` 直接作用于 readAll 结果）。

---

### 任务 S1-08【P2-11】/api/gcs 补齐认证

**问题**: routes/gcs.js 全文 6 端点（含 POST 灾害评估）无 `authenticate`，是唯一裸奔的业务路由。

**决策**: 全部需登录（与其余业务接口一致；预测分析未来的 forecast 路由也照此办理）。

**修复**: `server/routes/gcs.js` 在路由定义前加：

```js
// BUGFIX-P2-11: 与其他业务路由对齐，全部端点需登录
router.use(authenticate)
```

（确认文件已 import `{ authenticate }`，没有则补 `import { authenticate } from '../middleware/auth.js'`）

**验收**: 无 token `GET /api/gcs/water-level` → 401；登录后浸没分析页功能正常（前端已带 cookie/token）。

---

### 任务 S1-09【P1-08 + P1-09 + P2-08】选址分析 API 错误契约

**问题**: ① 半径非法（负数/NaN）时 service 直接 throw，落入统一 catch → 500（应为 400）；② 业务失败（未选设施/无重叠）以 HTTP 200 返回 `{ error }`；③ `weights` 无校验，负数权重可致除零、字符串/NaN 污染排序。

**修复（2 个文件）**:

**1. `server/services/siteAnalysisService.js`** — `resolveRadiusSettings` 抛错处（22-28 行）加错误码：

```js
// BUGFIX-P1-08: 参数错误带码抛出，控制器据码返 400
const err = new Error(`半径参数无效: ${radius}`)
err.code = 'INVALID_PARAMS'
throw err
```

**2. `server/controllers/siteAnalysisController.js`** — 在现有 importance 校验后、调用 service 前追加两段校验；结果返回前检查业务错误：

```js
// BUGFIX-P1-08: 半径校验（typeSettings 各项 radius 若提供必须为正数）
for (const [key, setting] of Object.entries(typeSettings)) {
  if (setting.radius !== undefined) {
    const radius = Number(setting.radius)
    if (isNaN(radius) || radius <= 0) {
      return res.status(400).json({ error: `设施类型 ${key} 的半径无效，应为正数` })
    }
  }
}

// BUGFIX-P2-08: 权重校验（若提供，逐项为 0~10 的有限数）
if (weights !== undefined) {
  if (typeof weights !== 'object' || weights === null || Array.isArray(weights)) {
    return res.status(400).json({ error: 'weights 应为对象' })
  }
  for (const [key, w] of Object.entries(weights)) {
    const weight = Number(w)
    if (isNaN(weight) || !isFinite(weight) || weight < 0 || weight > 10) {
      return res.status(400).json({ error: `权重 ${key} 无效，应为 0-10 之间的数字` })
    }
  }
}
```

service 调用与返回段（现 36-47 行）改为：

```js
const result = runSiteAnalysis({ selectedKeys, typeSettings, facilityData, xiaoquData, weights })
// BUGFIX-P1-09: 业务失败以 422 返回，不再用 200 携带错误体
if (result && result.error) {
  return res.status(422).json({ error: result.error })
}
res.json(result)
```

catch 中：

```js
} catch (error) {
  // BUGFIX-P1-08: 参数错误返回 400
  if (error.code === 'INVALID_PARAMS') {
    return res.status(400).json({ error: error.message })
  }
  console.error('选址分析失败:', error)
  res.status(500).json({ error: '选址分析计算失败' })
}
```

**验收**: typeSettings 某项 `radius:0` → 400；`weights:{hospital:-2}` → 400；`weights:{hospital:"abc"}` → 400；不选任何设施类型 → 422 且 body 为 `{ error }`；正常请求 → 200 且无 error 键。

---

### 阶段一验收清单

- [ ] `npm run lint` 0 error；`npm run test` 通过；`npm run build` 通过
- [ ] markers 五项越权验收（S1-01）全部通过
- [ ] 并发同名注册：一成功一 409，users.json 无重复
- [ ] 含 `&<>` 密码的新账号注册/登录正常；旧转义账号双通道登录 + 静默迁移成功
- [ ] 新建方案/标记 id 为 UUID
- [ ] 无 token 访问 `/api/gcs/*` 与 `/api/markers` → 401
- [ ] 选址分析 400/422/200 三类返回符合 S1-09 验收
- [ ] `git diff` 审查：无误改、无顺手重构、注释标注齐全

---

## 第 4 章 阶段二：前端用户功能修复

> **目标**: 修复用户可直接感知的功能缺陷（弹窗、重命名、状态恢复、登出）。
> **包含**: P1-01、P1-02、P1-03、P1-04、P1-05、P1-13、P2-03、P2-04、P2-06、P3-03、P3-14（共 11 项）
> **预计工作量**: 1 ~ 1.5 天
> **前置**: 阶段一完成（S2-07 依赖 S1-09 的 400/422 错误契约）。

### 任务 S2-01【P1-01】收藏登录弹窗补 :visible

**问题**: `src/shared/components/PaginatedListPanel.vue:370-374` 用 `v-if="showLoginPopup"` 挂载 ErrorPopup 但未传 `:visible`；ErrorPopup 内部以 `v-if="visible"`（默认 false）渲染遮罩，弹窗永不显示。汇总文档标记"已修复"，实际未修。

**修复**: PaginatedListPanel.vue 模板中：

```vue
<!-- Before -->
<ErrorPopup
  v-if="showLoginPopup"
  mode="login"
  @close="showLoginPopup = false"
/>

<!-- After -->
<!-- BUGFIX-P1-01: 补传 visible，弹窗才能渲染 -->
<ErrorPopup
  v-if="showLoginPopup"
  :visible="showLoginPopup"
  mode="login"
  @close="showLoginPopup = false"
/>
```

**验收**: 未登录状态下在选址分析页点击任意收藏按钮 → 弹出"去登录"弹窗；关闭后再次点击可再次弹出。

---

### 任务 S2-02【P1-02】createPlan/updatePlan 补 await

**问题**: `src/shared/composables/usePlans.ts:47,80` 为 `return apiRequest(...)` 无 `await`。async 函数中 `finally` 在 Promise settle 前同步执行，`saving/updating` 在请求发出后立即复位，防重复提交失效。

**修复**: 两处均改为：

```ts
// BUGFIX-P1-02: await 使 finally 等待请求完成后再复位，防重复提交生效
return await apiRequest<Plan>('/plans', { ... })
// :80 同理
return await apiRequest<Plan>(`/plans/${id}`, { ... })
```

**验收**: 保存方案时快速连点保存按钮 → 仅发出一次 POST /plans（DevTools Network 确认）。

---

### 任务 S2-03【P1-03】updatePlan 的 typeSettings 兼容

**问题**: usePlans.ts:77 `Object.entries(typeSettings)` 对 `undefined` 抛 TypeError。当前 flood 方案保存路径未接线故不可复现，但 ProfilePage.vue:155 直接透传 `editingNamePlan.value.typeSettings`，一旦 flood 方案（无此字段）进入重命名流程即崩。防御性修复。

**修复**: usePlans.ts 的 `createPlan` 与 `updatePlan` 开头统一兼容：

```ts
// BUGFIX-P1-03: flood 方案无 typeSettings，兼容为空对象避免 TypeError
const settings = typeSettings ?? {}
const selectedKeys = Object.entries(settings)
  .filter(([, v]) => v.selected)
  .map(([k]) => k)
// body 中 typeSettings 字段也改用 settings
```

**验收**: 对一个 `typeSettings` 为 undefined 的方案对象调用 updatePlan（可在控制台模拟）→ 正常发出请求不抛错。

---

### 任务 S2-04【P1-04】重命名弹窗初始名变量

**问题**: `src/views/ProfilePage.vue:322` 弹窗 `:initial-name="editingPlan?.name || ''"`。`editingPlan` 是 inject 的应用级 ref，仅"加载方案"时赋值；重命名流程设置的是 `editingNamePlan`（:142）。初始名恒为空或残留旧名。

**修复**: ProfilePage.vue:322 改为：

```vue
<!-- BUGFIX-P1-04: 重命名弹窗初始名应取 editingNamePlan -->
:initial-name="editingNamePlan?.name || ''"
```

**验收**: 对方案"测试ABC"点重命名 → 弹窗输入框预填"测试ABC"。

---

### 任务 S2-05【P2-04】loadPlans 首次双触发

**问题**: ProfilePage.vue:187-199 `watch(user, …, { immediate: true })` 在 setup 阶段即触发一次 `loadPlans()`；:201-205 `onMounted` 再触发一次。首次进入稳定双发 GET /plans。

**修复**: 删除 onMounted 块（:201-205 整段），watch immediate 已覆盖：

```ts
// BUGFIX-P2-04: 删除 onMounted 重复调用，watch immediate 已覆盖首次加载
// （删除整段 onMounted(() => { if (user.value) { loadPlans() } })）
```

**验收**: 已登录状态首次进入个人中心 → Network 中 GET /plans 仅一次。

---

### 任务 S2-06【P1-05】选址状态恢复丢 selectedTypes + facilityPoi

**问题**: `SiteSelectionPage.vue` 双重缺陷：① `saveCurrentState`（:200-211）未保存 `facilityPoi`；② `restoreState`（:236-240）调用 `handleResult({ matchedXiaoqu })` 时未传 selectedTypes/facilityPoi，而 `handleResult` 的 :92-93 会用 `|| []`/`|| {}` 将刚恢复的值打回空。

**修复（2 个文件）**:

**1. `SiteSelectionPage.vue`**:

```ts
// saveCurrentState 的 saveState 载荷加一行：
stateStore.saveState({
  factorSettings,
  matchedXiaoqu: matchedXiaoqu.value,
  selectedTypes: selectedTypes.value,
  facilityPoi: facilityPoi.value, // BUGFIX-P1-05: 补保存设施POI
  currentPlanId: currentPlanId.value,
  savedXiaoquIds,
})

// restoreState 中恢复段加一行，且 handleResult 传全量：
facilityPoi.value = (savedState as any).facilityPoi || {} // BUGFIX-P1-05

// BUGFIX-P1-05: 传全量字段，避免 handleResult 用空值覆盖已恢复状态
handleResult({
  matchedXiaoqu: matchedXiaoqu.value,
  selectedTypes: selectedTypes.value,
  facilityPoi: facilityPoi.value,
})
```

**2. `src/stores/siteSelectionState.js`**: 确认 store 的 saveState/consumeState 字段列表包含 `facilityPoi`；不包含则补充（保存、恢复、clearState 三处）。

**验收**: 选址分析得出结果后 → 去个人中心 → 返回选址页 → 已选设施类型与设施 POI 图层均恢复，因子面板选中态正确。

---

### 任务 S2-07【P3-03】选址错误弹窗接线启用

**问题**: SiteSelectionPage.vue:66-68 `showErrorPopup`/`errorMessage` 声明后无任何赋值，模板中的 ErrorPopup 永不显示。阶段一 S1-09 已让后端返回 400/422，前端需要用户可见的错误出口。

**决策**: 接线启用（而非删除）。在选址分析请求失败的 catch 中赋值。

**修复**: `SiteSelectionPage.vue`（或其分析 API 调用处，实施时定位为 `useSiteAnalysisApi.ts` 的调用点）：

```ts
// BUGFIX-P3-03: 分析失败时启用错误弹窗（此前为死代码）
try {
  // ...原有分析请求
} catch (err: any) {
  errorMessage.value = err?.message || '选址分析失败，请稍后重试'
  showErrorPopup.value = true
}
```

并确认模板中 ErrorPopup 绑定 `:visible="showErrorPopup"` 与 `@close="showErrorPopup = false"`（与 S2-01 同模式）。

**验收**: 触发一次必然失败的分析（如全部设施不选，依赖 S1-09 的 422）→ 页面弹出错误提示而非静默。

---

### 任务 S2-08【P3-14】PlanSaveModal 补 error 事件声明

**问题**: `src/shared/components/PlanSaveModal.vue:10` `defineEmits(['close','save'])` 未声明 `error`，:30 名称校验失败时 `emit('error', …)` 静默丢失，点保存无反应。

**修复（2 个文件）**:

```js
// PlanSaveModal.vue:10
// BUGFIX-P3-14: 声明 error 事件，校验失败才能对外反馈
const emit = defineEmits(['close', 'save', 'error'])
```

```vue
<!-- ProfilePage.vue 模板 PlanSaveModal 标签加监听 -->
<!-- BUGFIX-P3-14: 接收校验错误并显示 -->
@error="(msg) => (saveError = msg)"
```

**验收**: 重命名时输入非法字符（如 `方案<>$`）点保存 → 弹窗内显示错误提示（走 errorMsg 通道）。

---

### 任务 S2-09【P1-13】LoginPanel 已登录分支补退出按钮

**问题**: LoginPanel.vue:185-191 已登录分支只有头像/用户名/状态；`handleLogout`（:119-125）与 `.logout-btn` 样式（:322-341）成死代码。ProfilePage.vue:311 虽有底部退出按钮，但组件本身不自洽。

**决策**: LoginPanel 补按钮（复用死代码），ProfilePage 底部按钮移除（避免同屏两个退出按钮；其清理逻辑已被 watch(user) 的 else 分支覆盖）。

**修复（2 个文件）**:

**1. LoginPanel.vue 已登录分支**：

```vue
<!-- 已登录状态：用户信息 -->
<template v-else>
  <div class="user-info-area">
    <div class="avatar-icon"></div>
    <div class="user-name">{{ user.username }}</div>
    <div class="user-status">已登录</div>
  </div>
  <!-- BUGFIX-P1-13: 复用已有 handleLogout 与 .logout-btn 样式，补登出途径 -->
  <button class="logout-btn" @click="handleLogout">退出登录</button>
</template>
```

**2. ProfilePage.vue**：删除 :311 的 `<button v-if="user" class="logout-btn" @click="handleLogout">退出登录</button>` 及其 scoped 样式中的 `.logout-btn` 块；`handleLogout` 函数保留与否均可（若无其他引用则一并删除，同时删除不再使用的 `logout` 解构——注意 `user` 仍在用）。

**验收**: 个人中心已登录状态 → LoginPanel 底部出现"退出登录"按钮，点击后回到未登录态、方案列表清空。

---

### 任务 S2-10【P2-06】登出清理 Pinia 业务状态

**问题**: useAuth.ts:156-173 `logout` 仅清 token/user/localStorage，不清业务 store——同标签页换账号登录会看到上一账号的分析现场。

**修复**: `src/shared/composables/useAuth.ts`：

```ts
// 顶部 import（实施时以各 store 实际导出名核对）
import { useSiteSelectionStateStore } from '@/stores/siteSelectionState'
import { useFloodStateStore } from '@/stores/floodState'
import { useFloodStore } from '@/stores/floodStore'
import { usePortImpactStore } from '@/stores/portImpactStore'
import { useWaterLevelStore } from '@/stores/waterLevelStore'

// BUGFIX-P2-06: 登出时重置全部业务 store，防止跨账号数据残留
function resetBusinessStores(): void {
  try {
    useSiteSelectionStateStore().clearState()
    useFloodStateStore().clearState()
    useFloodStore().$reset()
    usePortImpactStore().$reset()
    useWaterLevelStore().$reset()
  } catch {
    // store 未激活等异常不阻断登出
  }
}
```

在 `logout` 的 `finally` 末尾（`authRestored = false` 之后）调用 `resetBusinessStores()`；`handleStorageChange` 的登出分支（`event.newValue === null`）同样调用。

注意：各 store 重置方法名以实际为准（floodState/siteSelectionState 已确认为 `clearState()`；floodStore/portImpactStore/waterLevelStore 若无 `clearState` 则用 Pinia 内置 `$reset()`，但 setup 语法 store 需自定义 reset——实施时 Grep 确认，缺失则在对应 store 补一个 reset 方法）。

**验收**: 账号 A 登录做选址/浸没分析 → 登出 → 账号 B 登录 → 各页面无 A 的分析残留（小区列表、水位、受影响设施均为初始态）。

---

### 任务 S2-11【P2-03】floodRiskLevel 加载路径补全

**问题**: 保存路径已带 floodRiskLevel（FloodAnalysisPage.vue:176），但 ProfilePage.vue:127-134 `loadFloodPlan` 的 saveState 载荷漏传 → floodState.js:30 无条件赋值 `undefined` → 恢复后风险等级退化为默认。

**修复（3 个文件）**:

**1. `src/types/plan.ts`** Plan 接口追加：

```ts
/** 浸没方案风险等级（仅 flood 类型有值） */
floodRiskLevel?: string
```

**2. `src/views/ProfilePage.vue` loadFloodPlan**：

```ts
floodStateStore.saveState({
  waterLevel: plan.waterLevel || 0,
  floodStatistics: plan.floodStatistics,
  floodFeatures: plan.floodFeatures,
  floodRiskLevel: plan.floodRiskLevel, // BUGFIX-P2-03: 补传风险等级
  affectedFacilities: plan.affectedFacilities,
  totalLoss: plan.totalLoss,
})
```

**3. `src/stores/floodState.js:30`** 兜底：

```js
// BUGFIX-P2-03: 兼容缺省，避免 undefined 覆盖默认值
floodRiskLevel.value = data.floodRiskLevel ?? '无风险'
```

另查 `server/repositories/plansRepository.js` 的 `PLAN_UPDATE_FIELDS`（现 69 行）是否含 flood 系字段；不含则补充：

```js
// BUGFIX-P2-03: 白名单补 flood 系字段，浸没方案才能被更新保存
const PLAN_UPDATE_FIELDS = ['name', 'selectedKeys', 'typeSettings', 'weights', 'savedXiaoqu',
  'businessType', 'waterLevel', 'floodStatistics', 'floodFeatures', 'floodRiskLevel', 'affectedFacilities', 'totalLoss']
```

**验收**: 保存 flood 方案后从个人中心加载 → 风险等级与保存时一致，报告面板着色正确。

---

### 阶段二验收清单

- [ ] `npm run lint` 0 error；`npm run test` 通过；`npm run build` 通过
- [ ] 未登录点收藏 → 登录弹窗正常显示（S2-01）
- [ ] 保存/重命名防重复提交生效（S2-02）
- [ ] 重命名弹窗预填当前方案名（S2-04）
- [ ] 首次进入个人中心 GET /plans 仅一次（S2-05）
- [ ] 选址状态往返恢复完整（S2-06）；非法名称有弹窗反馈（S2-08）
- [ ] LoginPanel 退出按钮可用，全站仅一处登出入口（S2-09）
- [ ] 换账号登录无前任数据残留（S2-10）
- [ ] flood 方案加载后风险等级正确（S2-11）
- [ ] `git diff` 审查：无误改、注释标注齐全

---

## 第 5 章 阶段三：地图引擎与浸没分析

> **目标**: 修复 Cesium 渲染器三件套、浸没分析页时序与样式问题。
> **包含**: P1-10、P1-11、P1-12、P2-01、P2-02、P2-07、P3-02、P3-04、P3-13、P3-15（共 10 项）
> **预计工作量**: 1.5 ~ 2 天
> **前置**: 阶段一完成（浸没分析接口已需登录，前端调用点不要动响应格式——格式统一属阶段四 R-02）。

### 任务 S3-01【P1-10】Cesium flyTo duration 单位

**问题**: `src/core/map/renderers/CesiumRenderer.js:601` `duration: 1000`——Cesium 的 duration 单位是**秒**，1000 秒 ≈ 16.6 分钟飞行；OLRenderer 的 animate duration 是毫秒（1000ms 正确）。同文件 :697 `_setCameraState` 用 `duration: 3.0` 证明单位语义应为秒。

**修复**: CesiumRenderer.js:601：

```js
// BUGFIX-P1-10: Cesium duration 单位为秒（原 1000 秒 ≈ 16.6 分钟）
duration: 1,
```

**验收**: 3D 视图下点击城市按钮（钦州/北海/防城港）→ 飞行动画约 1 秒完成。

---

### 任务 S3-02【P1-11】addGeoJsonLayer 点要素样式（Cesium + OL）

**问题**: CesiumRenderer.js:527-538 只处理 `entity.polygon`，点要素被渲染为 GeoJsonDataSource 默认图钉，`markerColor/markerSize` 被忽略（FloodAnalysisPage.vue:388-392 的调用传了这两个选项）；OLRenderer 的 addGeoJsonLayer 同样未给点要素配 image 样式。

**修复（2 个文件）**:

**1. `src/core/map/renderers/CesiumRenderer.js`** entities 遍历内加 else 分支：

```js
dataSource.entities.values.forEach((entity) => {
  entity.properties.featureType = options.featureType || 'geojson'
  if (entity.polygon) {
    // ...原有 polygon 样式不变
  } else if (entity.position) {
    // BUGFIX-P1-11: 点要素用 PointGraphics 替代默认图钉，支持 markerColor/markerSize
    const markerColor = Color.fromCssColorString(options.markerColor || '#409eff')
    entity.billboard = undefined
    entity.point = new PointGraphics({
      pixelSize: options.markerSize || 10,
      color: markerColor,
      outlineColor: Color.WHITE,
      outlineWidth: 2,
    })
  }
})
```

（确认文件顶部从 cesium 导入 `PointGraphics`。）

**2. `src/core/map/renderers/OLRenderer.js`** addGeoJsonLayer 的样式函数中为 Point 几何补 Circle 样式（参照现有 `_createPolygonStyle` 模式，实施时读取该文件现状后添加）：

```js
// BUGFIX-P1-11: 点要素样式，支持 markerColor/markerSize
new Circle({
  radius: (options.markerSize || 10) / 2,
  fill: new Fill({ color: options.markerColor || '#409eff' }),
  stroke: new Stroke({ color: '#fff', width: 2 }),
})
```

**验收**: 浸没分析触发影响评估后，受影响设施点在 3D 下显示为红色圆点（#F56C6C、10px）而非默认图钉；切换 2D 后同样可见。

---

### 任务 S3-03【P1-12】camera.changed 监听器泄漏

**问题**: CesiumRenderer.js:302 `camera.changed.addEventListener(...)` 后从不移除。Viewer 是单例，每次进出 3D 路由新建 Renderer 就累加一个监听器；旧实例 destroy 后 `this.viewer = null`，残留回调中 `this.viewer.scene.requestRender()` 抛 TypeError。

**修复**: `_setupCameraDebounce` 保存回调引用；destroy 中移除：

```js
_setupCameraDebounce() {
  const DEBOUNCE_DELAY = 300
  // BUGFIX-P1-12: 保存监听器引用，供 destroy 移除，防止泄漏与 TypeError
  this._cameraChangedHandler = () => {
    if (this._cameraDebounceTimer) {
      clearTimeout(this._cameraDebounceTimer)
    }
    this._cameraDebounceTimer = setTimeout(() => {
      // BUGFIX-P1-12: viewer 可能已置空，防御
      if (this.viewer) {
        this.viewer.scene.requestRender()
      }
      this._cameraDebounceTimer = null
    }, DEBOUNCE_DELAY)
  }
  this.viewer.camera.changed.addEventListener(this._cameraChangedHandler)
}
```

destroy（898 行完整版）在 `this.viewer = null` 之前加：

```js
// BUGFIX-P1-12: 移除相机监听器
if (this.viewer && this._cameraChangedHandler) {
  this.viewer.camera.changed.removeEventListener(this._cameraChangedHandler)
  this._cameraChangedHandler = null
}
```

**验收**: 反复进出 3D 路由 5 次，控制台无 TypeError；`viewer.camera.changed` 监听器数量不累积（可在控制台 `viewer.camera.changed._listeners.length` 观察）。

---

### 任务 S3-04【P3-13】删除重复的 destroy 定义

**问题**: CesiumRenderer.js:332 与 :898 两处 `destroy()`，后者覆盖前者，:332 为死代码。

**修复**: 删除 :328-337 的 destroy（含其 docstring），保留 :894-911 完整版（S3-03 的移除逻辑加在完整版中）。

**验收**: `Grep "destroy()" CesiumRenderer.js` 仅剩 1 处定义；3D→2D→3D 切换正常。

---

### 任务 S3-05【P2-01】浸没分析 CSS 类名统一

**问题**: FloodAnalysisPage.vue:469 模板根元素 `class="gcs-analysis-page"`，样式 :502/:519/:548 全部写 `.flood-analysis-page`——pointer-events 穿透与 3D 下禁用 backdrop-filter 的样式全部失效。

**修复**: 改模板 1 处（样式 4 处不动）：

```vue
<!-- BUGFIX-P2-01: 类名与样式表统一为 flood-analysis-page -->
<div class="flood-analysis-page">
```

**验收**: 浸没分析页 Cesium 画布可正常拖拽缩放（事件穿透生效）；DevTools 检查面板 `backdrop-filter: none` 生效。

---

### 任务 S3-06【P2-02】水位滑块请求乱序防护

**问题**: FloodAnalysisPage.vue:222-238 防抖 watch + :244-309 两个 trigger 函数并发请求，无序号/取消机制——快速拖拽时旧水位响应可能后返回覆盖新数据。

**修复**: 模块级递增序号，响应写入 store 前校验：

```js
// BUGFIX-P2-02: 请求序号，仅最新一代响应允许写 store
let analysisSeq = 0

// watch 防抖回调中：
analysisTimer = setTimeout(() => {
  const seq = ++analysisSeq
  triggerFloodAnalysis(newLevel, seq)
  triggerImpactAssessment(newLevel, seq)
}, ANALYSIS_DELAY)

// triggerFloodAnalysis(waterLevel, seq)：Promise.all 之后、写 store 之前：
if (seq !== analysisSeq) return // BUGFIX-P2-02: 已有更新请求，丢弃过期响应

triggerImpactAssessment(waterLevel, seq)：同样校验。
```

（`registerGcsLayers` 内 :113-116 的补触发调用同样改为生成新 seq 传入。）

**验收**: 快速来回拖拽水位滑块 10 次 → 最终地图与统计展示的水位与滑块终值一致（无旧数据回跳）。

---

### 任务 S3-07【P2-07】淹没范围取档语义透明化

**问题**: floodAnalysisController 用 `find(zone => zone.waterLevel >= level)` 向上取档（请求 2.5m 返回 5m 数据）。`getFloodAreas` 已回传实际档位但字段同名易混淆；`analyzeDisaster` 返回请求值水位 + 实际档位风险等级，错配无感知。

**修复（2 个文件）**:

**1. `server/controllers/floodAnalysisController.js`**：

```js
// getFloodAreas 响应 data 中补充（保持 {code,data,message} 框架不动，阶段四才统一格式）：
// BUGFIX-P2-07: 显式区分请求水位与实际数据档位
{ code: 200, data: { ...floodZone, requestedWaterLevel: level, actualWaterLevel: floodZone.waterLevel }, message: 'success' }

// analyzeDisaster：waterLevel 返回实际档位，另补 requestedWaterLevel：
// BUGFIX-P2-07: 返回实际档位水位，消除请求值与实际档位的错配
waterLevel: floodZone.waterLevel,
requestedWaterLevel: level,
```

并将 :67 附近"找到最接近的水位区间"注释更正为"向上取档（返回 >= 请求水位的最低档位）"。

**2. `src/business/flood-analysis/FloodAnalysisPage.vue`**：triggerFloodAnalysis 中读取 `actualWaterLevel`，与请求水位不一致时：

```js
// BUGFIX-P2-07: 实际档位与请求不一致时提示，语义透明
if (floodAreasData.data.actualWaterLevel !== undefined && floodAreasData.data.actualWaterLevel !== waterLevel) {
  console.info(`[GCS] 请求水位 ${waterLevel}m，实际使用数据档位 ${floodAreasData.data.actualWaterLevel}m`)
}
```

（同法处理 triggerImpactAssessment。可选增强：在 floodStore 记录 actualWaterLevel 供报告面板显示"当前数据档位"，实施时若改动小则一并做。）

**验收**: 请求 2.5m 时接口返回体含 `requestedWaterLevel: 2.5, actualWaterLevel: 5`；前端控制台有档位提示。

---

### 任务 S3-08【P3-02】水面多边形坐标外置

**问题**: FloodAnalysisPage.vue:78-86 `WATER_AREA_COORDINATES` 硬编码 7 个钦州港坐标，注释自承"实际应该从 floodArea.json 加载"。

**决策**: 水面区域是静态地理数据，移至 `public/data/water-area.json` 运行时 fetch，硬编码降级为加载失败兜底。

**修复**:

**1. 新建 `public/data/water-area.json`**：

```json
{
  "id": "main-water-area",
  "name": "钦州港附近海域",
  "coordinates": [[108.615, 21.855], [108.62, 21.855], [108.622, 21.858], [108.621, 21.862], [108.618, 21.863], [108.614, 21.861], [108.615, 21.855]]
}
```

**2. FloodAnalysisPage.vue**：硬编码常量改名为 `FALLBACK_WATER_AREA_COORDINATES` 并标注兜底用途；`registerGcsLayers` 的水面注册回调改为异步加载：

```js
// BUGFIX-P3-02: 水面坐标从 public/data/water-area.json 加载，硬编码仅作兜底
async function loadWaterAreaCoordinates() {
  try {
    const res = await fetch('/data/water-area.json')
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const data = await res.json()
    return data.coordinates
  } catch {
    return FALLBACK_WATER_AREA_COORDINATES
  }
}
```

（注册回调中先 await 加载再调 `addWaterSurface`；注意 `registerToggleable` 回调签名若需同步，可在 `registerGcsLayers` 前先完成加载。）

**验收**: 删除/改名 public/data/water-area.json 后页面用兜底坐标仍正常；恢复文件后使用文件坐标。

---

### 任务 S3-09【P3-04】tryZoom 定时器清理

**问题**: SiteSelectionPage.vue:281-289 递归 `setTimeout(500)` 未存 timer id，unmount 时未清理。

**修复**:

```ts
// BUGFIX-P3-04: 保存定时器 id，卸载时清理悬挂定时器
let tryZoomTimer: ReturnType<typeof setTimeout> | null = null
const tryZoom = () => {
  if (mapInstance.value?.getRenderer?.()) {
    zoomToCity()
  } else if (retries < 10) {
    retries++
    tryZoomTimer = setTimeout(tryZoom, 500)
  }
}

// onUnmounted 中：
onUnmounted(() => {
  stopBreathing()
  if (tryZoomTimer) {
    clearTimeout(tryZoomTimer) // BUGFIX-P3-04
    tryZoomTimer = null
  }
})
```

**验收**: 进入选址页立即离开 → 控制台无卸载后的 zoomToCity 调用/报错。

---

### 任务 S3-10【P3-15】formatLoss 防御

**问题**: `AffectedFacilityListPanel.vue:36-41` `formatLoss` 对 `undefined` 调 `.toFixed()` 抛 TypeError。

**修复**:

```js
function formatLoss(loss) {
  // BUGFIX-P3-15: 非法输入防御
  const v = Number(loss)
  if (!isFinite(v)) return '—'
  if (v >= 10000) return `${(v / 10000).toFixed(1)}万`
  return v.toFixed(0)
}
```

**验收**: 受影响设施列表在 totalLoss/单项 loss 缺失时渲染为 `—` 而非白屏报错。

---

### 阶段三验收清单

- [ ] `npm run lint` 0 error；`npm run test` 通过；`npm run build` 通过
- [ ] 3D 城市飞行动画约 1 秒（S3-01）
- [ ] 3D/2D 受影响设施均为红色圆点（S3-02）
- [ ] 反复进出 3D 无 TypeError、监听器不累积（S3-03/S3-04）
- [ ] 浸没分析页画布可拖拽、面板 backdrop-filter 已禁用（S3-05）
- [ ] 快速拖拽水位滑块，终态展示与滑块一致（S3-06）
- [ ] 2.5m 请求返回 5m 档位且前端有提示（S3-07）
- [ ] 水面坐标外置加载 + 兜底正常（S3-08）
- [ ] `git diff` 审查：无误改、注释标注齐全

---

## 第 6 章 阶段四：技术债务与架构治理

> **目标**: 清偿 P3 技术债务与架构问题，使代码结构对齐《项目描述报告》的预设（布局继承、组件复用、引擎无关、分层依赖）。
> **包含**: P3-01~P3-12 中剩余 12 项、R-01、R-02、R-04、R-05、A-03、A-04、A-06、A-07（共 17 项）
> **预计工作量**: 2 ~ 3 天
> **前置**: 阶段一~三完成。S4-01 依赖 S1-07 的写路径修复成果；S4-02 依赖 S3-07 之后的 floodAnalysisController 现状。

### 任务 S4-01【R-01】提取 createFileStore 工厂

**问题**: markersRepository.js:7-40 与 plansRepository.js:7-40 的 `cache + writeLock + sequential + readAll + writeAll`（约 18 行）逐字重复；userService.js:8-32 还有第三份无缓存版。

**修复**: 新建 `server/utils/fileStore.js`：

```js
// BUGFIX-R-01: 文件存储工厂，统一缓存/写锁基础设施（markers/plans/users 共用）
import fs from 'fs/promises'

export function createFileStore(filePath, { cache: useCache = true } = {}) {
  let cache = null
  let writeLock = Promise.resolve()

  function sequential(fn) {
    const next = writeLock.then(fn, fn)
    writeLock = next.then(() => {}, () => {})
    return next
  }

  async function readAll() {
    if (useCache && cache !== null) return cache
    try {
      const content = await fs.readFile(filePath, 'utf-8')
      const data = JSON.parse(content)
      if (useCache) cache = data
      return data
    } catch (error) {
      if (error.code === 'ENOENT') {
        if (useCache) cache = []
        return []
      }
      throw error
    }
  }

  async function writeAll(data) {
    await fs.writeFile(filePath, JSON.stringify(data, null, 2), 'utf-8')
    if (useCache) cache = data
  }

  return { sequential, readAll, writeAll }
}
```

三个 repository/service 改为调用工厂（保留各自对外 API 签名不变；S1-07 修复的"构造新数组再 writeAll"语义保持不变）。

**验收**: 三处 CRUD 全部回归通过；人工确认三文件不再含重复的 cache/lock 基础设施。

---

### 任务 S4-02【R-02】floodAnalysisController 响应格式统一

**问题**: floodAnalysisController 6 端点各自重复 try-catch + `{code,data,message}`，与全项目主流 `{error}` + HTTP 状态码分裂。

**决策**: 统一为 `{ error }` + HTTP 状态码（主流派），前端 FloodAnalysisPage 同步改造。

**修复**:

**1. `server/controllers/floodAnalysisController.js`**：提取 asyncHandler 包装，6 端点去重复 try-catch，成功直接 `res.json(data)`，业务失败 `res.status(4xx).json({ error })`。S3-07 补充的 `requestedWaterLevel/actualWaterLevel` 字段保留在 data 中。

**2. `src/business/flood-analysis/FloodAnalysisPage.vue`**：移除全部 `data.code === 200` 判断（useApiRequest 已对非 2xx 抛错），直接使用返回数据：

```js
// BUGFIX-R-02: 响应格式统一为 {error}+状态码，成功路径直接取数据
const features = floodAreasData.features || []
const statistics = statisticsData
const riskLevel = floodAreasData.riskLevel || '无风险'
```

（triggerFloodAnalysis/triggerImpactAssessment 同改；S3-07 的 actualWaterLevel 提示逻辑保留。）

**验收**: 浸没分析全流程功能不变；`Grep "code === 200" src/` 0 匹配；`Grep "code: 200" server/` 0 匹配。

---

### 任务 S4-03【P3-08】scoring spread 栈溢出风险

**问题**: `server/services/scoringService.js:15-19` `Math.min(...points.map(...))` 展开大数组（数万 POI）有栈溢出风险。

**修复**:

```js
// BUGFIX-P3-08: 循环求最小值，避免大数组 spread 栈溢出
let nearest = Infinity
for (const p of points) {
  const d = turf.distance(xqPoint, turf.point([p.lng, p.lat]), { units: 'kilometers' })
  if (d < nearest) nearest = d
}
```

**验收**: 选址分析结果与修复前一致（评分不变）。

---

### 任务 S4-04【P3-09】facilities 缓存加 TTL

**问题**: `server/repositories/facilitiesRepository.js:18-29` 模块级 Map 无过期，`invalidateCache` 无任何调用点。

**修复**: 缓存条目记录写入时间，读取时超过 TTL（5 分钟）自动重载：

```js
// BUGFIX-P3-09: 缓存加 TTL，过期自动失效
const CACHE_TTL = 5 * 60 * 1000
// 缓存结构改为 { data, cachedAt }，读取时判断 Date.now() - cachedAt > CACHE_TTL 则重新加载
```

**验收**: 修改某个设施 json 数据文件后，5 分钟内旧缓存生效、5 分钟后新数据生效。

---

### 任务 S4-05【P3-10】importance 取整夹取

**问题**: `server/services/importanceMapping.js:9` `IMPORTANCE_FACTOR[importance] ?? 1`，小数（如 2.5）静默回落系数 1。

**修复**:

```js
// BUGFIX-P3-10: 非表项输入取整夹取并告警，拒绝静默兜底
function importanceToFactor(importance) {
  const raw = Number(importance)
  const n = Math.round(raw)
  if (!isFinite(raw) || n < 1 || n > 5) {
    console.warn(`[importanceMapping] 无效 importance: ${importance}，已按 3 处理`)
    return IMPORTANCE_FACTOR[3]
  }
  if (n !== raw) {
    console.warn(`[importanceMapping] importance ${importance} 非整数，已取整为 ${n}`)
  }
  return IMPORTANCE_FACTOR[n]
}
```

（与原表项语义一致；导出函数名以现状为准适配调用点。）

**验收**: importance 传 2.5 → 按 3 的系数计算且后端日志有告警；传 1~5 整数 → 结果不变。

---

### 任务 S4-06【P3-01】经纬度字段统一为 lng

**问题**: 港口数据用 `lon`（ports.json），相机/飞行目标用 `lng`，渲染器内两套字段并存，靠 UnifiedMap.vue:249-253 转换补丁弥合。

**决策**: 统一为 `lng`（类型定义、渲染器、业务代码均以此为准）。

**修复**:

1. **数据迁移**：`public/data/ports.json` 中 `lon` 键批量改为 `lng`（一次性脚本或手工；检查 `server/data/` 与 `public/data/` 下其他 json 是否也有 lon 字段，一并处理）。
2. `src/types/map.ts`：`Port` 接口 `lon` → `lng`，删除"历史数据问题"注释。
3. 全量 Grep `\.lon\b`，逐处改为 `.lng`（OLRenderer.js:104、CesiumRenderer.js:436 等港口点读取处）。
4. 删除 UnifiedMap.vue:249-253 的 lon/lng 转换补丁。
5. `SiteSelectionPage.vue:162-170` 的 `xq.lng ?? xq.lon` 兼容逻辑可保留（防御存量数据）但标注 `// BUGFIX-P3-01: 存量数据兼容，新数据统一 lng`。

**验收**: `Grep "\\.lon\\b" src/ public/data/` 仅剩兼容分支；首页港口点、选址/浸没分析飞行定位全部正常。

---

### 任务 S4-07【P3-05】useGCS 单例化

**问题**: `src/core/layout/useGCS.js:46-52` 每次调用新建 ref，:226-233 每个组件各自注册 resize 监听——16 个组件 = 16 套状态 + 16 个监听。

**修复**: 状态提升到模块作用域（模块级只创建一次），resize 监听模块级只注册一次（参考 useAuth.ts:38-47 的 AUDIT-004 单例模式）：

```js
// BUGFIX-P3-05: GCS 状态模块级单例，全部组件共享同一套响应式状态
const windowWidth = ref(window.innerWidth)
const windowHeight = ref(window.innerHeight)
const cellPixel = ref(computeCellPixel(windowWidth.value))
let resizeTimer = null
let listenerRegistered = false

function ensureResizeListener() {
  if (listenerRegistered || typeof window === 'undefined') return
  window.addEventListener('resize', onResize)
  listenerRegistered = true
}
```

`useGCS()` 改为只返回共享引用与工具函数；各组件挂载/卸载中的注册/移除逻辑删除（监听常驻）。

**验收**: 全部页面渲染后 window resize 监听仅 1 个 GCS 监听器；面板布局随窗口缩放正常。

---

### 任务 S4-08【P3-06】mapDataService 并发去重 + TTL

**问题**: `src/services/mapDataService.js:3-18` check-then-fetch 无 in-flight 去重，并发首访同一 URL 发重复请求；缓存永不过期。

**修复**:

```js
// BUGFIX-P3-06: in-flight Promise 去重 + TTL 过期
const dataCache = new Map() // url -> { data, cachedAt }
const pendingCache = new Map() // url -> Promise
const CACHE_TTL = 5 * 60 * 1000

async function fetchData(url) {
  const hit = dataCache.get(url)
  if (hit && Date.now() - hit.cachedAt < CACHE_TTL) return hit.data
  if (pendingCache.has(url)) return pendingCache.get(url)
  const p = fetch(url)
    .then((res) => {
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      return res.json()
    })
    .then((data) => {
      dataCache.set(url, { data, cachedAt: Date.now() })
      pendingCache.delete(url)
      return data
    })
    .catch((err) => {
      pendingCache.delete(url)
      throw err
    })
  pendingCache.set(url, p)
  return p
}
```

（导出签名保持现状，`clearCache` 同时清两个 Map。）

**验收**: 同时触发两个组件加载同一数据 → Network 仅 1 次请求；TTL 后重新请求。

---

### 任务 S4-09【P3-07】删除硬编码天地图 KEY

**问题**: `src/core/config/map.js:2` `import.meta.env.VITE_TIANDITU_KEY || 'e4cef34602...'`——硬编码兜底 KEY 随源码入库。

**修复**:

1. 确认项目根 `.env` / `.env.production` 已配置 `VITE_TIANDITU_KEY`（没有则补，值为现有 KEY；注意该 KEY 已入库泄露，建议尽快申请新 KEY 替换）。
2. map.js 删除兜底：

```js
// BUGFIX-P3-07: 天地图 KEY 仅从环境变量读取，缺失时显式报错
const TIANDITU_KEY = import.meta.env.VITE_TIANDITU_KEY
if (!TIANDITU_KEY) {
  console.error('[map/config] 缺少 VITE_TIANDITU_KEY 环境变量，天地图底图将无法加载')
}
```

**验收**: 删除环境变量启动 → 控制台显式报错；配置后底图正常。

---

### 任务 S4-10【P3-11】统一 logger，清理生产 console

**问题**: src/ 下 25+ 处裸 `console.*`（FloodAnalysisPage.vue:232/246/254、CesiumRenderer.js:525/652、PaginatedListPanel.vue:234、RadarChart.vue:124、useAuth.ts:163 等），生产环境泄漏调试信息。

**修复**:

1. 新建 `src/shared/utils/logger.js`：

```js
// BUGFIX-P3-11: 统一 logger，生产环境自动静默 debug/info
const isDev = import.meta.env.DEV
export const logger = {
  debug: (...args) => isDev && console.log(...args),
  info: (...args) => isDev && console.info(...args),
  warn: (...args) => console.warn(...args),
  error: (...args) => console.error(...args),
}
```

2. 全量替换 src/ 下裸 `console.log/info/debug` 为 `logger.debug`；`console.warn/error` 保留或走 logger（调用方需展示的告警保留）。FloodAnalysisPage 的 `[DIAG]` 系列全部改为 `logger.debug` 或直接删除。

**验收**: `Grep "console\\.(log|info|debug)" src/` 仅剩 logger.js 自身；生产构建（`npm run build` 后 preview）控制台无调试输出。

---

### 任务 S4-11【P3-12】删除路由守卫死代码

**问题**: `src/router/index.js:43-56` beforeEach 守卫依赖 `to.meta.requiresAuth`，但四条路由 meta 均无该字段（:24 注释明确"P0-001-FIX: 移除 requiresAuth"），守卫永不触发。

**决策**: 删除。项目采用页面内登录判断（收藏/保存时校验），无路由级保护需求。

**修复**: 删除 beforeEach 守卫整段，路由文件仅保留路由表与创建逻辑。

**验收**: 四条路由跳转正常；`Grep "requiresAuth" src/` 0 匹配。

---

### 任务 S4-12【R-04】字号与 cell 解耦

**问题**: `src/core/layout/useGCS.js:201-206` 字号为 0.2/0.175/0.15 cell，随视口浮动；GCS_V2 设计规范要求固定 16/14/12px。

**修复**: useGCS.js 的 css 导出对象中：

```js
// BUGFIX-R-04: 字号固定 px，与 cell 网格解耦（GCS_V2 规范）
// 0.2cell→16px, 0.175cell→14px, 0.15cell→12px
```

范围控制：**仅改 useGCS.js 暴露的 css 变量**；组件内本地计算的 cell 系数字号（LoginPanel.vue:31-37 等）不在本期改，避免大面积 UI 回归（记录为后续 UI 走查事项）。

**验收**: 使用 css 变量的组件字号在不同视口下保持 16/14/12px；页面无文字重叠/溢出回归。

---

### 任务 S4-13【R-05】map store 拆分 uiStore

**问题**: `src/stores/map.js` 混合地图状态（map/mapType/layerCatalog/currentRenderer，:104-111）与 UI 视图状态（activePanel/selectedXiaoqu，:117-118 及 :311-329 面板 action）。

**修复**:

1. 新建 `src/stores/uiStore.js`：`activePanel`、`selectedXiaoqu` 及相关 action（setActivePanel/setSelectedXiaoqu 等）迁入。
2. `map.js` 删除迁出项，仅保留地图/图层状态。
3. 全量 Grep 使用点（`mapStore.activePanel`、`mapStore.selectedXiaoqu` 等）改为 uiStore。

**验收**: 全部页面功能回归通过（重点：选址页小区选中→雷达图联动）；`map.js` 中不再含 UI 状态。

---

### 任务 S4-14【A-03】AppLayout 解除图表依赖

**问题**: `src/core/layout/AppLayout.vue:30-32` 直接 import LineChart/BarChart/RadarChart，layout 层依赖 visualization 层，违反分层。

**修复**: 默认插槽内容（:578-595 的折线图/柱状图/雷达图 Panel）从 AppLayout 移至 `src/views/HomePage.vue`（HomePage 通过 `#left`/`#right` 插槽注入同样的 Panel）；AppLayout 的 slot 改为空默认。这样 AppLayout 成为纯布局壳，HomePage 行为不变。

注意：ProfilePage 当前不显式传 `#left`（用默认内容），改造后需确认 ProfilePage 是否需要左侧默认图表——若需要则在 ProfilePage 显式注入（与 HomePage 共用可提取为小组件，但不做过度设计，直接复制两个 Panel 配置即可）。

**验收**: `Grep "LineChart|BarChart|RadarChart" src/core/layout/` 0 匹配；首页与个人中心左侧图表显示不变。

---

### 任务 S4-15【A-04】UnifiedMap 职责拆分

**问题**: `src/core/map/UnifiedMap.vue` 546 行，≥7 项职责（数据加载、渲染器创建/复用、图层装配、事件绑定、引擎切换、容器等待、飞行/呼吸点 API）。

**修复**: 按以下边界拆分为 composable（目标组件 <200 行，只留模板与编排）：

| 新文件 | 迁入职责 |
|---|---|
| `composables/useMapDataLoader.js` | `loadData`（:120 起）、`setupLayers`（:222 起）中数据加载与清洗 |
| `composables/useEngineSwitch.js` | `switchMapType`（:302 起）引擎切换 + 相机状态迁移 |
| `composables/useRendererLifecycle.js` | `initRenderer`（:146 起）、容器可见性等待（:89）、超时包装（:71） |

组件保留：模板、`setupEvents` 的事件绑定编排、对外飞行/呼吸点 API 的薄封装（委托给上述 composable）。

**验收**: UnifiedMap.vue <200 行；2D/3D 切换、图层控制、城市飞行、选址/浸没两业务页全部回归通过。

---

### 任务 S4-16【A-06】API 调用边界统一

**问题**: 三种调用方式并存——裸 fetch（useBoundaryLayer.js:46）、useApiRequest、mapDataService 自包装。

**决策**: 两类收口，职责显性化：
- **后端 API**（/api/*）：一律 `useApiRequest`（带 token/超时/401 处理）。
- **public 静态地理数据**（/data/*、*.geojson）：一律 `mapDataService`（带缓存与 TTL，S4-08 已修）。

**修复**: `useBoundaryLayer.js:46` 的裸 fetch 改走 `mapDataService.fetchData`；全量 Grep `fetch(` 确认 src/ 下除 mapDataService 与 useApiRequest 外无其他裸 fetch。

**验收**: `Grep "fetch(" src/` 仅剩 mapDataService.js 与 useApiRequest.ts 两处。

---

### 任务 S4-17【A-07】facilityConfig 上移至 shared

**问题**: `src/visualization/charts/composables/useRadarChart.js:19` 从 `@/business/site-selection/composables/facilityConfig` 导入 FACILITY_CONFIG，visualization 层反向依赖 business 层。

**修复**:

1. 将 `src/business/site-selection/composables/facilityConfig.js` 移至 `src/shared/config/facilityConfig.js`（内容不变）。
2. 全量 Grep `facilityConfig` 更新所有 import 路径（useRadarChart.js、site-selection 下各组件）。

**验收**: `Grep "business/site-selection" src/visualization/` 0 匹配；雷达图与选址因子面板功能不变；dependency-cruiser（`npx depcruise src --config .dependency-cruiser.cjs`）无 visualization→business 违规。

---

### 阶段四验收清单

- [ ] `npm run lint` 0 error；`npm run test` 通过；`npm run build` 通过
- [ ] 后端三处文件存储 CRUD 全部回归（S4-01）
- [ ] 浸没分析无 `{code,data,message}` 残留（S4-02）
- [ ] 选址评分结果与重构前一致（S4-03/S4-05）
- [ ] 港口点、飞行定位在 lon→lng 统一后全部正常（S4-06）
- [ ] GCS 布局 resize 监听仅 1 个（S4-07）
- [ ] 生产构建控制台无调试输出（S4-10）
- [ ] UnifiedMap <200 行且四页面回归通过（S4-15）
- [ ] dependency-cruiser 无跨层违规（S4-14/S4-17）
- [ ] `git diff` 审查：无误改、注释标注齐全

---

## 第 7 章 不纳入本次修复的条目

| 条目 | 原因 | 处置建议 |
|---|---|---|
| A-05 同页多引擎共存 | 能力缺口而非 bug；项目预设中无同页双引擎场景 | 记录为演进方向，未来做双视图对比时立项 |
| 预测分析设计偏差 8 处（偏1~偏8） | 预测分析模块是**全新功能开发**（15 个文件全部未建），不属于 bug 修复 | 立项时先按本阶段完成后的代码事实修订《港口预测分析模块技术设计文档》，再实施 |
| 缺口1 渲染器无热力图能力 | 预测分析功能依赖项，随模块立项一并评估 | 同上 |
| 缺口3 TypeScript 零使用 | 渐进迁移事项，不阻塞 bug 修复 | 新代码优先 TS，旧代码随重构渐进迁移 |
| 缺口4 CI/CD 缺失 | 工程建设专项，与运行时 bug 无关 | 另立 DevOps 专项（GitHub Actions + pre-commit） |
| 决策1 forecast 认证策略 | 已在 S1-08 中定调：与其余业务接口一致需登录 | 预测分析实施时遵循 |
| 决策2 返回格式两派并存 | 已在 S4-02 中统一为 `{error}` + 状态码 | 预测分析实施时遵循 |

---

## 第 8 章 全量回归验证矩阵（每阶段完成后执行对应行）

### 8.1 自动化

| 验证项 | 命令 | 通过标准 |
|---|---|---|
| 静态检查 | `npm run lint` | 0 error |
| 单元测试 | `npm run test` | 全部通过 |
| 生产构建 | `npm run build` | 成功无警告（chunk 体积警告除外） |
| 后端语法 | `cd server && node --check app.js` | 无输出 |
| 后端测试 | `cd server && npx vitest run`（如有） | 全部通过 |

### 8.2 手工冒烟（四阶段全部完成后统一执行一轮）

| # | 场景 | 操作 | 预期 |
|---|---|---|---|
| 1 | 注册登录 | 注册新账号（密码含 `&<>`）→ 登出 → 登录 | 全链路成功 |
| 2 | 旧账号兼容 | 用阶段一前注册的含特殊字符密码账号登录 | 成功且哈希已迁移 |
| 3 | 越权防护 | 无 token curl /api/markers、/api/gcs/water-level | 均 401 |
| 4 | 首页 | 城市按钮飞行、港口点点击、图表显示 | 正常 |
| 5 | 选址分析 | 选设施 → 分析 → Top10 → 收藏（已登录） | 结果正确，收藏成功 |
| 6 | 选址状态恢复 | 分析后去个人中心再返回 | 设施选择/POI/结果完整恢复 |
| 7 | 方案管理 | 保存 → 重命名 → 加载 → 删除 | 全部成功，重命名弹窗预填正确 |
| 8 | 浸没分析 | 拖水位滑块 → 淹没范围/受影响设施/损失统计 | 与档位一致，无乱序回跳 |
| 9 | 浸没方案 | 保存 flood 方案 → 个人中心加载 | 水位/风险等级/损失完整恢复 |
| 10 | 2D/3D 切换 | 选址(2D) ↔ 浸没(3D) 反复切换 5 次 | 无报错、无监听器泄漏 |
| 11 | 多标签页 | A 标签登出 → B 标签 | B 同步登出且业务状态清空 |
| 12 | 生产模式 | `npm run build && npm run preview` | 控制台无调试输出，全部功能正常 |

---

## 附录 A 任务-编号速查

| 阶段 | 任务 | 原编号 |
|---|---|---|
| 一 | S1-01 ~ S1-09 | P0-02、P1-07、P1-06、R-03、P1-14、P2-09、P2-10、P2-11、P1-08/09+P2-08 |
| 二 | S2-01 ~ S2-11 | P1-01、P1-02、P1-03、P1-04、P2-04、P1-05、P3-03、P3-14、P1-13、P2-06、P2-03 |
| 三 | S3-01 ~ S3-10 | P1-10、P1-11、P1-12、P3-13、P2-01、P2-02、P2-07、P3-02、P3-04、P3-15 |
| 四 | S4-01 ~ S4-17 | R-01、R-02、P3-08、P3-09、P3-10、P3-01、P3-05、P3-06、P3-07、P3-11、P3-12、R-04、R-05、A-03、A-04、A-06、A-07 |

**文档结束**。实施完成后请在《项目问题汇总.md》中将对应条目状态更新为已修复，并注明实施日期。

