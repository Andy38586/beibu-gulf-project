# shared — 前端共享层

> 跨业务复用的工具函数、composable、常量与基础组件。
> 分层最底层，**禁止依赖 `core` / `stores` / `business`**；上三层（core/stores/business）单向依赖本层。

## 一、模块职责

shared 提供与业务无关、可被任意上层复用的「公共基础设施」：

1. **请求与认证**：`useApiRequest`（fetch 封装 + 信封解包 + 重试）、`useAuth`（认证状态 + 多标签页同步）、`usePlans`（方案 CRUD）。
2. **通用异步数据**：`useAsyncData`（loading/error/data/refresh/cancel 五元组，竞态守卫）。
3. **静态资源加载**：`loadStatic`（超时 + 缓存 + in-flight 去重 + LRU + zod 校验）。
4. **错误处理**：`errorHandler`（统一出口，替换分散的 ElMessage/console）。
5. **GCS 布局**：`config.ts`（布局常量）+ `useGCS`（响应式 cell 尺寸 / 面板定位 PPS）。
6. **空间索引**：`spatialIndex`（rbush 视口裁剪，EPSG:3857）。
7. **常量与标签**：`constants/colors`、`constants/forecast`、`facilityLabels`。
8. **基础组件**：`EmptyState` / `ErrorBoundary` / `ErrorModal` / `PaginatedListPanel` / `PanelTitle` / `PlanSaveModal`。

## 二、目录结构

```
shared/
├── index.ts              # 公开 API 入口（re-export 非 composable/非组件模块）
├── components/           # *.vue 组件，不 re-export，消费方直接路径 import
│   ├── EmptyState.vue
│   ├── ErrorBoundary.vue
│   ├── ErrorModal.vue
│   ├── PaginatedListPanel.vue
│   ├── PanelTitle.vue
│   └── PlanSaveModal.vue
├── composables/
│   ├── useApiRequest.ts  # fetch 封装 + ErrorCode + ApiError
│   ├── useAsyncData.ts   # 通用异步数据管理（@audit-note DAT-4 预留未接入）
│   ├── useAuth.ts        # 认证状态 + localStorage + 多标签页同步
│   ├── usePlans.ts       # 方案 CRUD + 小区收藏
│   └── __tests__/useApiRequest.test.ts
├── constants/
│   ├── colors.ts
│   └── forecast.ts       # DEFAULT_CONFIDENCE / BASE_YEAR / END_YEAR（单一事实源）
├── layout/
│   ├── config.ts         # CELL_PIXEL / GAP / PANEL_SPACING / getCellPixelByViewport
│   └── useGCS.ts         # GCS V2 响应式布局 composable（模块级单例）
└── utils/
    ├── errorHandler.ts   # showError / handleAsync / handleAuthError / isAuthError
    ├── facilityLabels.ts
    ├── loadStatic.ts     # 静态资源加载器（超时/缓存/去重/LRU/zod）
    ├── logger.ts
    ├── responseEnvelope.ts   # unwrapEnvelope（P1-1 响应契约收口）
    ├── spatialIndex.ts   # rbush 视口裁剪（与后端同名不同义）
    └── __tests__/        # loadStatic / responseEnvelope / spatialIndex 测试
```

## 三、入口文件

### `index.ts`

公开 API 聚合点。约定：

- `components/` 目录**不 re-export**——Vue 组件保持直接路径 import（如 `@/shared/components/PanelTitle.vue`）。
- 其余 composable / constants / layout / utils 模块全部 re-export，消费方统一从 `@/shared` 引入。

## 四、关键工具/composable 清单

### `useApiRequest`

- 模块级单例 `token`（仅内存，认证主通道是 HttpOnly Cookie，`credentials: 'include'`）。
- **信封解包**（P1-1）：后端统一返回 `{ code, data }`，经 `unwrapEnvelope` 提取 `data`，调用方始终拿业务数据。
- **重试**（z049）：GET 幂等请求在超时/网络错误时线性退避重试（最多 3 次，0.8/1.6/2.4s）；POST 不重试。
- **zod 校验**（z045）：传入 `schema` 则 `safeParse` 替代裸 `as T` 断言，失败抛 `ApiError(REQUEST_FAILED)`（不在重试码内）。
- **超时**：默认 10s，`AbortController` 内部超时与外部 `signal` 用 `AbortSignal.any` 组合（`@arch-note SEC-021` 区分超时 vs 主动取消）。

### `useAuth`

- localStorage 持久化用户信息（key: `beibu-gulf-user`），经 `userSchema.safeParse` 校验（z045）。
- **Cookie 权威**（d033）：`restoreAuth` 始终以 Cookie 为准，无论 localStorage 有无 user 均调 `/auth/me` 验证。
- 多标签页 `storage` 事件同步；`setResetStoresHandler` 由 App.vue 注入 store 重置逻辑（z053，避免 useAuth 反向依赖 stores）。

### `useAsyncData`（z034）

- 封装 `loading/error/data/refresh/cancel`；事务序号 `seq` 仅最新请求写 data，防竞态。
- `@audit-note DAT-4`：当前 0 调用方，作为通用工具保留，待首个消费方接入后脱离「伪 shared」标签。简单页保持 `onMounted` 直接调用（D-4 克制）。

### `loadStatic`

- 默认超时 10s、缓存 TTL 5min；in-flight Promise 去重（同 URL 并发只发一次）。
- LRU 上限 100（z050-FE），超限删最旧插入项。
- zod 校验（z045）：缓存命中校验失败→清缓存降级重新 fetch；fetch 结果校验失败→抛错拒绝消费。

### `useGCS` / `layout/config.ts`

- GCS V2 全局布局配置，所有面板尺寸统一来源，**禁止组件硬编码 px**。
- `CELL_PIXEL=80`、`GAP=10`（PANEL_SPACING/CELL_PADDING/SAFE_MARGIN 派生源）；`getCellPixelByViewport` 按视口宽度分级（≥1920→90，≥1366→80，≥768→70，其余→60）。
- `useGCS` 模块级单例：`cellPixel`/`windowWidth`/`windowHeight` 全局共享，resize 防抖 150ms；`panelPosition` 锚点定位 + 兜底防 NaN。

### `spatialIndex`

- 基于 rbush 的视口裁剪（EPSG:3857，与 OpenLayers view 一致），`VIEWPORT_CULL_THRESHOLD=1000`。
- **同名不同义**：前端=视口矩形查询；后端 `backend/utils/spatialIndex.js`=多边形覆盖查询（turf）。禁止相互引用或混用。

### `errorHandler`

- `showError`：统一错误提示，过滤 AbortError；`retry` 回调时用确认弹窗（c027）。
- `handleAuthError(router)`：`router` 必选参数（z044），移除动态 `import('@/router')` 兜底以打断 `errorHandler→router→business→errorHandler` 循环链；useAuth 内仍保留动态 import 避免 `useAuth→errorHandler` 静态循环。

## 五、依赖关系

- **禁止反向依赖**：shared 不得 import `@/core` / `@/stores` / `@/business`（分层铁律，dependency-cruiser 校验）。
- **向 types 依赖**：`@/types/api`、`@/types/plan`、`@/types/facility`、`@/types/schemas`（zod schema）。
- **向第三方依赖**：`vue`、`vue-router`、`zod`、`rbush`、Element Plus（`ElMessage`/`ElMessageBox` 全局）。
- **被依赖方**：`core` / `stores` / `business` / `App.vue` 均从 `@/shared` 取公共能力。

## 六、关键约束（@arch-note）

| 标注       | 文件                                 | 约束                                                                                                                                         |
| ---------- | ------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------- |
| 分层铁律   | 整体                                 | shared → core/stores/business 禁止；stores → business 禁止（故 `constants/forecast` 上提到 shared，供 store 与 business 共用，保持单向依赖） |
| `P1-1`     | responseEnvelope / useApiRequest     | 响应契约收口：后端统一 `{ code, data }`，`unwrapEnvelope` 为唯一事实源，调用方不手动 `.data`                                                 |
| `z045`     | useApiRequest / useAuth / loadStatic | zod `safeParse` 替代裸 `as T` 断言做运行时校验                                                                                               |
| `z049`     | useApiRequest                        | 仅 GET 幂等请求重试，POST 不重试（避免重复写操作）                                                                                           |
| `SEC-021`  | useApiRequest                        | 区分内部超时 abort vs 外部 signal 主动取消，取消不提示「超时」                                                                               |
| `z044`     | errorHandler                         | `handleAuthError(router)` 的 router 必选，移除动态 import 打断循环依赖链                                                                     |
| `z050-FE`  | loadStatic                           | 缓存硬上限 100，超限近似 LRU 淘汰，防长会话内存膨胀                                                                                          |
| `DAT-4`    | useAsyncData                         | 预留未接入，当前 0 调用方，勿删除                                                                                                            |
| `d033`     | useAuth                              | Cookie 为认证权威，localStorage 仅缓存，`restoreAuth` 始终验证 Cookie                                                                        |
| 同名不同义 | spatialIndex                         | 前端视口裁剪 / 后端多边形覆盖，同名勿混用                                                                                                    |

## 七、测试

- `composables/__tests__/useApiRequest.test.ts`
- `utils/__tests__/loadStatic.test.ts` / `responseEnvelope.test.ts` / `spatialIndex.test.ts`
