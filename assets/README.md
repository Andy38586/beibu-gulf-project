# legacy-backend 资产（老 Express 后端）

> **只读存档，不参与构建/门禁/部署**。v3 迁移（T6.3）Express 已由 NestJS 全面替代——
> 本目录保留 2026-09-03 时点的老 Express 代码（含 flood-service），供：
> 1. **双后端行为对照**：需要时起老服务（见下）与 Nest 对同一请求做 diff；
> 2. **契约/算法参照**：Nest 各模块的移植基准（T3.x 已逐行等价，此处留档备查）。
>
> 来源：git commit 499c6531 的 backend/ 树（git archive 提取），未做任何改动。

## 组成

| 路径 | 说明 |
| --- | --- |
| `app.js` / `index.js` | Express 应用装配与启动（端口 3000） |
| `controllers/` `routes/` `services/` `repositories/` `middleware/` `utils/` | 六功能域（auth/favorites/plans/forecast/flood/site-analysis）源码 + 测试 |
| `flood-service/` | 已被算法服务（algorithm-service）平移替代的 FastAPI 服务 |
| `package.json` | 老 Express 依赖清单 |

## 如何起老服务做对照（可选）

```bash
cd assets/legacy-backend
npm ci                  # 安装老依赖（node_modules 不随仓库提交）
PORT=3001 node index.js # 用 3001 避让现行 nest:3000
# 然后 curl http://localhost:3001/api/xxx 与 http://localhost:3000/nest-api/xxx 对比
```

> 注意：老服务依赖 `backend/data` 数据文件（现保留在 `backend/data`，未复制进资产；
> 起服务前将 `backend/data` 软链或复制到 `assets/legacy-backend/data`）。

## 维护规则

- **禁止**修改本目录（只读存档）；需要改动请复制到工作区再改。
- 本目录被 eslint/prettier/cruise/no-ephemeral/gitleaks 扫描忽略
  （配置见根 eslint.config.js / .prettierignore / .gitignore 相关条目）。