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

- Cesium 真实地形渲染：自建 GDAL → CTB 切片管线，**3800+ 地形瓦片**
- 双计算链路：FastAPI 在线演算（真 DEM + scipy 8 连通性淹没）+ **251 档水位预计算表**（0–25m、0.1m 步长），滑块任意档位查表 0.2s 秒回
- 水面 / 淹没范围 / 受影响设施三层结果渲染

## 技术栈

| 层       | 选型                                    | 说明                                                                            |
| -------- | --------------------------------------- | ------------------------------------------------------------------------------- |
| 前端     | Vue 3 + TypeScript + Vite + Pinia       | Composition API，分层架构（见下）                                               |
| 地图 2D  | OpenLayers                              | 低功耗 / 低需求场景默认引擎                                                     |
| 地图 3D  | Cesium                                  | 按需懒加载，不常驻首屏                                                          |
| 图表     | ECharts                                 | 仅预测页异步加载                                                                |
| 后端     | Node.js + NestJS（TypeScript）          | controller → service → repository 三层，pg 仅 repository 层                     |
| 在线演算 | Python + FastAPI                        | 真 DEM 淹没演算，仅重计算场景                                                   |
| 数据     | PostgreSQL + PostGIS + 静态 JSON        | 库已承载选址/方案/收藏/洪涝查询（空间算子下沉库内）；预测/地形/静态资源为文件源 |
| 部署     | Docker Compose + Nginx + GitHub Actions | 支持挂载 TLS 证书启用 HTTPS（手动），已预留 ACME 挑战目录                       |

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

**请求铁律**：API 一律走统一入口 `useApiRequest`（超时 / 重试 / 竞态 / 信封解包），静态资源走 `loadStatic`，边界 zod 校验，禁止业务组件裸 fetch。前后端接口契约由脚本生成并在 CI 校验（`npm run types:check`）。

## 快速开始

环境要求：Node `^22.18.0 || >=24.12.0`；洪涝在线演算需 Python 3 + pip。

```bash
# 1. 安装依赖
npm install

# 2. 洪涝演算服务依赖（可选，仅在线演算链路需要）
pip install -r backend/flood-service/requirements.txt

# 3. 一键启动：前端 Vite (5173) + NestJS (3000) + 洪涝服务 (8000)
npm run dev:all
```

访问 <http://localhost:5173>。NestJS 读可选 `backend/.env`；缺必填项（如 JWT_SECRET）启动时 fail fast，不带弱配置起服务。

## 测试与质量门禁

```bash
npm test                       # 前端 Vitest（41 文件 / 280 用例）
npm run test --prefix backend  # 后端 Vitest（20 文件 / 216 用例）
npm run lint                   # ESLint（0 告警基线）
npm run typecheck              # vue-tsc 全量类型检查
npm run cruise                 # dependency-cruiser 分层依赖守护
npm run guard:v3               # v3 守卫：编号外泄 / 分层契约 / 路由契约 / 体系自洽 / 临时文件卫生
npm run tmp:clean              # 清空 .local/tmp（临时文件唯一落点）
npm run build:analyze          # 构建体积分析（rollup-plugin-visualizer）
```

CI（GitHub Actions）：lint + 类型检查 + 双端测试 + API 契约校验 + 依赖约束 + gitleaks 密钥扫描 + 自动部署，全部通过才允许合入。

## 部署

```bash
docker compose up -d --build
```

双容器架构：`app`（前端静态资源 + Node API，Nginx 80 反代）+ `flood-service`（FastAPI 在线演算）。生产环境由 CI 自动部署至云服务器；HTTPS 需手动挂载 TLS 证书（`./certs/`），已预留 ACME 挑战目录。

## 文档

完整设计文档在 `docs/`，建议阅读顺序：

1. [`docs/根基文档/项目全景.md`](docs/根基文档/项目全景.md) — 项目身份、技术选型、架构分层
2. [`docs/根基文档/核心流程与数据流.md`](docs/根基文档/核心流程与数据流.md) — 从用户点击到结果显示的源码导读
3. [`docs/根基文档/Code-Wiki.md`](docs/根基文档/Code-Wiki.md) — 文件清单
4. [`docs/根基文档/开发指南与决策.md`](docs/根基文档/开发指南与决策.md) — 开发规范与决策记录

不入库的本机资料（agent 报告、临时文件、待删暂存）统一放在 `.local/`，仓库根目录禁止落临时文件——由 `guard:v3` 断言，详见 `.local/README.md`。

## 诚实性说明

本项目遵循「凡合成 / 模拟 / 占位主动先说」原则：预测模块页面演示数据为确定性种子合成的示意数据（模型本身的离线回测指标真实可复现，见 `tools/forecast/throughput_model.cjs`）；洪涝在线演算使用真实 DEM。已知妥协与演进路线见项目文档。
