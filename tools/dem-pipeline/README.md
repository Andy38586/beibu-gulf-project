# tools/dem-pipeline — 海陆 DEM 管线（2026-10-04 修订）

> **定位**：从**外置数据备份树**（`C:\Users\JionHappY\Desktop\_北部湾项目\06-数据备份\数据_\...`）
> 里的原始/处理成果栅格，到仓库内**淹没演算 + 地形切片**所消费的数据，全链路的落点与复跑口径。
> 2026-10-04 之前：链路里"海侧格网"一环**没有任何脚本**（`sea_custom.tif` 是一次性手工产物），
> 且 06 脚本的 venv / 源 / 输出路径均已失效 ⇒ 干净检出复跑不出来（台账 z047 的
> "workspace 内可复现"缺口）。本轮补齐脚本并把每一步的复算钉住。
>
> **复算铁律**：产物 `.tif` 全部 gitignored（体积 + 唯一原件在外置树）。判断"可不可复现"看
> **能不能用脚本从外置源跑出与现役逐位一致的栅格**，不看仓库里有没有那个文件。

## 一、运行环境（三个入口，别用错）

| 入口            | 路径                                                      | 有什么 / 没有什么                                  | 谁用                                |
| --------------- | --------------------------------------------------------- | -------------------------------------------------- | ----------------------------------- |
| osgeo 版 python | `C:\Program Files\QGIS 3.44.12\apps\Python312\python.exe` | GDAL 3.13.1 + numpy 2.4.6；**无 rasterio**         | 10 / 11（`from osgeo import gdal`） |
| venv python     | `backend/algorithm-service/.venv/Scripts/python.exe`      | rasterio / numpy / scipy / shapely；**无 osgeo**   | 06 / 07\* / 12 / 13 / diag          |
| GDAL CLI        | `C:\Program Files\QGIS 3.44.12\bin\`                      | gdal_translate / gdalwarp / gdalsrsinfo / gdalinfo | 03 / 06 / 09b 等 `.ps1`             |

PowerShell 下调 python 一律加 `-X utf8`：脚本 stdout 含 "km²" 等字符，GBK 控制台会
`UnicodeEncodeError`（2026-10-04 实测）。

## 二、链路与复算状态

| 步            | 脚本                                                            | 输入 → 输出                                                     | 2026-10-04 复算                                                                                                                  |
| ------------- | --------------------------------------------------------------- | --------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- | --- | ------------------ |
| 01–03         | `01-mosaic.ps1` / `02-fill-sinks.ps1` / `03-reproject-4326.ps1` | ASTER 6 幅 `.img`（外置）→ `filled_utm48n.tif` → `dem_4326.tif` | ⚪ 脚本在位，本轮未复算（SAGA 段）                                                                                               |
| 06            | `06-sea-mask.py` + `06-restore-cut-dem.ps1`                     | ASTER 填洼版 + 海岸线 + 测深 → `filled_utm48n_cut.tif`          | ✅ 逐位一致（md5 `ed15d45e…`）                                                                                                   |
| 07/07b/07c/08 | 地形 heightmap 重切 / 工程后地表 / 补丁 / 根瓦片回填            | `filled_utm48n_cut.tif` → `backend/static/terrain`              | ✅ 07 死输入路径本轮修正并核对存在；**07c 修复**：`available` 改按实写集重建，新增 `--dry-run`；单瓦片一致性见下行，全量重切未跑 |
| **09b**       | **`09b-srtm15-sea-grid.ps1`（本轮新增）**                       | SRTM15+V2.6.nc → `srtm_4326_full.tif` → `sea_custom.tif`        | ✅ 逐位一致（`max                                                                                                                | Δ   | =0`，含 NaN 掩膜） |
| 10            | `10-landsea-merge.py`                                           | cut + sea → `landsea_utm48n.tif`                                | ✅ 逐位一致（数组 md5 `77f83a25…`）                                                                                              |
| 11            | `11-seam-audit.py`                                              | 三件 → 接缝/分带/未填聚类审计                                   | ✅ 两侧中位差 −3.00 m（岸坡，非台阶）                                                                                            |
| 12/13         | `12-terrain-factors.py` / `13-suitability-cells.py`             | DEM → 地形因子/适宜性格网（入 PostGIS）                         | ⚪ 需 Postgres，本机 DB 未起                                                                                                     |
| **14**        | **`14-bathy-fuse.py`（本轮新增）**                              | 近岸测深交付件（GeoTIFF/CSV）→ 新海侧格网 + 差异报告            | ⚪ 数据未到位；红线/换算/融合判据 7 例全绿（`test_bathy_fuse.py`，pytest）                                                       |

> **地形重切（07）未全量重跑**：它会把 `backend/static/terrain`（49,081 张、gitignored 的运行时资产）
> 整树重写。本轮只做单瓦片比对：`python -X utf8 tools/diag/probe-terrain-vs-dem.py 12 6565 1549`
> ⇒ 盘上瓦片对当前 DEM 均 |Δ| 0.34 m / P95 2.00 m（按当前 DEM 重切为 0.31 m / 2.00 m），其中
> 583 个「10-04 掩膜归还陆地」节点上 0.84 m vs 0.77 m ⇒ 现有地形**不是旧掩膜时代的产物**，
> 不因正确性必须重切。真要重切：先备份（`07c` 头注给的先例），再整树重跑。
>
> **layer.json 声明漂移（2026-10-04 探针实测）**：`layer.json.available` 声明 49,157 张，
> 盘上实物 49,081 张 ⇒ 76 张幽灵声明（z13 36 + z14 40，永远 404、回退父层）。根因是旧 07c
> 把 `have` 建在 bbox 计划集上、按计划集写 `available`。修复后 07c 从盘上实清单取 `have`、
> 只把「真正写出的瓦片」写进 `available`/`childTileMask`；声明漂移的检查与作废条件见
> `tools/diag/probe-terrain-tree-vs-layerjson.py`（根链缺 ⇒ 红；深层漂移 ⇒ ⚠ 记账不判红）。
> **全量重切（含重写 layer.json）会写入 `backend/static/terrain`，未执行，等用户点头 + 先备份。**

## 三、外置源与工作区产物（资产落地现状）

| 数据                                     | 现位置                                                                                                   | 角色                          |
| ---------------------------------------- | -------------------------------------------------------------------------------------------------------- | ----------------------------- |
| SRTM15+V2.6.nc（6.5 GB，全球 15″）       | `…\06-数据备份\数据_\项目数据\海底DEM\`                                                                  | 09b 的源（缺则脚本报错停下）  |
| ASTER 填洼版 `filled_CGCS2000_int16.tif` | `…\06-数据备份\数据_\项目数据\浸没分析\处理成果\`                                                        | 06 的源                       |
| 海岸线 `beibu-coastline.geojson`         | `…\06-数据备份\数据_\项目数据\海岸线\`                                                                   | 06 的掩膜源                   |
| 中间件                                   | 仓库 `.local\dem-work\`、`.local\dem-sea-work\`（gitignored）                                            | 各脚本默认落点                |
| 消费产物                                 | `backend/data/flood/dem\landsea_utm48n.tif`（淹没演算 + 地形重切共用）、`backend/data/flood\*.json(.gz)` | 服务读这里；`.tif` gitignored |

**待裁（不自行选边）**：外置树与 workspace 谁是"权威副本"——现行做法是"外置树存原始与
处理成果、workspace 只放可再生的缓存"（z047 既有口径），但 `backend/data/flood/dem/` 同时
又是服务默认读入点，两处角色没有文件级声明。用户拍板前不动任何一方。

## 四、五分钟复跑（按顺序）

```powershell
# 0) 海侧格网（本文件对应的新增脚本）——缺 sea_custom.tif 时先跑
pwsh -File tools/dem-pipeline/09b-srtm15-sea-grid.ps1
# 期望：srtm_4326_full.tif 648x392；sea_custom.tif 9357x6074；缺口 东 91.6m / 北 0.0m

# 1) 陆地三判据海掩膜 + 30m 工作格网裁切（覆盖 .local\dem-work\filled_utm48n_cut.tif）
pwsh -File tools/dem-pipeline/06-restore-cut-dem.ps1
# 期望：交后 sea 21.1% ｜ 归还陆地 4,997,148 px = 4344.6 km² ｜ 源 DEM 判陆保留 2,875,187 px

# 2) 海陆拼合（osgeo 版 python）
& 'C:\Program Files\QGIS 3.44.12\apps\Python312\python.exe' -X utf8 `
  tools/dem-pipeline/10-landsea-merge.py `
  .local/dem-work/filled_utm48n_cut.tif .local/dem-sea-work/sea_custom.tif `
  backend/data/flood/dem/landsea_utm48n.tif
# 期望：海区 15,381,990 px(27.1%) ｜ 已填 15,111,051 ｜ landsea 数组 md5 77f83a25…

# 3) 结构审计
& 'C:\Program Files\QGIS 3.44.12\apps\Python312\python.exe' -X utf8 `
  tools/dem-pipeline/11-seam-audit.py `
  .local/dem-work/filled_utm48n_cut.tif .local/dem-sea-work/sea_custom.tif `
  backend/data/flood/dem/landsea_utm48n.tif
# 期望：两侧中位差（海-陆）: -3.00m（岸坡，非台阶）；未填 270,939 px 聚在东缘 x>9000

# 4) 地形树完整性（layer.json 声明 vs 盘上实物，只读；venv）
backend/algorithm-service/.venv/Scripts/python.exe -X utf8 tools/diag/probe-terrain-tree-vs-layerjson.py
# 期望：盘上 49081 ｜ 根链(z≤2)缺 0 ｜ 深层漂移 76（z13 36 + z14 40）｜ 孤儿 0；EXIT=0

# 4b) 修好的 07c 干跑（不写盘；核对删除幽灵声明后的声明数）
backend/algorithm-service/.venv/Scripts/python.exe -X utf8 tools/dem-pipeline/07c-patch-terrain.py --dry-run
# 期望：盘上原瓦片 49081 ｜ bbox 计划新增 96 ｜ 需重写 51 ｜ 实写后 49081
#       layer.json: z13 声明 12 张 / z14 声明 16 张（即幽灵 76 张被消除）
```

## 四-b、近岸测深到位后（14，只写 .local，不碰运行时资产）

红线与判据正本：`docs/近岸测深数据需求-2026-10-04.md` §二/§三。数据未到位前第 1/2 条跑不出，
第 3 条（判据自检）随时可跑。

```powershell
# 1) 只验收（不写盘；来源/基准声明缺一即拒收；分辨率 >100m 或与 P0 区零相交同样拒收）
backend/algorithm-service/.venv/Scripts/python.exe -X utf8 `
  tools/dem-pipeline/14-bathy-fuse.py .local/dem-sea-work/<交付件> `
  --source "<出处>" --datum egm96 --check
# 期望：✅ 验收通过 + 覆盖率/值域行；任一红线不过 ⇒ exit 2 且不产出文件

# 2) 融合 → 新海侧格网 + 差异报告（旧格网保留可回退；--datum lld 时 h = Z − d）
backend/algorithm-service/.venv/Scripts/python.exe -X utf8 `
  tools/dem-pipeline/14-bathy-fuse.py .local/dem-sea-work/<交付件> `
  --source "<出处>" --datum lld --lld-height-m <Z> `
  --out .local/dem-sea-work/sea_custom_v2.tif `
  --report .local/dem-sea-work/bathy-fuse-report.json
# 期望：WROTE 两件；打印 0~20m 水深带差异（量级）+ 后续 10/11 命令（写运行时资产须用户点头）

# 3) 判据自检（不依赖数据，随时可跑）
backend/algorithm-service/.venv/Scripts/python.exe -X utf8 -m pytest tools/dem-pipeline/test_bathy_fuse.py -q
# 期望：7 passed
```

CSV 点云走 scipy（venv 自带）；点云空白的最大回填距离 = `--max-fill-gap-m`（默认 60 m = 2×工作格网格）。
融合只替换"现役海侧有效格"，落在现役非海区的交付值会跳过并计数（不擅自扩张海陆边界）。

## 五、坑（都是实测，不在别处重复）

1. NETCDF 子数据集**不带 CRS** ⇒ 裁剪步必须 `-a_srs EPSG:4326`，否则 `gdalwarp` 因"未知源坐标系"产出 1×1 空图；
2. 本机 GDAL 的 `-te/-te_srs` 被**静默忽略**（`10-landsea-merge.py` 头注坑②）⇒ 海侧不传 `-te`，范围交给 GDAL 自动取；
3. `10-landsea-merge.py` 的 sea 入参须 `nodata=NaN` 的 Float32；`-dstnodata` 与 nc 自身 NaN 冲突会全图空；
4. `gdalinfo -json` 在 Windows PowerShell 5.1 下遇到元数据空键名会抛错 ⇒ `09b` 用文本解析；
5. `06-sea-mask.py` 第 4 参（测深栅格）必须是**与源 DEM 同 CRS 的投影栅格**（`sea_custom.tif`）——
   传 4326 版会因坐标不可比把整片判成非海（2026-10-04 实测：交后 sea 0.0%、归还 22,390,896 px）；
6. `10` / `11` 只需 osgeo，`06` / `07*` 只需 rasterio——venv 里没有 osgeo，QGIS python 里没有 rasterio。

## 六、复算证据（2026-10-04，全部对现役产物逐位比对）

| 环节        | 判据                                           | 结果                                                                             |
| ----------- | ---------------------------------------------- | -------------------------------------------------------------------------------- | --- | ------------------------------- |
| 09b 第 1 步 | `srtm_4326_full.tif` 与现役逐像元比            | `max                                                                             | Δ   | = 0`，尺寸 648×392 一致         |
| 09b 第 2 步 | `sea_custom.tif` 与现役逐像元比（含 NaN 掩膜） | `max                                                                             | Δ   | = 0`，数组 md5 `3580fb3d…` 一致 |
| 06 第 1 步  | 掩膜三判据计数                                 | 交后 21.1% / 归还 4,344.6 km² / 源判陆 2,499.7 km²（与 `a8a3560a` 提交正文一致） |
| 06 第 2 步  | `filled_utm48n_cut.tif` 与现役逐像元比         | `max                                                                             | Δ   | = 0`，数组 md5 `ed15d45e…` 一致 |
| 10          | `landsea_utm48n.tif` 与现役逐像元比            | `max                                                                             | Δ   | = 0`，数组 md5 `77f83a25…` 一致 |
| 11          | 海岸线两侧台阶                                 | 陆侧中位 +0.00 m / 两侧中位差 −3.00 m（岸坡）                                    |

读法：数组 md5 是对**像素值**算的（不含压缩/瓦片元数据）；`max|Δ| = 0` 即两版栅格逐像元相同。
