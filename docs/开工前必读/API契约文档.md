# 北部湾港 WebGIS 平台 — API 契约文档

> **定位**: 本文档描述后端 API 的**实际行为契约**——请求结构、响应结构、认证要求、限流策略。这些契约只在 API 大版本升级时才会变更，与具体 bug 无关。
> **读者**: 前端/后端开发者，或后续接手本项目的 AI。读完应能准确拼接任意接口的请求与响应，不误用响应格式。
> **版本**: 2.0
> **编制**: 2026-07-27
> **基准代码**: backend/ 后端全量扫描（31 个端点）
> **用法**: 前端开发查阅本文件即可理解所有接口的请求/响应结构。如发现代码行为与本文件不一致，以代码为准并提 issue 更新本文件。
> **关联**: 具体的 bug、待修问题见 `待解决问题.md`，不在本文档中描述。
> **原则**: 每个端点的字段名、默认值、错误文案均来自 `backend/` 实际代码扫描，非凭空设计；同一模块内响应格式保持一致。

---

## 目录

1. [通用约定](#1-通用约定)
2. [认证](#2-认证)
3. [选址分析](#3-选址分析)
4. [设施数据](#4-设施数据)
5. [方案管理](#5-方案管理)
6. [标注管理](#6-标注管理)
7. [浸没分析](#7-浸没分析)
8. [预测分析](#8-预测分析)
9. [健康检查](#9-健康检查)

---

## 1. 通用约定

### 1.1 基础地址（Base URL）

```
开发环境: http://localhost:5173/api
（Vite proxy 将 /api 转发到 http://localhost:3000/api）
```

### 1.2 响应格式

项目存在三套响应格式，按业务模块固定使用。**新增模块统一使用 RESTful；已有模块内新增端点遵循该模块既有格式**（保证同模块调用方处理逻辑一致）：

| 格式         | 成功特征                                             | 错误特征                                                               | 使用模块                                                     |
| ------------ | ---------------------------------------------------- | ---------------------------------------------------------------------- | ------------------------------------------------------------ |
| **RESTful**  | HTTP 2xx + 直接返回数据                              | HTTP 4xx/5xx + `{ error: string }`                                     | auth / markers / facilities / plans / site-analysis / health |
| **GCS 标准** | HTTP 200 + `{ code: 200, data, message: 'success' }` | HTTP 4xx/5xx + `{ code: 4xx/5xx, data: null, message }`                | gcs（浸没分析）                                              |
| **混合格式** | HTTP 200 + `{ code: 200, data }`（无 message）       | HTTP 4xx/5xx + `{ code: 4xx/5xx, error }`（字段名 error 不是 message） | forecast（预测分析）                                         |

**关键差异**：
- RESTful 格式：成功响应直接返回数据本体（数组或对象），不包装；错误响应用 `error` 字段
- GCS 格式：成功响应用 `data` 字段包装；错误响应用 `message` 字段
- 混合格式：成功响应用 `data` 字段包装但无 `message`；错误响应用 `error` 字段
- 三种格式的错误响应 HTTP 状态码都是真实的 4xx/5xx（并非包装成 HTTP 200）

**调用方注意事项**：

- RESTful 格式接口用 `res.ok` / `res.status` + `data.error` 判断
- GCS/混合格式接口用 `data.code === 200` 判断成功
- `useApiRequest.ts` 已统一处理：`res.status === 401` 抛 `ErrorCode.UNAUTHORIZED`，`!res.ok` 抛 `ErrorCode.REQUEST_FAILED`

### 1.3 认证方式

**认证以 HttpOnly Cookie 单通道为主**（对应 D04 决策：防 XSS 抓取令牌）：

1. **登录后**：后端 `authController.setAuthCookie` 设置 `auth_token` HttpOnly Cookie（7 天有效期，`sameSite: 'strict'`，生产环境强制 HTTPS）
2. **前端请求**：`useApiRequest.ts` 仅通过 `credentials: 'include'` 自动携带 Cookie，**不发送 `Authorization: Bearer` header**（已删除；全文件无 Bearer 发送逻辑）
3. **后端校验**：`middleware/auth.js` 的 `authenticate` 函数**优先从 Cookie 读取** `auth_token`；作为服务端 fallback，无 Cookie 时仍兼容 `Authorization: Bearer <token>` header（便于非浏览器客户端 / 调试）。**浏览器前端实际只走 Cookie 通道**
4. **认证失败**：
   - 未提供令牌：`401 { error: '未提供认证令牌' }`
   - 令牌无效/过期：`401 { error: '认证令牌无效或已过期' }`

> **关于通道**：Cookie 通道是**唯一的前端通道**（HttpOnly 防 XSS）；Bearer header 仅作为后端兼容 fallback，前端已不再发送。历史"双通道"设计见 `待解决问题.md` D04 / `已解决问题.md` R16。

### 1.4 限流

- 全局：`/api/` 下所有端点 100 次 / 15 分钟
- 登录：`/api/auth/login` 单独 5 次 / 15 分钟

### 1.5 标注术语统一

后端代码统一使用"**标注**"（不是"标记"）。错误信息、字段名、日志文案均遵守此约定。前端展示文案可叫"标记"，但 API 层一律用"标注"。

---

## 2. 认证

**模块**：`backend/routes/auth.js` + `backend/controllers/authController.js`
**格式**：RESTful

### POST /api/auth/register

注册新用户。成功后自动登录并设置 Cookie。

```
POST /api/auth/register
Content-Type: application/json

{
  "username": "string (2-20字符，仅允许字母/数字/中文/下划线)",
  "password": "string (≥6位，需含大小写字母+数字)"
}

// 成功 201
{
  "token": "jwt_token_string",
  "user": { "id": "string", "username": "string", "createdAt": "ISO8601" }
}

// 失败
400 { "error": "用户名和密码不能为空" }
400 { "error": "用户名长度应在 2-20 个字符之间" }
400 { "error": "密码长度不能少于 6 位" }
400 { "error": "密码必须包含大小写字母和数字" }
409 { "error": "用户名已存在" }
500 { "error": "注册失败" }
```

### POST /api/auth/login

登录，限流 5次/15分钟。

```
POST /api/auth/login
Content-Type: application/json

{
  "username": "string",
  "password": "string"
}

// 成功 200
{
  "token": "jwt_token_string",
  "user": { "id": "string", "username": "string", "createdAt": "ISO8601" }
}

// 失败
400 { "error": "用户名和密码不能为空" }
401 { "error": "用户名或密码错误" }     // 有意不区分"用户不存在"和"密码错误"
500 { "error": "登录失败" }
```

> **历史兼容**：登录支持旧版前端 escapePassword 转义密码的存量账号。若原始密码比对失败，会尝试转义后比对，成功则静默迁移到新哈希。详见 `authController.escapeHtmlLegacy`。

### POST /api/auth/logout

```
POST /api/auth/logout

// 成功 200
{ "message": "登出成功" }
```

服务端清除 `auth_token` Cookie。

### GET /api/auth/me

**需要认证**。获取当前登录用户信息。

```
GET /api/auth/me

// 成功 200
{ "user": { "id": "string", "username": "string" } }

// 失败
401 { "error": "认证令牌无效或已过期" }
```

---

## 3. 选址分析

**模块**：`backend/routes/siteAnalysis.js` + `backend/controllers/siteAnalysisController.js`
**格式**：RESTful

### POST /api/site-analysis

**需要认证**。执行选址分析：根据设施类型和权重，计算每个候选小区的匹配得分。

```
POST /api/site-analysis
Content-Type: application/json

{
  "selectedKeys": ["hospital", "primary_school", "park", ...],   // 设施类型数组（必填，取值见下方"可用设施类型"）
  "typeSettings": {                                       // 各设施的半径和重要度（必填）
    "hospital":        { "defaultRadius": 3, "importance": 5, "selected": true },
    "primary_school":  { "defaultRadius": 1, "importance": 3, "selected": true }
  },
  "weights": {                                            // 可选，各设施类型的权重（0-10）
    "hospital": 1.2,
    "primary_school": 1.0
  }
}

// 成功 200
{
  "error": null,
  "coverage": {                                           // GeoJSON Feature (Polygon 或 MultiPolygon)
    "type": "Feature",
    "geometry": { "type": "Polygon", "coordinates": [[[lng,lat],...]] },
    "properties": {}
  },
  "matchedXiaoqu": [                                      // 匹配的小区，按得分降序
    {
      "id": "string",
      "name": "string",
      "lng": 108.xxx,
      "lat": 21.xxx,
      "score": 85.5,
      "breakdown": { "hospital": 40, "primary_school": 30, "park": 15.5 }
    }
  ],
  "facilityPoi": {                                        // 每种设施在覆盖范围内的具体 POI 点
    "hospital": [{ "id":"", "name":"", "lng":0, "lat":0, "district":"" }],
    "primary_school": [...]
  }
}

// 失败
400 { "error": "缺少必要参数: selectedKeys, typeSettings" }
400 { "error": "未知设施类型: xxx，可用类型: hospital, primary_school, ..." }
400 { "error": "设施类型 xxx 的权重值无效，应在 1-5 之间" }      // 实际校验的是 importance（控制器历史文案）
400 { "error": "设施类型 xxx 的半径无效，应为正数" }
400 { "error": "权重 xxx 无效，应为 0-10 之间的数字" }
422 { "error": "xxx 的覆盖范围与其他类型无重叠区域" }            // 业务计算错误
500 { "error": "选址分析计算失败" }
```

**字段说明**：

- `typeSettings[key].defaultRadius` — 缓冲半径，**单位为千米**（如 `3` 表示 3 公里）。后端通过 `importanceToRadius(defaultRadius, importance)` 计算实际半径 = `defaultRadius × importanceFactor`（factor 范围 0.4-2.2），再传入 `turf.buffer(..., { units: 'kilometers' })`。前端 `facilityConfig.js` 的 `defaultRadius` 默认值范围 0.5-3（千米）。
- `typeSettings[key].importance` — 重要度等级，整数 1-5（1=不重要，5=极重要）。同时影响半径（factor 0.4-2.2）。
- `typeSettings[key].selected` — 是否选中该设施类型参与分析，布尔值。
- `weights[key]` — 可选，设施类型的权重因子。**键名与设施类型一致**（如 `hospital` / `primary_school`，不是 `healthcare` / `education`）。合法范围 0-10，未提供时使用 `scoringService.DEFAULT_WEIGHTS`（默认值 0.6-1.2）。最终得分 = `Σ(score × weight) / Σ(weight)`。

**校验规则**：

- `typeSettings[key].importance` 必须在 1-5（控制器实际错误文案为"权重值无效"，实指 importance）
- `typeSettings[key].radius`（如提供）必须为正数 — **注意**：控制器校验的是 `setting.radius`，但前端实际传 `setting.defaultRadius`，所以此校验在生产中不触发。新增客户端应使用 `defaultRadius` 字段。
- `weights[key]` 必须在 0-10
- `selectedKeys` 中的类型必须在可用设施类型列表中（`hospital / primary_school / middle_school / park / bus_station / mall`）
- 业务错误（覆盖范围无重叠等）返回 422 不返回 400

**可用设施类型**：`hospital` / `primary_school` / `middle_school` / `park` / `bus_station` / `mall`

---

## 4. 设施数据

**模块**：`backend/routes/facilities.js` + `backend/controllers/facilitiesController.js`
**格式**：RESTful

> 设施数据直接返回 JSON 文件原始内容（数组），**不做包装**。设施类型与文件映射见 `facilitiesRepository.FILE_MAP`。

### GET /api/facilities/xiaoqu

**需要认证**。获取所有候选小区列表。

```
GET /api/facilities/xiaoqu

// 成功 200
[
  { "id": "string", "name": "string", "lng": 108.xxx, "lat": 21.xxx, "district": "钦南区" },
  ...
]

// 失败
500 { "error": "获取小区数据失败" }
```

### GET /api/facilities/:type

**需要认证**。获取指定类型的设施 POI 数据。`:type` 取值见下方"可用设施类型"。

```
GET /api/facilities/hospital

// 成功 200
[
  { "id": "string", "name": "string", "lng": 108.xxx, "lat": 21.xxx, "district": "钦南区" },
  ...
]

// 失败
404 { "error": "未知的设施类型: xxx" }
500 { "error": "获取设施数据失败" }
```

**可用设施类型**：

| :type 参数 | 数据文件 | 说明 |
|---|---|---|
| `hospital` | `qz_hospital.json` | 医院 |
| `primary_school` | `qz_primary_school.json` | 小学 |
| `middle_school` | `qz_middle_school.json` | 中学 |
| `park` | `qz_park.json` | 公园 |
| `bus_station` | `qz_bus_station.json` | 公交站 |
| `mall` | `qz_mall_and_supermarket.json` | 商场/超市 |

**数据字段统一**：所有设施类型返回的字段一致——`id` / `name` / `lng` / `lat` / `district`。无 `address` / `level` / `type` 等扩展字段（如需扩展需同步修改数据文件与本文档）。

**缓存**：`facilitiesRepository` 对数据文件做了内存缓存，TTL 5 分钟，过期自动重载。

---

## 5. 方案管理

**模块**：`backend/routes/plans.js` + `backend/controllers/plansController.js`
**格式**：RESTful

> 所有端点需认证。操作自动校验归属，非本人返回 403。响应**直接返回方案对象**，不包装在 `{ plan: ... }` 中。

### 方案对象结构

```ts
{
  "id": "string (crypto.randomUUID() 生成)",
  "userId": "string",
  "name": "string (1-50字符)",
  "selectedKeys": ["hospital", "primary_school"],           // 选址方案的设施类型数组（浸没方案为 []）
  "typeSettings": { "hospital": {"defaultRadius":3,"importance":5,"selected":true} },
  "weights": { "hospital": 1.2 },
  "savedXiaoqu": [                                          // 方案中保存的小区
    { "id":"", "name":"", "lng":0, "lat":0, "score":85, "breakdown":{}, "savedAt":"ISO8601" }
  ],
  "createdAt": "ISO8601",
  "updatedAt": "ISO8601",
  // ── 以下为浸没方案才有值的字段（选址方案为 null/[]）──
  "businessType": "site-selection",                         // 业务类型标识，枚举值："site-selection" | "flood" | undefined（旧数据无此字段）
  "waterLevel": null,
  "floodStatistics": null,
  "floodFeatures": [],
  "affectedFacilities": [],
  "totalLoss": null,
  "floodRiskLevel": null
}
```

**businessType 枚举值**：
- `"site-selection"` — 选址分析方案（`selectedKeys` / `typeSettings` / `weights` / `savedXiaoqu` 有值，浸没字段为 null/[]）
- `"flood"` — 浸没分析方案（`waterLevel` / `floodStatistics` / `floodFeatures` / `affectedFacilities` / `totalLoss` / `floodRiskLevel` 有值，选址字段为 [] 或默认值）
- `undefined` — 旧数据无此字段，前端按选址方案处理

### GET /api/plans

获取当前用户的所有方案（按更新时间降序）。

```
GET /api/plans

// 成功 200
[ { ...方案对象 }, ... ]

// 失败
500 { "error": "获取方案列表失败" }
```

### GET /api/plans/:id

获取单个方案详情。

```
GET /api/plans/1234567890

// 成功 200
{ ...方案对象 }

// 失败
403 { "error": "无权访问该方案" }
404 { "error": "方案不存在" }
500 { "error": "获取方案失败" }
```

### POST /api/plans

创建新方案。`userId` 强制从 token 获取，不接受客户端传入。

```
POST /api/plans
Content-Type: application/json

{
  "name": "string (1-50字符，正则: /^[\\u4e00-\\u9fa5a-zA-Z0-9_\\-\\s]{1,50}$/)",
  "selectedKeys": ["hospital", "primary_school"],
  "typeSettings": { "hospital": {"defaultRadius":3,"importance":5,"selected":true} },
  "weights": { "hospital": 1.2 }                            // 可选，键名与设施类型一致（参见 §3 字段说明）
}

// 成功 201
{ ...方案对象 }

// 失败
400 { "error": "缺少必要字段: name, selectedKeys" }
400 { "error": "方案名称只能包含中文、字母、数字、下划线、连字符和空格，且长度不超过 50 字符" }
409 { "error": "方案名称已存在" }
500 { "error": "创建方案失败" }
```

### PUT /api/plans/:id

更新方案（部分字段）。`userId` 保持不变。

```
PUT /api/plans/1234567890
Content-Type: application/json

{ "name": "新方案名" }                                       // 可选，部分更新

// 成功 200
{ ...方案对象 }

// 失败
403 { "error": "无权修改该方案" }
404 { "error": "方案不存在" }
409 { "error": "方案名称已存在" }
500 { "error": "更新方案失败" }
```

**可更新字段白名单**（见 `plansRepository.PLAN_UPDATE_FIELDS`）：`name` / `selectedKeys` / `typeSettings` / `weights` / `savedXiaoqu` / `businessType` / `waterLevel` / `floodStatistics` / `floodFeatures` / `floodRiskLevel` / `affectedFacilities` / `totalLoss`

### DELETE /api/plans/:id

```
DELETE /api/plans/1234567890

// 成功 204 (no body)

// 失败
403 { "error": "无权删除该方案" }
404 { "error": "方案不存在" }
500 { "error": "删除方案失败" }
```

### POST /api/plans/:id/xiaoqu

向方案中保存一个小区。

```
POST /api/plans/1234567890/xiaoqu
Content-Type: application/json

{
  "xiaoqu": {
    "id": "string",
    "name": "string",
    "lng": 108.xxx,
    "lat": 21.xxx,
    "score": 85.5,
    "breakdown": { "hospital": 40, "primary_school": 30 },
    "selectionCriteria": {                                   // 可选，记录选址条件
      "selectedTypes": ["hospital", "primary_school"],
      "typeSettings": { ... }
    }
  }
}

// 成功 200
{ ...方案对象 }

// 失败
400 { "error": "缺少小区信息" }
403 { "error": "无权修改该方案" }
404 { "error": "方案不存在" }
500 { "error": "保存小区失败" }
```

### DELETE /api/plans/:id/xiaoqu/:xiaoquId

从方案中移除指定小区。

```
DELETE /api/plans/1234567890/xiaoqu/xiaoqu-001

// 成功 200
{ ...方案对象 }

// 失败
403 { "error": "无权修改该方案" }
404 { "error": "方案不存在" }
500 { "error": "移除小区失败" }
```

---

## 6. 标注管理

**模块**：`backend/routes/markers.js` + `backend/controllers/markersController.js`
**格式**：RESTful

> 所有端点需认证。创建时 `userId` 强制从 token 获取。更新/删除校验归属。响应**直接返回标注对象**，不包装在 `{ marker: ... }` 中。

### 标注对象结构

```ts
{
  "id": "string (crypto.randomUUID() 生成)",
  "name": "string",
  "lng": 108.xxx,
  "lat": 21.xxx,
  "note": "string",                  // 备注，可选
  "userId": "string",
  "createdAt": "ISO8601",
  "updatedAt"?: "ISO8601"            // 更新时才有
}
```

### GET /api/markers

获取当前用户的全部标注。

```
GET /api/markers

// 成功 200
[ { ...标注对象 }, ... ]

// 失败
500 { "error": "获取标注列表失败" }
```

### GET /api/markers/:id

```
GET /api/markers/1234567890

// 成功 200
{ ...标注对象 }

// 失败
404 { "error": "标注不存在" }
500 { "error": "获取标注失败" }
```

### POST /api/markers

创建新标注。

```
POST /api/markers
Content-Type: application/json

{
  "name": "string (必填)",
  "lng": 108.xxx (必填),
  "lat": 21.xxx (必填),
  "note": "string (可选)"
}

// 成功 201
{ ...标注对象 }

// 失败
400 { "error": "缺少必要字段: name, lng, lat" }
500 { "error": "创建标注失败" }
```

### PUT /api/markers/:id

更新标注。

```
PUT /api/markers/1234567890
Content-Type: application/json

{ "name": "新名称", "note": "新备注" }

// 成功 200
{ ...标注对象 }

// 失败
403 { "error": "无权操作他人标注" }
404 { "error": "标注不存在" }
500 { "error": "更新标注失败" }
```

**可更新字段白名单**（见 `markersRepository.MARKER_UPDATE_FIELDS`）：`name` / `lng` / `lat` / `type` / `note`

### DELETE /api/markers/:id

```
DELETE /api/markers/1234567890

// 成功 204 (no body)

// 失败
403 { "error": "无权操作他人标注" }
404 { "error": "标注不存在" }
500 { "error": "删除标注失败" }
```

---

## 7. 浸没分析

**模块**：`backend/routes/gcs.js` + `backend/controllers/floodAnalysisController.js`
**格式**：GCS 标准（`{ code, data, message }`）

> 所有端点需认证（`router.use(authenticate)`）。核心机制：**向上取档**——传入 `waterLevel` 时，匹配数据中 `>=` 请求值的最低档位。例如请求 2.5m，数据档位有 2.0/3.0/5.0，则返回 3.0m 的数据。

### GET /api/gcs/water-levels

获取可用水位档位和水文基准信息。

```
GET /api/gcs/water-levels

// 成功 200
{
  "code": 200,
  "data": {
    "baseLevels": [0, 0.5, 1.0, 1.5, 2.0, 2.5, 3.0, 3.5, 4.0, 5.0],  // 可用水位档位(米)
    "simulationRange": { "min": 0, "max": 5.0 },
    "tidalStations": [                                           // 参考验潮站数据
      { "name": "北海站", "meanSeaLevel": 1.3 },
      { "name": "钦州站", "meanSeaLevel": 1.5 }
    ]
  },
  "message": "success"
}

// 失败
500 { "code": 500, "data": null, "message": "获取水位数据失败" }
```

### GET /api/gcs/flood-areas

获取指定水位的淹没区域。

```
GET /api/gcs/flood-areas?waterLevel=2.5

// 成功 200（指定 waterLevel 时）
{
  "code": 200,
  "data": {
    "waterLevel": 2.5,                                        // 实际使用的水位档位
    "requestedWaterLevel": 2.5,                               // 请求的水位
    "actualWaterLevel": 2.5,                                  // 实际档位（>= 请求值，可能不同于 requestedWaterLevel）
    "riskLevel": "中风险",                                   // 风险等级: 无风险/低风险/中风险/高风险/极高风险/灾难级
    "features": [                                             // GeoJSON FeatureCollection
      {
        "type": "Feature",
        "geometry": { "type": "Polygon", "coordinates": [[[lng,lat],...]] },
        "properties": {
          "port": "钦州港",                                  // 所属港口
          "areaName": "钦州港码头前沿低洼区",                // 区域名称
          "waterLevel": 2                                     // 该区域对应水位
        }
      }
    ]
  },
  "message": "success"
}

// 成功 200（未指定 waterLevel 时，返回所有档位的淹没范围数组）
{
  "code": 200,
  "data": [
    { "waterLevel": 2, "riskLevel": "低风险", "features": [...] },
    { "waterLevel": 5, "riskLevel": "高风险", "features": [...] }
  ],
  "message": "success"
}

// 成功 200（指定 waterLevel 超出数据范围时，返回空 features）
{
  "code": 200,
  "data": {
    "waterLevel": 99,
    "riskLevel": "无",
    "features": []
  },
  "message": "success"
}

// 失败
400 { "code": 400, "data": null, "message": "水位参数无效" }   // waterLevel 非 NaN
500 { "code": 500, "data": null, "message": "获取淹没范围失败" }
```

**注意**：`features[].properties` 字段为 `port` / `areaName` / `waterLevel`，**不包含 `depth` 和 `area` 字段**（淹没面积在 `/flood-statistics` 端点的 `floodArea` 字段中）。

### GET /api/gcs/flood-statistics

获取指定水位的淹没统计数据。

```
GET /api/gcs/flood-statistics?waterLevel=2.5

// 成功 200（指定 waterLevel 时）
{
  "code": 200,
  "data": {
    "waterLevel": 2.5,                                        // 实际档位水位
    "riskLevel": "低风险",
    "riskLevelCode": 1,                                       // 风险等级数值码
    "floodArea": 0.85,                                        // 淹没面积(平方千米 km²)
    "averageDepth": 0.6,                                      // 平均深度(米)
    "maxDepth": 1.2,                                          // 最大深度(米)
    "affectedFacilities": 3,                                  // 受影响设施数量
    "affectedPorts": ["钦州港"],                              // 受影响港口列表
    "estimatedLoss": 200,                                     // 预估经济损失(万元)
    "description": "低洼区域开始淹没"                          // 文字描述
  },
  "message": "success"
}

// 成功 200（未指定 waterLevel 时，返回所有档位的统计数组）
{
  "code": 200,
  "data": [ { ...同上字段 }, ... ],
  "message": "success"
}

// 成功 200（指定 waterLevel 超出数据范围时）
{
  "code": 200,
  "data": null,
  "message": "未找到对应水位的统计数据"
}

// 失败
400 { "code": 400, "data": null, "message": "水位参数无效" }
500 { "code": 500, "data": null, "message": "获取统计数据失败" }
```

**单位**：`floodArea` 单位是 **km²（平方千米）**，不是 ㎡（平方米）。`averageDepth` / `maxDepth` / `waterLevel` 单位是**米**。`estimatedLoss` 单位是**万元**。

### GET /api/gcs/terrain-profiles

获取预定义的地形剖面数据。

```
GET /api/gcs/terrain-profiles

// 成功 200
{
  "code": 200,
  "data": [
    {
      "id": "profile-1",
      "name": "钦州港-龙门剖面",
      "points": [[lng, lat, elevation], ...]
    }
  ],
  "message": "success"
}

// 失败
500 { "code": 500, "data": null, "message": "获取剖面数据失败" }
```

### GET /api/gcs/facilities

获取浸没分析相关的港口设施清单。

> **字段命名注意（待修债务，详见 `待解决问题.md` D05）**：此端点返回 `longitude` / `latitude`（全称），与项目前端规范 `lng` / `lat`（缩写）不一致。原因是数据源 `facilityPoints.json` 使用全称。**这是已知债务，计划统一为 `lng` / `lat`**。当前前端通过 `src/types/crs.ts` 的 `normalizePoint()` 归一化处理，业务代码不直接处理 `longitude`。

```
GET /api/gcs/facilities

// 成功 200
{
  "code": 200,
  "data": [
    {
      "id": "string",
      "name": "string",
      "type": "码头",                                         // 码头/仓库/道路/油库
      "port": "钦州港",
      "longitude": 108.xxx,
      "latitude": 21.xxx,
      "elevation": 5.2,                                       // 海拔(米)
      "value": 1500,                                          // 资产价值(万元)
      "damageRate": 0.3                                        // 损害率(0-1)
    }
  ],
  "message": "success"
}

// 失败
500 { "code": 500, "data": null, "message": "获取设施数据失败" }
```

### POST /api/gcs/analysis/disaster

执行完整的灾害评估（淹没区域 + 设施影响 + 经济损失）。

> **字段命名注意（待修债务，同 §7 `/api/gcs/facilities`，详见 `待解决问题.md` D05）**：`affectedFacilities` 中的坐标字段为 `longitude` / `latitude`（全称），计划统一为 `lng` / `lat`。

```
POST /api/gcs/analysis/disaster
Content-Type: application/json

{ "waterLevel": 2.5 }

// 成功 200
{
  "code": 200,
  "data": {
    "waterLevel": 2.5,                                        // 实际档位水位
    "requestedWaterLevel": 2.5,                               // 请求水位
    "riskLevel": "中风险",
    "affectedFacilities": [                                   // 受影响设施列表
      {
        "id": "string",
        "name": "string",
        "type": "码头",
        "port": "钦州港",
        "longitude": 108.xxx,
        "latitude": 21.xxx,
        "elevation": 5.2,
        "value": 1500,                                        // 资产价值(万元)
        "damageRate": 0.3,
        "loss": 450                                           // 单项损失(万元) = value × damageRate
      }
    ],
    "totalLoss": 500                                          // 总损失(万元)
  },
  "message": "success"
}

// 成功 200（无受影响设施时）
{
  "code": 200,
  "data": {
    "affectedFacilities": [],
    "totalLoss": 0,
    "riskLevel": "无"
  },
  "message": "success"
}

// 失败
400 { "code": 400, "data": null, "message": "缺少水位参数" }
500 { "code": 500, "data": null, "message": "灾害评估失败" }
```

### 数据源说明（前端 Adapter 状态，2026-07-28）

**当前状态**：浸没分析前端模块**仅支持 mock 数据**，未接入真实后端 API。

- `floodAdapter.ts` 的 `api` 数据源分支统一 `throw new Error('[FloodAdapter] 真实 API 尚未接入，请先调用 setDataSource("mock")')`
  （`getWaterArea` / `getFloodAnalysis` / `getImpactAssessment` / `getDEM` 四个方法均如此）
- 后端实际存在 `/api/gcs/*` 系列端点（见本 § 各端点），但前端尚未通过 `floodAdapter` 调用它们
- Mock 数据来源：`public/data/*.json`（`flood-areas.json` / `flood-statistics.json` / `disaster.json` / `water-area.json`）

**接入真实 API 的步骤**：
1. 在 `floodAdapter.ts` 的 `api` 分支中实现真实 `fetch` 逻辑（对接 `/api/gcs/flood-areas`、`/api/gcs/flood-statistics`、`/api/gcs/analysis/disaster` 等）
2. 切换数据源：`floodAdapter.setDataSource('api')`

---

## 8. 预测分析

**模块**：`backend/routes/forecast.js` + `backend/controllers/forecastController.js`
**格式**：混合格式（GCS-like，成功无 `message` 字段，错误用 `error` 不是 `message`）

> **认证策略**：`/api/forecast/*` 不需要认证。预测数据视为公开数据，与需认证的业务模块（plans/markers/gcs 等）安全策略不同。此为稳定设计决策，变更需同步更新本文档和 `项目根基.md` §8.4。

### GET /api/forecast

获取预测分析总览。

```
GET /api/forecast

// 成功 200
{
  "code": 200,
  "data": {
    "overview": {
      "ports": ["qinzhou", "beihai", "fangchenggang"],
      "indicators": ["throughput", "berth", "traffic", "pressure"],
      "timeRange": { "start": "2023-01", "end": "2035-12" }
    }
  }
}

// 失败
500 { "code": 500, "error": "获取预测概览失败" }
```

### GET /api/forecast/map

获取特定时间点/指标的地图数据。

```
GET /api/forecast/map?indicator=throughput&time=2026-07&confidence=0.8

// 成功 200
{
  "code": 200,
  "data": {
    "indicator": "throughput",
    "time": "2026-07",
    "features": [ ... ]                                     // GeoJSON FeatureCollection
  }
}

// 失败
400 { "code": 400, "error": "缺少参数: indicator, time" }
500 { "code": 500, "error": "获取预测数据失败" }
```

### GET /api/forecast/timeseries

获取时序预测数据。

```
GET /api/forecast/timeseries?indicator=throughput&portId=qinzhou&start=2023-01&end=2026-12&granularity=month&confidence=0.8

// 成功 200
{
  "code": 200,
  "data": {
    "historical": [
      { "time": "2023-01", "value": 1200000, "type": "actual" },
      ...
    ],
    "predicted": [
      { "time": "2026-07", "value": 1350000, "confidence": 0.85, "type": "predicted" },
      ...
    ]
  }
}

// 失败
500 { "code": 500, "error": "获取时序数据失败" }
```

### GET /api/forecast/indicator/:type

获取单个指标的详情。

```
GET /api/forecast/indicator/throughput?time=2026-07&portId=qinzhou&confidence=0.8

// 成功 200
{ "code": 200, "data": { ... } }

// 失败
500 { "code": 500, "error": "获取指标数据失败" }
```

### GET /api/forecast/:portId

获取特定港口的预测数据。**该路由必须放在最后注册**，避免吞噬 `/map`、`/timeseries` 等路径。

```js
// ❌ 错误：/:portId 在前会吞噬后续路由
router.get('/:portId', getPortForecast)   // 先匹配，/map 永远到不了
router.get('/map', getForecastMapData)

// ✅ 正确：/:portId 放最后（backend/routes/forecast.js 实际顺序）
router.get('/map', getForecastMapData)
router.get('/timeseries', getTimeSeriesData)
router.get('/indicator/:type', getIndicatorData)
router.get('/:portId', getPortForecast)    // 最后注册
```

```
GET /api/forecast/qinzhou?indicator=throughput&start=2024-01&end=2026-12

// 成功 200
{ "code": 200, "data": { ... } }

// 失败
500 { "code": 500, "error": "获取港口预测失败" }
```

---

## 9. 健康检查

### GET /api/health

无需认证。

```
GET /api/health

// 成功 200
{ "status": "ok" }
```

---

## 附录：各模块快速索引

| 模块     | 路由前缀             | 端点数 | 认证  |  格式   | 源文件                   |
| -------- | -------------------- | :----: | :---: | :-----: | ------------------------ |
| 认证     | `/api/auth`          |   4    | 混合  | RESTful | `routes/auth.js`         |
| 选址分析 | `/api/site-analysis` |   1    |  需   | RESTful | `routes/siteAnalysis.js` |
| 设施数据 | `/api/facilities`    |   2    |  需   | RESTful | `routes/facilities.js`   |
| 方案管理 | `/api/plans`         |   7    |  需   | RESTful | `routes/plans.js`        |
| 标注管理 | `/api/markers`       |   5    |  需   | RESTful | `routes/markers.js`      |
| 浸没分析 | `/api/gcs`           |   6    |  需   | GCS标准 | `routes/gcs.js`          |
| 预测分析 | `/api/forecast`      |   5    |  否   |  混合   | `routes/forecast.js`     |
| 健康检查 | `/api/health`        |   1    |  否   | RESTful | `app.js` (内联)          |

**端点总数**：31

**认证模块说明**：
- `auth` 模块标注为"混合"是因为 `register`/`login`/`logout` 无需认证，`me` 需认证
- `forecast` 模块标注为"否"是因为预测数据视为公开数据，无需认证
- `health` 是系统检查端点，无需认证

---

> **维护说明**: 本文档描述 API 的稳定契约，只在 API 大版本升级时变更。如发现代码与本文档不一致，应以代码为准并提 issue 更新本文件。具体的 bug、待修问题、技术债务记录在 `待解决问题.md` 和 `技术债务清单.md` 中，不在本文档描述。
