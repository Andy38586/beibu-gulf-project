# v3 PostGIS Schema 草案（2026-08-14）

> 状态：草案，待数据获取完成后定稿。配套 `docs/v3-数据获取清单-2026-08-14.md`。
> 设计原则：存储 CRS 统一 **EPSG:4490（CGCS2000 经纬度）**——与现有处理成果（filled_CGCS2000_int16.tif）一致；
> 展示层前端转 3857；空间分析（buffer/路由）在 DB 内以 4490 计算（或按需 ST_Transform）。
> 扩展：`postgis`、`postgis_raster`、`pgrouting`。

---

## 一、表清单

### 1.1 系统与用户（迁移自 Express）

| 表 | 关键列 | 来源 | 说明 |
|---|---|---|---|
| `users` | id, username UNIQUE, password_hash, token_version, created_at | `backend/data/users.json` | tokenVersion 吊销语义原样迁移 |
| `plans` | id, user_id FK, name, payload JSONB, created_at | `plans.json` | 选址方案收藏 |

### 1.2 基础地理（现状数据入库）

| 表 | 关键列 | 来源 | 模块 |
|---|---|---|---|
| `ports` | id, name, code, geom Point(4490) | `ports.json`（3 港） | 全模块 |
| `poi_facilities` | id, type, name, geom Point | 6 类 POI（983） | 选址 |
| `xiaoqu` | id, name, geom Point | `xiaoqu.json`（557） | 选址 |
| `flood_facilities` | id, name, type, geom, elevation, value, damage_rate | `facilityPoints.json`（83） | 浸没 |
| `flood_levels` | level NUMERIC PK, risk_level, geojson JSONB | `flood_levels.json.gz`（251 档） | 浸没查表（DB 版可选；现 gzip 文件查表 <10ms，**先保持文件，DB 化不优先**） |

### 1.3 新增业务数据（v3 论文模块）

| 表 | 关键列 | 来源 | 模块 |
|---|---|---|---|
| `roads` | id, osm_id, name, highway_type, oneway, geom LineString, source, target, cost | OSM China → osmium 裁剪广西 → osm2pgsql（含 pgrouting 拓扑列） | 最短路径 |
| `railways` | id, osm_id, name, railway_type, geom LineString | 同上（railway=*） | 集疏运因子 |
| `land_cover` | id, class, geom（或栅格 `land_cover_raster`） | GlobeLand30 2020 / Esri 10m，取耕地等类 | 选址因子 |
| `mangroves` | id, year, geom Polygon | Global Mangrove Watch v3 | 选址约束 |
| `protected_areas` | id, name, type, geom Polygon | WDPA + 生态红线（人工） | 选址一票否决 |
| `water_depth_points` | id, lng, lat, depth_m, source | 海图水深点数字化 | 海底 DEM 插值/船型适配 |
| `bathymetry_raster` | 栅格 | SRTM15+ / GEBCO（区域尺度） | 港口风险 |
| `dem_raster` | 栅格 | GLO-30 30m（升级） | 浸没 |
| `canal` | id, name, geom LineString | 平陆运河中心线（公开资料人工勾绘） | 运河因子 |

### 1.4 情景与权重（v3 交互核心，可选入库）

| 表 | 说明 |
|---|---|
| `scenarios` | id, name（看好/中立/看衰）, weights JSONB, created_at | 情景预设档；也可先做代码配置，入库为 v4 优化项 |

---

## 二、导入流水线（依赖数据获取）

```
OSM pbf ──osmium extract──> beibu.osm.pbf ──osm2pgsql (--slim --hstore)──> roads/railways 拓扑表
GlobeLand30 ──gdal_translate 裁广西──> land_cover_raster ──(可选)矢量化──> land_cover
GMW/WDPA ──shp2pgsql──> mangroves / protected_areas
GLO-30 瓦片 ──raster2pgsql -s 4490 (或先合并再入库)──> dem_raster
SRTM15+ ──raster2pgsql 裁 bbox──> bathymetry_raster
海图水深点 ──csv → ST_SetSRID(ST_MakePoint)──> water_depth_points
```

**关键决策点（定稿时确认）**：
1. 现 251 档查表是否保留文件方案（建议保留：<10ms 已够，DB 化收益低）——PostGIS 只存"查表 miss 的现场演算输入"（dem_raster）。
2. land_cover 存栅格还是矢量：栅格省事、矢量好查询。选址叠加分析需要"点落在什么地类"，建议栅格 + ST_Value 即可，不必矢量化。
3. pgrouting 拓扑（source/target/cost）在导入时生成；铁路是否进同一图（建议分离，成本语义不同）。

---

## 三、与模块的对应

| 模块 | 用的表 | 空间操作 |
|---|---|---|
| 选址（多准则） | poi_facilities / xiaoqu / land_cover / protected_areas / mangroves / canal / roads | ST_Buffer / ST_Intersects / ST_DWithin（运河距离）/ ST_Value（地类） |
| 最短路径 | roads / railways / ports / 工业园多边形 | pgr_dijkstra + 可达性成本 |
| 浸没风险 | dem_raster / bathymetry_raster / water_depth_points / flood_facilities | 连通性演算（FastAPI 读栅格）+ 点面判定 |
| 预测 | （吞吐量 CSV 入 `throughput` 表或保持文件） | 无空间操作 |
| 航线分析 | AIS 轨迹点表（待定） | ST_LineMerge / 密度核（后端算） |
