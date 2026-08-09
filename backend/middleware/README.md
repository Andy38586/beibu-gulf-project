# backend/middleware — 后端中间件层

> Express 中间件：JWT 认证校验与请求日志脱敏。
> 认证中间件保护需登录的路由；日志脱敏中间件在输出前打码敏感字段，防止凭据泄漏。

## 一、模块职责

middleware 提供两类横切关注点：

1. **认证**（`auth.js`）：JWT 签发与校验，token 读取（cookie 优先 + header 兼容），令牌吊销校验。
2. **日志脱敏**（`logSanitizer.js`）：递归打码 `password` / `token` / `secret` / `authorization` / `cookie` 等敏感字段，仅打日志不修改请求。

## 二、目录结构

```
middleware/
├── auth.js             # authenticate 中间件 + generateToken
├── logSanitizer.js     # sanitize 递归打码函数
└── __tests__/
    ├── auth.test.js
    └── logSanitizer.test.js
```

## 三、`auth.js` — JWT 认证

### 关键导出

- `authenticate(req, res, next)`：认证中间件，校验通过则 `req.user = { id, username }` 并 `next()`，失败返回 401。
- `generateToken(user)`：签发 JWT（有效期 7d，payload 含 `id` / `username` / `tokenVersion`）。

### 认证流程

1. **读取 token**（`@arch-note SEC-001`）：优先从 `req.cookies.auth_token` 读取；缺失时回退到 `Authorization: Bearer <token>` header。
2. **未提供 token** → 401「未提供认证令牌」。
3. **校验 token**：`jwt.verify(token, JWT_SECRET)` 解码；查 `userService.findById(decoded.id)` 验证用户存在。
4. **令牌吊销校验**（`@arch-note SEC-007`）：比对 `user.tokenVersion` 与 `decoded.tokenVersion`，不一致则 401「令牌已失效，请重新登录」（用户改密/登出后旧 token 立即失效）。
5. 校验通过 → `req.user = { id, username }` → `next()`。

### JWT_SECRET 强制约束

模块加载时即校验环境变量，不满足直接 `throw`（FATAL，进程退出）：

- **缺失** `JWT_SECRET`：报错并提示生成方式 `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`，参考 `backend/.env.example`。
- **长度不足 32 字符**：报错「JWT_SECRET 长度不足」。
- **弱密钥警告**（非 production/test 环境）：长度 <64 或匹配 `/^(test|dev|demo|example)/i` 时 `logger.warn`，仅适用本地开发，生产须用强密钥。

## 四、`logSanitizer.js` — 请求日志脱敏（d065）

> 仅打日志、不修改请求。password / token / secret / authorization / cookie 等敏感字段在输出前打码，防止未来请求日志泄漏凭据。

### 关键导出

- `sanitize(value, key='')`：递归打码敏感字段。

### 打码规则

- **敏感键匹配**：键名（小写）包含 `password` / `token` / `secret` / `authorization` / `cookie` 之一即视为敏感。
  - 字符串值：保留前 2 字符 + `***`（如 `"abc123"` → `"ab***"`）。
  - 非字符串值：直接替换为 `'***'`。
- **数组**：逐元素递归 `sanitize`。
- **对象**：逐键值递归 `sanitize(v, k)`。
- **原始值**（number/boolean/null 等）：原样返回。

### 输出

返回打码后的新结构（不修改入参），供日志输出消费。

### 打码示例

```js
sanitize({ username: 'alice', password: 'abc123', token: 'eyJhbGci...' })
// → { username: 'alice', password: 'ab***', token: 'ey***' }

sanitize([{ cookie: 'auth_token=xyz', data: { id: 1 } }])
// → [{ cookie: '***', data: { id: 1 } }]
```

非敏感字段（username / id / data 等）原样透传；仅匹配敏感键名的值被截断或替换。

## 五、Token 生命周期

| 阶段 | 触发           | 行为                                                                                                        |
| ---- | -------------- | ----------------------------------------------------------------------------------------------------------- |
| 签发 | 登录/注册成功  | `generateToken(user)` → payload 含 `id` / `username` / `tokenVersion`，有效期 7d；通过 HttpOnly Cookie 下发 |
| 校验 | 受保护路由请求 | `authenticate` 读 cookie/header → `jwt.verify` → `findById` → 比对 `tokenVersion`                           |
| 吊销 | 改密 / 登出    | `userService.updateTokenVersion` 自增版本号，旧 token 立即失效（无需黑名单）                                |
| 续期 | —              | 当前实现无 refresh 机制；过期后需重新登录                                                                   |

tokenVersion 不一致时返回 401「令牌已失效，请重新登录」，与「token 无效或已过期」区分，便于前端引导用户重新认证。

## 六、依赖关系

- `auth.js` → `jsonwebtoken`（JWT 签发/校验）、`services/userService.js`（findById 查用户 + tokenVersion）、`utils/logger.js`（弱密钥警告）。
- `logSanitizer.js`：无外部依赖，纯函数。
- **被依赖方**：`routes/` 中需登录的路由挂载 `authenticate`（如 plans / auth 相关）；日志中间件在 `app.js` 注册时配合 `sanitize` 使用。

## 六、关键约束（@arch-note）

| 标注       | 文件            | 约束                                                                                                               |
| ---------- | --------------- | ------------------------------------------------------------------------------------------------------------------ |
| `SEC-001`  | auth.js         | 优先从 cookie 读取 token，兼容 Authorization header；认证主通道是 HttpOnly Cookie（前端 `credentials: 'include'`） |
| `SEC-007`  | auth.js         | 校验 tokenVersion 实现令牌吊销；用户改密/登出后自增 tokenVersion，旧 token 失效                                    |
| `d065`     | logSanitizer.js | 请求日志脱敏中间件，仅打日志不修改请求；敏感字段递归打码                                                           |
| FATAL 校验 | auth.js         | JWT_SECRET 缺失 / 长度 <32 直接抛错终止启动；弱密钥仅开发环境 warn                                                 |

## 八、安全设计要点

- **HttpOnly Cookie**：token 不暴露给 JS，防 XSS 窃取；前端 `token` 仅内存占位符用于 `isAuthenticated` 判断，不参与请求传输。
- **令牌吊销**：基于 `tokenVersion` 版本号，无需维护黑名单，改密/登出即时失效。
- **密钥强度**：启动期强制校验，杜绝弱密钥进生产。
- **日志防泄漏**：脱敏中间件兜底，防止后续接入的请求日志意外记录凭据。

## 九、测试

`__tests__/auth.test.js`、`__tests__/logSanitizer.test.js`（vitest，覆盖 token 校验/吊销/脱敏递归等场景）。
