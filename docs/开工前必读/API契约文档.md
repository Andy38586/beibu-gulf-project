# 北部湾港 WebGIS 平台 — API 契约文档

> **定位**:前后端通信的**规则**文档。规则不变,接口清单会演进——新增/删除接口时
> 更新 §5 索引即可,§1-§4 的规则**禁止改动**(改了就是破坏契约)。
> 代码变更红线:`backend/utils/response.js`(信封)、`BusinessError`(错误码)、
> `frontend/src/shared/composables/useApiRequest.ts`(前端统一入口)是本契约的实现方,
> 改实现必须同步改本文档。

## 1. 响应契约(铁律)

### 1.1 信封格式

**所有接口统一 `{ code, data }` 信封**(`backend/utils/response.js` 的 `sendSuccess` 保证):

```
成功: HTTP 2xx + { code: <同 HTTP 状态>, data: <业务数据> }
错误: HTTP 4xx/5xx + { code: <同 HTTP 状态>, error: <错误文案> }
```

- 前端解包**唯一**走 `unwrapEnvelope`(禁止手写 `.data` / `.then(r => r.data)`)
- 信封允许扩展字段(如 `message`/`timestamp`),**不得改变 code/data 语义**
- 跨服务例外:FastAPI(洪涝 online)返回**裸 JSON 无信封**,前端调用传 `envelope: false`

### 1.2 前端调用规则

- 请求**唯一**走 `useApiRequest()`;静态资源走 `loadStatic()`。**禁止裸 fetch/axios**
- `useApiRequest` 已内置:Cookie 自动携带(`credentials: 'include'`,不发 Bearer)、
  10s 超时、401 抛 `UNAUTHORIZED`、网络错误捕获、GET 幂等重试(3 次线性退避)
- 每个 `apiRequest` 调用**必须传 zod `schema`**(HTTP 边界运行时校验,拒绝畸形响应)

### 1.3 错误码(双轨制,注意维度)

> **两套错误码,维度不同,不互通**:
>
> - 前端 `useApiRequest.ts` 的 `ErrorCode`(**网络层字符串码**):TIMEOUT / NETWORK_ERROR / UNAUTHORIZED / SERVER_ERROR / REQUEST_FAILED
> - 后端 `BusinessError.js` 的 `ErrorCode`(**业务层数字码**):如 `400001` = HTTP 400 + 0001(命名约定 `<HTTP status><业务序号>`)
>
> 前端 `ApiError(message, code)`(字符串码)对应网络层;后端 `BusinessError(status, code, message)`(数字码)对应业务层,经全局中间件映射 HTTP 状态。**新增业务错误码走后端数字表**;新增网络层错误码才动前端白名单。禁止跨层混用/散落魔法字符串。

## 2. 认证契约

- **HttpOnly Cookie 单通道**(防 XSS):登录后 `auth_token` Cookie(7 天,`sameSite: 'strict'`,
  生产强制 HTTPS);前端只 `credentials: 'include'`,**不发送 Bearer header**
- Bearer header 仅后端兼容 fallback(非浏览器客户端/调试)
- 未提供令牌 / 令牌无效 → `401 { code: 401, error: '未提供认证令牌'|'认证令牌无效或已过期' }`

## 3. 接口命名规约

- **路径**:kebab-case 复数名词(资源型:`/plans`、`/flood/water-area`);操作型:`/analysis/<action>`
- **资源型端点**只做 CRUD 语义映射:GET 列表/单条、POST 创建、PUT 更新、DELETE 删除
- **校验**:入参在 controller 校验(统一 `BusinessError`),响应在前端 zod 校验(schema 在 `types/schemas.ts`)
- 请求参数统一 `useApiRequest` 的 `params` 构造 query(禁止手写模板字符串拼 URL)

## 4. 限流与安全

- 全局:`/api/` **1000 次/15 分钟**;登录/注册:**50 次/15 分钟**(2026-08-09 部署演示放宽,原 100/5 太严导致演示 429 连锁;真实上线再收紧)
- 生产必须 `helmet` + `trust proxy`(nginx 反代时配置跳数,否则限流按 127.0.0.1 失效)
- 敏感配置只进 `.env`,禁止入 git;CI 有 gitleaks secret-scan 门禁
- HTTPS:生产已启用 TLS 1.2/1.3(Let's Encrypt + 443 直通,2026-08-10),HttpOnly Cookie 生产 `secure` 由实际协议决定(X-Forwarded-Proto)

## 5. 接口索引(会演进,以代码为准)

> **前缀约定**:Express 端点统一前缀 `/api`(Vite proxy `/api` → `localhost:3000`),下表省略 `/api` 前缀;
> 洪涝 online 走 Vite proxy `/flood-online` → FastAPI `:8000`,带 proxy 前缀(非 `/api`,且返回裸 JSON)。
> 本清单是**当前**接口快照,增删后更新此处。规则见 §1-§4,不随清单变化。

| 模块        | 端点                                                                                                            | 登录          | 说明                              |
| ----------- | --------------------------------------------------------------------------------------------------------------- | ------------- | --------------------------------- |
| 认证        | `POST /auth/register` / `POST /auth/login` / `POST /auth/logout`                                                | 公开          | Cookie 通道                       |
| 认证        | `GET /auth/me`                                                                                                  | ✅ 需登录     | 当前用户信息                      |
| 选址        | `POST /site-analysis`                                                                                           | 公开          | 分析(参数 zod 校验；纯计算免登录，2026-08-29 收口) |
| 方案        | `GET/POST /plans`、`GET/PUT/DELETE /plans/:id`、`POST /plans/:id/xiaoqu`、`DELETE /plans/:id/xiaoqu/:xiaoquId`  | ✅ 全部需登录 | CRUD                              |
| 预测        | `GET /forecast/timeseries`、`GET /forecast/indicator/:indicator`、`GET /forecast/map`、`GET /forecast/overview` | 公开          | —                                 |
| 预测        | `GET /forecast/:portId`                                                                                           | 公开          | 孤儿路由（前端零消费，保留兼容端点，2026-08-16 816 补录） |
| 洪涝        | `GET /flood/water-area`、`GET /flood/terrain-profiles`、`GET /flood/flood-areas`、`GET /flood/flood-statistics` | 公开          | api 模式                          |
| 洪涝        | `POST /flood/analysis/disaster`                                                                                 | 公开          | 灾害评估(纯计算免登录，2026-08-29 收口)            |
| 洪涝 online | `GET /flood-online/api/flood/online?waterLevel=`                                                             | 公开          | FastAPI 裸 JSON,`envelope: false`（b027：参数名统一 waterLevel） |
| 洪涝 online | `GET /flood-online/api/flood/impact?waterLevel=`                                                             | 公开          | 在线设施影响评估（P2-1 补录）      |
| 收藏        | `GET /favorites`、`POST /favorites`、`DELETE /favorites/:itemType/:itemId`                                     | ✅ 全部需登录 | 全局收藏(幂等添加，itemType+itemId 唯一) |
| 健康        | `GET /health`、`GET /health/ready`                                                                              | 公开          | 探针,置于限流前                   |

**已删除接口**(勿重新添加):`/api/markers/*`(死代码)、`/api/facilities/*`、`/api/flood/water-levels`、`/api/flood/facilities`(前端零调用孤儿)、`GET /ports`(2026-08-29 港口数据回迁前端静态 `frontend/public/data/ports.json`,纯透传端点无后端价值)。

## 6. 校验命令

```bash
npm run cruise        # 架构契约(含 backend)
npm test              # 前后端测试
npm run types:check   # API 契约漂移检查（gen-api-contract --check，前端 schema 与后端响应比对）
```
