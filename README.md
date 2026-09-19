# 北部湾港智慧选址分析平台（Beibu Gulf WebGIS）

面向智慧港口场景的全栈 WebGIS 应用：**选址分析、吞吐量预测、洪涝三维模拟**三大业务模块，OpenLayers 2D / Cesium 3D 双引擎渲染，业务与地图引擎解耦、零改动切换。

- **在线演示**：<https://beibu-gulf.duckdns.org/>（首屏静态资源约 1.1MB，Cesium 5.7MB 懒加载移出首屏关键路径）
- **定位**：验证「可扩展的 GIS 系统架构」的工程化项目——分层架构、依赖守护、CI 门禁、契约化接口，而非单纯可视化 Demo

---

## 功能特性

### 1. 选址分析（2D 空间运算）

- 基于 Turf.js 的多缓冲区叠加与点面判断，覆盖 6 类设施、**2,846 个 POI**（三城库内口径，含 port_pier 196），rbush 空间索引加速范围查询
- 可达性衰减评分模型（线性 / 指数 / 阶梯三档，生产链路现采用线性衰减），对 **2,456 个小区**输出 TOP10 排序与雷达图可视化

### 2. 预测分析（趋势可视化）

- 2021–2031 月 / 年双粒度时间轴 + 播放动画；趋势折线 / 三港对比柱状 / 地图热力三视图联动
- 预测模型：季节分解 + 线性回归，三港离线回测 **MAPE（滚动原点 s12）：cargo 6.75~12.15%、container 12.26~18.39%**（钦州/北海/防城港；训练 2021-01~2024-12，验证 2025-01~2026-06 不参与拟合；平陆运河未建模，完整口径见 `tools/README.md`）
- ECharts 异步加载（537KB 移出首屏）+ 请求竞态守卫（AbortController）+ LRU 缓存

### 3. 洪涝三维模拟（3D 浸没演算）

- Cesium 真实地形渲染：自建 GDAL → CTB 切片管线，**49,053 个 `.terrain` 瓦片**（83MB，heightmap-1.0 规范、65×65 uint16）
- 淹没范围一次派生：**251 档水位预计算表**入 PostGIS `flood_levels`（0–25m、0.1m 步长），滑块任意档位查表秒回；档位一律**向上取**（宁可高估风险）。⚠️ 曾有的 FastAPI 在线演算链路已于 2026-09-10 退役（见「技术栈」表下说明），现网为单链路查表
- 水面 / 淹没范围 / 受影响设施三层结果渲染

## 技术栈

| 层       | 选型                                                 | 说明                                                                                                                                                                                                                                                                          |
| -------- | ---------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 前端     | Vue 3 + TypeScript + Vite + Pinia                    | Composition API，分层架构（见下）                                                                                                                                                                                                                                             |
| 地图 2D  | OpenLayers                                           | 低功耗 / 低需求场景默认引擎                                                                                                                                                                                                                                                   |
| 地图 3D  | Cesium                                               | 按需懒加载，不常驻首屏                                                                                                                                                                                                                                                        |
| 图表     | ECharts                                              | 仅预测页异步加载                                                                                                                                                                                                                                                              |
| 后端     | Node.js + NestJS（TypeScript）                       | controller → service → repository 三层，pg 仅 repository 层                                                                                                                                                                                                                   |
| 在线演算 | ~~Python + FastAPI~~ **已退役**（2026-09-10 阶段 4） | 容器 4→3，重计算改为「PostGIS 查表 + 离线 Python 数据管线」（`tools/dem-pipeline/`、`tools/flood/`）。⚠️ 代码侧尚存退役残留：`dev:server` 仍 `run-p dev:nest dev:flood`、`ci:local` 仍含 `test:algorithm`（见 `package.json` scripts），启动 `dev:all` 会去拉已下线的 uvicorn |
| 数据     | PostgreSQL + PostGIS + 静态 JSON                     | 库已承载选址/方案/收藏/洪涝查询（空间算子下沉库内）；预测/地形/静态资源为文件源                                                                                                                                                                                               |
| 部署     | Docker Compose + Nginx + GitHub Actions              | 支持挂载 TLS 证书启用 HTTPS（手动），已预留 ACME 挑战目录                                                                                                                                                                                                                     |

## 架构

前端采用 **L0–L8 单向依赖分层**，依赖方向由 dependency-cruiser 在 CI 中强制守护；业务模块经 manifest 注册、互不引用：

```
L0 types      纯类型声明（零运行时依赖）
L1 shared     通用工具 / composable / 基础组件
L2 stores     Pinia 全局状态
L3 services   数据访问（adapter / API 封装）
L4 visualization  通用图表资产
L5 core       地图核心 + 布局基座
L6 business   业务模块（选址 / 预测 / 洪涝，互不依赖）
L7 views      页面装配
L8 entry      main / router / App
```

**双引擎抽象**：`MapRenderer` 接口 + OL / Cesium 双实现，业务经接口操作地图，引擎切换业务零改动；Cesium 单例管理、闲置自动销毁释放 WebGL 上下文。

**请求铁律**：API 一律走统一入口 `useApiRequest`（超时 / 重试 / 竞态 / 信封解包），静态资源走 `loadStatic`，边界 zod 校验，禁止业务组件裸 fetch。

**跨端一致性实际由两层守护，强度不同，别混**：**路由与业务域**由 `routes-audit` 守卫在 CI 双向比对（controller 装饰器 ↔ `backend/src/routes.manifest.ts` ↔ 前端 `MODULE_BY_PATH_PREFIX` ↔ 部署侧 `VITE_USE_NEST_MODULES`，漏配即 exit 1）；**响应字段**则是前端 zod 在运行时与单测里校验 + `npm run types:check` 保证「每个 schema 都有 `z.infer` 导出不被测试漏掉」——**该脚本只读前端 `schemas.ts`，不比对后端响应形状**，字段跨端一致仍需人工核对两侧（快照文件 `api-contract.json` 目前无消费者）。

## 快速开始

环境要求：Node `^22.18.0 || >=24.12.0`。生产链只需 Node + Docker（PostGIS）；**Python 不再是运行时依赖**——淹没演算已改为离线管线产出的 PostGIS 档位表，仅重跑数据生产时才需要 Python（见 `tools/dem-pipeline/`、`tools/README.md`）。

```bash
# 1. 安装依赖
npm install

# 2. 起数据库（PostGIS）
docker compose -f docker-compose.v3.yml up -d

# 3. 启动前端 (5173) 与后端 (3000)
npm run dev                    # 前端 Vite
npm --prefix backend run start:dev   # 后端 NestJS
```

> ⚠️ 仓库里仍有 `npm run dev:all` / `dev:server` / `dev:flood`，它们会去拉**已退役的 FastAPI 洪涝服务**（`dev:server = run-p dev:nest dev:flood`）——本地开发请用上面两条命令，别用 `dev:all`。

访问 <http://localhost:5173>。NestJS 读可选 `backend/.env`；缺必填项（如 JWT_SECRET）启动时 fail fast，不带弱配置起服务。

## 测试与质量门禁

```bash
npm test                       # 前端 Vitest（64 个 *.test.ts，用例数以本地实跑输出为准）
npm run test --prefix backend  # 后端 Vitest（29 个 *.spec.ts）
npm run test:tools             # 守卫自身的测试（vitest，tools/ 下）
npm run lint                   # ESLint（0 告警基线）
npm run typecheck              # vue-tsc 全量类型检查
npm run cruise                 # dependency-cruiser 分层依赖守护
npm run guard:v3               # 9 项 v3 守卫（全名见 tools/README.md 的 v3-guard 行）
npm run tmp:clean              # 清空 .local/tmp（临时文件唯一落点）
npm run build:analyze          # 构建体积分析（rollup-plugin-visualizer）
```

CI（GitHub Actions）：8 个 job，各自实际内容如下（**以 `.github/workflows/ci.yml` 为准**）——`changes` 变更探测；`audit` 根与 Nest 两侧 `npm audit`（high+ 阻断）；`static-checks` 跑 9 项 v3 守卫、格式、lint、stylelint、cruise 分层契约、API 契约自检、双侧 typecheck、gitleaks 密钥扫描、`.env` 未被跟踪、覆盖率基线冻结；`frontend-tests` 前端测试（覆盖率 + 棘轮 + watchdog）与 `test:tools`；`commit-discipline` 校验 `fix:`/`refactor:` 提交必须含 test 文件；`backend-tests` 真库 seed + Nest 测试（门控套件必须真跑）+ 后端覆盖率棘轮；`build-push-images` 构建推镜像；`deploy` 服务器上只 `docker compose pull`，不在机上构建。

## 部署

```bash
docker compose up -d --build
```

容器架构：`app`（前端静态资源 + Nginx 80/443 反代）+ `nest`（NestJS API）+ `postgis`（PostgreSQL / PostGIS）。生产环境由 CI 自动部署至云服务器；HTTPS 需手动挂载 TLS 证书（`./certs/`），已预留 ACME 挑战目录。

## 文档

完整设计文档在 `docs/`，建议阅读顺序：

1. [`docs/根基文档/项目全景.md`](docs/根基文档/项目全景.md) — 项目身份、技术选型、架构分层
2. [`docs/根基文档/核心流程与数据流.md`](docs/根基文档/核心流程与数据流.md) — 从用户点击到结果显示的源码导读
3. [`docs/根基文档/开发指南与决策.md`](docs/根基文档/开发指南与决策.md) — 开发规范与决策记录
4. [`docs/根基文档/代码知识库.md`](docs/根基文档/代码知识库.md) — 文件清单

不入库的本机资料（agent 报告、临时文件、待删暂存）统一放在 `.local/`，仓库根目录禁止落临时文件——由 `guard:v3` 断言，详见 `.local/README.md`。

## 诚实性说明

本项目遵循「凡合成 / 模拟 / 占位主动先说」原则：预测模块页面演示数据为确定性种子合成的示意数据（模型本身的离线回测指标真实可复现，见 `tools/forecast/throughput_model.cjs`）；洪涝在线演算使用真实 DEM。已知妥协与演进路线见项目文档。
