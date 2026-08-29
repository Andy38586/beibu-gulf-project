# 北部湾港智慧选址分析平台（Beibu Gulf WebGIS）

面向智慧港口场景的全栈 WebGIS 应用：**选址分析、吞吐量预测、洪涝三维模拟**三大业务模块，OpenLayers 2D / Cesium 3D 双引擎渲染，业务与地图引擎解耦、零改动切换。

- **在线演示**：<https://beibu-gulf.duckdns.org/>（首屏静态资源约 1.1MB，Cesium 5.7MB 懒加载移出首屏关键路径）
- **定位**：验证「可扩展的 GIS 系统架构」的工程化项目——分层架构、依赖守护、CI 门禁、契约化接口，而非单纯可视化 Demo

---

## 功能特性

### 1. 选址分析（2D 空间运算）

- 基于 Turf.js 的多缓冲区叠加与点面判断，覆盖 6 类设施、**983 个 POI**，rbush 空间索引加速范围查询
- 可达性衰减评分模型（线性 / 指数 / 阶梯三档，生产链路现采用线性衰减），对 **557 个小区**输出 TOP10 排序与雷达图可视化

### 2. 预测分析（趋势可视化）

- 2021–2031 月 / 年双粒度时间轴 + 播放动画；趋势折线 / 三港对比柱状 / 地图热力三视图联动
- 预测模型：季节分解 + 线性回归，三港离线回测 **MAPE 1.4%–2.3%**（`tools/throughput_model.cjs`）
- ECharts 异步加载（537KB 移出首屏）+ 请求竞态守卫（AbortController）+ LRU 缓存

### 3. 洪涝三维模拟（3D 浸没演算）

- Cesium 真实地形渲染：自建 GDAL → CTB 切片管线，**3800+ 地形瓦片**
- 双计算链路：FastAPI 在线演算（真 DEM + scipy 8 连通性淹没）+ **251 档水位预计算表**（0–25m、0.1m 步长），滑块任意档位查表 0.2s 秒回
- 水面 / 淹没范围 / 受影响设施三层结果渲染

## 技术栈

| 层       | 选型                                    | 说明                                                                |
| -------- | --------------------------------------- | ------------------------------------------------------------------- |
| 前端     | Vue 3 + TypeScript + Vite + Pinia       | Composition API，分层架构（见下）                                   |
| 地图 2D  | OpenLayers                              | 低功耗 / 低需求场景默认引擎                                         |
| 地图 3D  | Cesium                                  | 按需懒加载，不常驻首屏                                              |
| 图表     | ECharts                                 | 仅预测页异步加载                                                    |
| 后端     | Node.js + Express 5                     | routes → controllers → services → repositories 分层                 |
| 在线演算 | Python + FastAPI                        | 真 DEM 淹没演算，仅重计算场景                                       |
| 数据     | JSON / GeoJSON                          | PostgreSQL + PostGIS v3 栈已就绪（`docker-compose.v3.yml`），演进中 |
| 部署     | Docker Compose + Nginx + GitHub Actions | 双容器 + HTTPS 证书自动续期                                         |

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

# 3. 一键启动：前端 Vite (5173) + Express (3000) + 洪涝服务 (8000)
npm run dev:all
```

访问 <http://localhost:5173>。Express 支持可选 `.env`（后端目录），无配置时以默认参数启动。

## 测试与质量门禁

```bash
npm test                       # 前端 Vitest（41 文件 / 280 用例）
npm run test --prefix backend  # 后端 Vitest（20 文件 / 216 用例）
npm run lint                   # ESLint（0 告警基线）
npm run typecheck              # vue-tsc 全量类型检查
npm run cruise                 # dependency-cruiser 分层依赖守护
npm run build:analyze          # 构建体积分析（rollup-plugin-visualizer）
```

CI（GitHub Actions）：lint + 类型检查 + 双端测试 + API 契约校验 + 依赖约束 + gitleaks 密钥扫描 + 自动部署，全部通过才允许合入。

## 部署

```bash
docker compose up -d --build
```

双容器架构：`app`（前端静态资源 + Node API，Nginx 80/443 反代）+ `flood-service`（FastAPI 在线演算）。生产环境由 CI 自动部署至云服务器，HTTPS 证书自动续期。

## 文档

完整设计文档在 `docs/`，建议阅读顺序：

1. [`docs/根基文档/项目全景.md`](docs/根基文档/项目全景.md) — 项目身份、技术选型、架构分层
2. [`docs/根基文档/核心流程与数据流.md`](docs/根基文档/核心流程与数据流.md) — 从用户点击到结果显示的源码导读
3. [`docs/根基文档/Code-Wiki.md`](docs/根基文档/Code-Wiki.md) — 文件清单
4. [`docs/根基文档/开发指南与决策.md`](docs/根基文档/开发指南与决策.md) — 开发规范与决策记录

## 诚实性说明

本项目遵循「凡合成 / 模拟 / 占位主动先说」原则：预测模块页面演示数据为确定性种子合成的示意数据（模型本身的离线回测指标真实可复现，见 `tools/throughput_model.cjs`）；洪涝在线演算使用真实 DEM。已知妥协与演进路线见项目文档。
