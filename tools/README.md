# tools/ — 数据与工程脚本

**分类规则**：一类数据、一个文件就能干完的活 → 留在 `tools/` 根目录；需要多个文件协作的 → 单独建目录，
目录名即数据域。所有脚本一律从**仓库根目录**执行（脚本内部按自身位置定位仓库根，与 cwd 无关）。

## 目录速查（按数据域）

| 目录             | 数据域      | 里面是什么                                                                                 |
| ---------------- | ----------- | ------------------------------------------------------------------------------------------ |
| `db/`            | v3 数据库   | 业务/空间/淹没三套 schema、`db-import.mjs`（JSON→SQL 入库）、坐标系登记、pgRouting 镜像    |
| `roads/`         | 路网        | 端点切分 `roads-noding` → 拓扑重建 → 派生列与权重回填 → 连通性校验，一条链路按文件名顺序跑 |
| `flood/`         | 洪涝        | 用真 DEM 重建假数据、251 档淹没数据灌库、FastAPI 启动器                                    |
| `poi/`           | POI（高德） | 抓取（全量/按网格缓存）、市区口径清洗                                                      |
| `osm/`           | OSM PBF     | 海岸线 / 耕地 / 工业用地 / 路网提取，配 `osmconf-v3.ini`（ogr2ogr）                        |
| `dem-pipeline/`  | DEM 地形    | 拼接 → 填洼 → 重投影 → 重切片，`01`~`09` 按序号执行                                        |
| `gis-import/`    | GIS 入库    | GeoJSON→PostGIS、港口 POI、入库后质检 `verify.mjs`                                         |
| `forecast/`      | 吞吐量预测  | 模型产物生成 `throughput_model.cjs`、活跃度派生 `derive-activity.mjs`（详见该目录 README） |
| `data-download/` | 原始数据    | 陆地 DEM / OSM / 海底地形下载（网络可用时跑）                                              |
| `perf-bench/`    | 性能基准    | 选址覆盖分析、服务端压测                                                                   |
| `diag/`          | 诊断        | 淹没多边形 vs DEM 高程基准、3D 页面实况抓取                                                |
| `v3-guard/`      | 质量守卫    | 编号外泄 / 分层契约 / 路由契约 / 体系自洽 / 临时文件卫生，5 项 CI 断言                     |

## 根目录单文件（工程与元工具）

| 文件                      | 用途                                                         |
| ------------------------- | ------------------------------------------------------------ |
| `gen-changelog.cjs`       | 从 git log 生成 CHANGELOG（`npm run changelog`）             |
| `token-stats.mjs`         | 设计 token 治理：死 token 与硬编码色值扫描（改样式前跑）     |
| `run-algorithm-tests.cjs` | 拉起 algorithm-service 的 pytest（`npm run test:algorithm`） |
| `setup-runtime.ps1`       | 换机一键重建运行时（venv / node，与仓库分离）                |

## 数据流水线（谁先谁后）

```
data-download/  →  osm/（提取）  ─┐
                                  ├→  gis-import/  →  db/（入库）  →  roads/（路网拓扑）
dem-pipeline/（DEM 处理）      ─┘                                  →  flood/（淹没档位）
                                                                   →  forecast/（预测产物）
```

每一步的产物是下一步的输入；`db/` 的 schema 是所有入库动作的前置。

## 常用入口

```bash
npm run forecast:model       # tools/forecast/throughput_model.cjs
npm run forecast:activity    # tools/forecast/derive-activity.mjs
npm run verify-gis           # tools/gis-import/verify.mjs
npm run dev:flood            # tools/flood/run-flood.cjs
npm run test:algorithm       # tools/run-algorithm-tests.cjs
npm run guard:v3             # tools/v3-guard/*.mjs（5 项守卫）
```

## 约定

- **输出物不进源码树**：脚本生成的 SQL / 报告 / 缓存一律写 `.local/tmp/`（`npm run tmp:clean` 清空），
  根目录由 `v3-guard/tmp-hygiene.mjs` 断言无临时文件残留。
- **密钥不外露**：需要 API Key 的脚本读 `tools/poi/.amap_key`（已 gitignore），禁止硬编码。
- **测试就近放**：脚本的测试放在同域目录的 `__tests__/` 下，由 `npm run test:tools` 统一跑。
