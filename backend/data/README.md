# backend/data — 后端数据存储层

> 项目静态数据与可写 JSON 存储的统一目录。
> 静态业务数据（forecast / site-selection / flood）由 services 直接 `readFile` 读取；可写数据（users / markers / plans）经 `utils/fileStore.js` 原子写入 + 缓存。

## 一、模块职责

data 目录承担两类数据：

1. **只读静态数据**：forecast 指标、site-selection POI、flood 洪涝预计算结果、markers/ports 地理要素，由 services 读取后参与计算或直接返回前端。
2. **可写持久化数据**：users / markers / plans 等 JSON 文件，经 `createFileStore` 工厂统一管理（原子写入 + 缓存 + 写锁）。

## 二、目录结构

```
data/
├── ports.json                 # 港口数据（后端单源，经 /api/ports 公开接口返回）
├── markers.json               # 地图标记（可写，经 fileStore）
├── forecast/                  # 吞吐量预测数据（forecastService 读取）
│   ├── index.json             #   指标索引/元信息
│   ├── cargo.json             #   货物吞吐量历史 + spatial（页面历史数据源）
│   ├── container.json         #   集装箱吞吐量历史 + spatial
│   ├── throughput.json        #   吞吐量模型训练输入（三港 2018-2025 月度，随仓库提交）
│   └── throughput_model.json  #   吞吐量模型产物（cargo 指标 2026-2035 预测 + 回测 MAPE）
├── site-selection/            # 选址 POI 数据（siteAnalysisService 读取）
│   ├── xiaoqu.json            #   小区点集
│   ├── qz_hospital.json       #   医院
│   ├── qz_primary_school.json #   小学
│   ├── qz_middle_school.json  #   中学
│   ├── qz_park.json           #   公园
│   ├── qz_bus_station.json    #   公交站
│   └── qz_mall_and_supermarket.json  # 商超
└── flood/                     # 洪涝预计算数据 + DEM 栅格
    ├── facilityPoints.json    #   受淹评估设施点
    ├── floodArea.json         #   淹没区域
    ├── floodStatistics.json   #   洪涝统计
    ├── water-area.json        #   水域
    ├── waterLevel.json        #   水位档位
    ├── terrainProfile.json    #   地形剖面
    └── dem/                   #   DEM 栅格（flood-service 演算输入）
        ├── filled_utm48n_cut.tif   # 填洼 UTM48N 裁切版（flood_engine 输入）
        ├── dem_4326.tif / dem_4326_cut.tif
        ├── dem_mosaic_utm48n.tif
        └── *.sgrd / *.mgrd / *.sdat（SGRD 系列中间产物）
```

## 三、存储基础设施：`utils/fileStore.js`

> 位于 `backend/utils/fileStore.js`（不在 data/ 内），是 data/ 可写文件的统一存储工厂。
> `@arch-note R-01`：文件存储工厂，统一缓存/写锁基础设施（markers / plans / users 共用）。

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

### 静态数据（直接 readFile）
- `forecastService.js` → `data/forecast/{cargo,container}.json`：`getOrComputeForecast` 读取后调 `computeForecast` 演算，缓存 5min（`SEC-014`）；指标白名单（`SEC-013`）拒绝路径遍历。
- `siteAnalysisService.js` → `data/site-selection/qz_*.json` + `xiaoqu.json`：经 repositories 加载后做覆盖/交集/评分。
- `floodService.js` → `data/flood/facilityPoints.json` 等：洪涝损失评估输入。
- `ports.json` → 后端单源，经 `/api/ports` 公开接口返回（前端 `loadPorts`）。

### 可写数据（经 fileStore）
- `users.json` ← `userService.js`（`d045` 启用缓存，`P2-10` 不可变更新）。
- `markers.json` ← `markersRepository.js`。
- `plans.json` ← `plansRepository.js`。

## 五、数据生成工具

### `backend/flood-service/` — 洪涝在线演算（Python FastAPI）
> 独立微服务，生成 `data/flood/` 中的连通性淹没 GeoJSON。

- **`flood_engine.py`**：连通性淹没演算引擎。海平面抬升模型——水从海面（DEM NoData 区域）进入，只淹没与海面 8 连通的高程低于水位的区域。
  - 算法：`mask = (DEM <= level)` → 与 NoData(海域) 合并做连通域标注 → 保留「海域分量」中的淹没区。
  - 输入：`data/flood/dem/filled_utm48n_cut.tif`（UTM48N，30m，填洼版）。
  - 降采样 4x（30m→120m，像元 ~6800万→~425万），单次演算秒级；模块级缓存 DEM（~17MB float32，只读一次）。
  - 输出：EPSG:4326 淹没多边形 GeoJSON FeatureCollection + 统计。
  - 依赖：numpy / scipy / rasterio（rasterio wheel 自带 GDAL）。
- **`main.py`**：FastAPI 服务。`GET /api/flood/online?level=3.5` → `{level, featureCount, floodedKm2, features, elapsedMs}`；档位缓存（水位取整 0.1m，最近 64 档 LRU，滑块拖动重复档位秒回）；`@lru_cache` 首请求触发 DEM 加载。
  - 启动：`cd backend/flood-service && .venv/Scripts/python.exe -m uvicorn main:app --port 8000`。
  - 开发期 CORS 允许 Vite dev（5173），生产由 nginx 同源反代。
- **`flood_demo.json`**：演示数据。

### `backend/static/dem/` — 地形可视化产物
- `dem_hillshade.png` / `dem_hillshade.tif` / `dem_hillshade.wld`：DEM 山体阴影栅格，供前端 2D GeoTIFF 图层加载（`addGeoTIFFLayer`）。

## 六、依赖关系

- **services → data**：forecastService / siteAnalysisService / floodService 直接 readFile 静态数据。
- **repositories → data**：markers/plans/users Repository 经 `createFileStore` 读写可写数据。
- **flood-service → data/flood/dem**：Python 微服务读 DEM 栅格演算。
- **向第三方依赖**（fileStore）：`fs/promises`；flood-service：numpy/scipy/rasterio/fastapi。

## 七、关键约束（@arch-note）

| 标注 | 文件 | 约束 |
|------|------|------|
| `R-01` | utils/fileStore.js | 文件存储工厂，markers/plans/users 共用缓存/写锁基础设施 |
| `DAT-7` | utils/fileStore.js | readAll 命中缓存返回对象引用（非深拷贝），调用方必须不可变更新后 writeAll |
| 原子写入 | utils/fileStore.js | writeAll 先写 .tmp 再 rename，失败清理临时文件 |
| 写锁 | utils/fileStore.js | sequential 串行化写操作，消除 TOCTOU 竞态 |
| `SEC-013` | forecastService | 指标白名单 cargo/container，拒绝路径遍历，data/forecast 不可接受任意输入 |
| `SEC-014` | forecastService | 引擎结果缓存 TTL 5min，data/forecast/*.json 更新后自动失效重算 |

## 八、备注

- DEM 栅格体积较大（`filled_utm48n_cut.tif` 等），已 `.gitkeep` 保留目录结构；大文件按需本地准备。
- SGRD 系列（`.sgrd`/`.mgrd`/`.sdat`）为 SAGA GIS 中间产物，保留供溯源。
- flood-service 为独立 Python 进程，不随 Node 后端启动，需单独运行。
