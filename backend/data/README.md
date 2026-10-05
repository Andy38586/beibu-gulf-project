# backend/data — 后端数据存储层

> 项目**只读静态数据**目录：forecast / flood 两类数据由 Nest 读模块经
> `backend/src/infra/files/data-files.service.ts` 读取；可写数据（users / markers / plans）已迁
> PostgreSQL（见 §三），本目录不再承载可写 JSON。

## 一、模块职责

data 目录承担两类数据：

1. **只读静态数据**：forecast 指标与模型产物、flood 洪涝预计算结果与 DEM 栅格，由 Nest 读模块（`modules/forecast`、`modules/flood`）读取后参与计算或直接返回前端。
2. **可写持久化数据**：已整体迁 PostgreSQL（plans / favorites / users 由 `backend/src/modules/*/repositories/*.repository.ts` 承担）；本目录**不存在可写 JSON**。

> 历史：老选址域（`site-selection/` POI 与 `siteAnalysisService`）已随 `db25009a`（2026-10-02）整体移除；
> 现役选址（`site-suitability` 域）的 POI/评分在 PostGIS，不读本目录。

## 二、目录结构

```
data/
├── forecast/                  # 吞吐量预测数据（modules/forecast 读取）
│   ├── index.json             #   指标索引/元信息
│   ├── cargo.json             #   货物吞吐量历史 + spatial（页面历史数据源）
│   ├── container.json         #   集装箱吞吐量历史 + spatial
│   ├── activity.json          #   港口活动（合成示意数据，文件自带 historical+forecast）
│   ├── berth.json             #   泊位（合成示意数据）
│   ├── traffic.json           #   交通（合成示意数据）
│   ├── container_model.json   #   集装箱模型产物
│   └── throughput_model.json  #   吞吐量模型产物（cargo 2026-2035 预测 + 回测 MAPE）
└── flood/                     # 洪涝预计算数据 + DEM 栅格（modules/flood 读取）
    ├── facilityPoints.json    #   受淹评估设施点
    ├── flood_levels.json.gz   #   251 档预计算表（0~25m/0.1m 步长）
    ├── floodStatistics.json   #   洪涝统计
    ├── water-area.json        #   水域
    ├── waterLevel.json        #   水位档位
    ├── terrainProfile.json    #   地形剖面
    └── dem/                   #   DEM 栅格（离线演算/3D 锚点用）
        ├── landsea_utm48n.tif   # **海陆一体**（陆=ASTER 填洼 + 海=SRTM15+ 水深，EGM96 正高，30m）
        │                        #   ← flood_engine / 设施高程 / 剖面 三处共用的那份地表（淹没链唯一权威）
        ├── landsea_utm48n_ell.tif  # 上件的椭球高版（+N，15-ellipsoid-shift.py 产物）——仅供
        │                        #   3D 资产锚点用（bridge-anchors.json / probe-bridge-vert.py），
        │                        #   淹没演算**不读它**（正高链与椭球链边界见 dem-pipeline README §三）
        └── .gitkeep             # 目录占位（栅格本体 gitignored，来源见 tools/dem-pipeline/README.md）
```

> `dem/` 下的 `.tif` 均 **gitignored**（体积 + 唯一原件在外部数据树；源路径、环境与复跑命令
> 见 `tools/dem-pipeline/README.md`）。重建调用链：`09b-srtm15-sea-grid.ps1`（海侧格网）→
> `06-sea-mask.py`（海掩膜三条判据）+ `06-restore-cut-dem.ps1`（陆地裁切）→
> `10-landsea-merge.py`（拼接）→ `11-seam-audit.py`（接缝审计）；载入顺序与基准换算见
> `tools/flood/engine/README.md`。
> 产物（`flood_levels.json.gz` / `floodStatistics.json` / `facilityPoints.json` /
> `terrainProfile.json`）的 metadata 里都写 `demSource` + `demMd5`，用于回指本次输入。

## 三、存储基础设施：`utils/fileStore.js`（已退役）

> ⚠️ **历史快照**：`backend/utils/fileStore.js` 随 Express 一起退役，**路径已不存在**。它曾是 data/ 可写文件的统一存储工厂（markers / plans / users 共用，含缓存与写锁）。
> 现状：plans / favorites / users 三类可写数据已迁入 PostgreSQL，由 `backend/src/modules/{plans,favorites,auth}/repositories/*.repository.ts` 承担读写；`@arch-note R-01` 的分层约束现由 `tools/v3-guard/structure-check.mjs` 与 dependency-cruiser 规则强制。

### `createFileStore(filePath, { useCache = true })`

返回 `{ sequential, readAll, writeAll }`：

- **`readAll()`**：命中缓存直接返回对象引用（`@audit-note DAT-7`：非深拷贝，避免每请求结构化克隆开销）；ENOENT 返回 `[]` 并缓存空数组。
- **`writeAll(data)`**：**原子写入**——先写 `${filePath}.tmp` 临时文件，再 `fs.rename` 替换；失败时清理临时文件。写成功后同步更新缓存。
- **`sequential(fn)`**：写锁（Promise 链式串行），保证写操作顺序执行，消除 TOCTOU 竞态。

### 缓存契约（`@audit-note DAT-7`）

- `readAll` 命中缓存返回对象引用（非深拷贝）。
- **调用方必须以不可变方式更新**（构造新数组/对象）后再 `writeAll`，避免原地修改污染缓存且不落盘。
- 当前 3 个调用方（markers / plans / users Repository）均已规范，无需加防御性深拷贝。

## 四、数据消费关系

### 静态数据（Nest 读模块）

- `modules/forecast` → `data/forecast/*.json`：经 `infra/files/data-files.service.ts` 读取（index/cargo/container/activity/berth/traffic + `*_model.json`），公开只读。
- `modules/flood` → `data/flood/*.json`：facilityPoints / floodStatistics / water-area / waterLevel / terrainProfile / flood_levels.json.gz，纯计算评估输入。
- ~~`siteAnalysisService` → `data/site-selection/qz_*.json` + `xiaoqu.json`~~：**已随 `db25009a` 整体移除**；现役选址 POI/评分在 PostGIS（`site-suitability` 域）。
- ~~`ports.json`~~ → 2026-08-29 回迁前端 `frontend/public/data/ports.json`（纯透传端点已删，港口与 boundary 同为前端静态参考数据）。

### 可写数据（已迁 PostgreSQL）

- plans / favorites / users 由 `backend/src/modules/{plans,favorites,auth}/repositories/*.repository.ts` 读写；
  历史 JSON 写入路径（users.json / markers.json / plans.json）已不存在。

## 五、数据生成工具

### `tools/flood/engine/` — 洪涝演算引擎（Python；FastAPI 微服务已退役）

> 现役形态：原独立微服务 `backend/flood-service/` 已删除（v3 收口）；引擎本体移至
> `tools/flood/engine/flood_engine.py`，产物仍是 `data/flood/` 的连通性淹没 GeoJSON。

- **`flood_engine.py`**：连通性淹没演算引擎。海平面抬升模型——水从海面（DEM NoData 区域）进入，只淹没与海面 8 连通的高程低于水位的区域。
  - 算法：`mask = (DEM <= level)` → 与 NoData(海域) 合并做连通域标注 → 保留「海域分量」中的淹没区。
  - 输入：`data/flood/dem/landsea_utm48n.tif`（海陆一体，优先；多级回退链见 `tools/flood/engine/README.md`）。
  - 降采样 4x（30m→120m，像元 ~6800万→~425万），单次演算秒级；模块级缓存 DEM（~17MB float32，只读一次）。
  - 输出：EPSG:4326 淹没多边形 GeoJSON FeatureCollection + 统计。
  - 依赖：numpy / scipy / rasterio（rasterio wheel 自带 GDAL）。
- ~~**`main.py`**：FastAPI 服务~~ **已退役**：现役在线演算由 NestJS 洪涝域承接（v3 收口）；
  历史启动/CORS 口径见 git 历史与 `docs/日志/快照/`。

### `backend/static/dem/` — 地形可视化产物

- `dem_hillshade.png` / `dem_hillshade.tif` / `dem_hillshade.wld`：DEM 山体阴影栅格，供前端 2D GeoTIFF 图层加载（`addGeoTIFFLayer`）。

## 六、依赖关系

- **Nest 读模块 → data**：`modules/forecast` / `modules/flood` 经 `data-files.service` 读静态 JSON（只读）。
- **在线可写数据（PostgreSQL）**：plans / favorites / users 走 `backend/src/modules/*/repositories`，不再经本目录。
- **离线演算 → data/flood/dem**：`tools/flood/engine/flood_engine.py` 读 DEM 栅格演算（产物回写 `data/flood/`）。
- **向第三方依赖**：Python 演算侧 numpy/scipy/rasterio；Nest 侧无本目录专属依赖。

## 七、关键约束（@arch-note）

| 标注        | 位置                                    | 约束                                                       |
| ----------- | --------------------------------------- | ---------------------------------------------------------- |
| 只读边界    | `infra/files/data-files.service.ts`     | backend/data 静态数据统一入口；只读，不接受任意路径输入     |
| `DATA_DIR`  | `infra/config/config.service.ts`        | 数据目录解析（env 优先，向上找 backend/data）               |
| ~~`R-01`~~  | ~~utils/fileStore.js~~（已退役）        | 可写数据已迁 PostgreSQL；分层约束由 structure-check/cruise 强制 |

## 八、备注

- DEM 栅格体积较大（`landsea_utm48n*.tif`），本目录以 `.gitkeep` 保留结构；大文件按需本地准备，
  来源与复跑见 `tools/dem-pipeline/README.md`。
- 洪涝演算引擎（`tools/flood/engine/`）为离线工具，不随 Node 后端启动；在线洪涝域只读其产物。
