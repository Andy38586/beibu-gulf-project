# import-gis.ps1 — GIS 矢量入库流水线（T4.1/T4.2 产物）
# 统一 ogr2ogr → PG（EPSG:4490，GEOMETRY_NAME=geom），每类数据一条命令。
# 质检由 verify.mjs 承担（本脚本导入后可跑 npm run verify-gis）。
#
# 用法（每类可单独跑）：
#   powershell -File tools\gis-import\import-gis.ps1 -Section roads
#   powershell -File tools\gis-import\import-gis.ps1 -Section all     # 全量
#
# 前置：
#   1. Docker PostGIS 运行中：docker compose -f docker-compose.v3.yml up -d postgis
#   2. 建表：docker cp tools/db-schema-gis.sql beibu-postgis:/tmp/ 后 exec psql 执行
#   3. 源数据位于桌面项目数据目录（缺省）
param(
  [ValidateSet('all', 'roads', 'railways', 'canal', 'industrial', 'mangroves', 'protected')]
  [string]$Section = 'all'
)

$ErrorActionPreference = 'Stop'
# PS7 坑：native 命令 stderr（如 ogr2ogr Warning）默认升级为终止错误——
# 应让 stderr 只作为输出流，成败以 $LASTEXITCODE 判定（见 Invoke-Ogr）
$PSNativeCommandUseErrorActionPreference = $false

$GDAL = 'C:\Program Files\QGIS 3.44.12\bin\ogr2ogr.exe'
if (-not (Test-Path $GDAL)) { throw "ogr2ogr 未找到：$GDAL（需 QGIS 安装）" }
$DockerCli = 'C:\Program Files\Docker\Docker\resources\bin\docker.exe'
if (-not (Test-Path $DockerCli)) { throw "docker CLI 未找到：$DockerCli（需 Docker Desktop）" }
$DataRoot = 'C:\Users\JionHappY\Desktop\_北部湾项目\数据_\项目数据'
# PG 连接（对齐 docker-compose.v3.yml 与 verify.mjs）
$PG = 'PG:host=localhost port=5432 user=postgres password=postgres dbname=v3_dev active_schema=public'

# 红树林裁剪窗（EPSG:4326，minx miny maxx maxy）：覆盖广西全境并外扩，故必然含粤西与
# 越北的同纬度片区——实测每时相 420~480km²，而广西红树林实际约 90km²，差值即境外片区。
# 语义是"裁剪窗"而非"广西行政边界"，勿按省界口径引用。
$MANGROVE_SPAT = @('104', '20', '113', '27')

# 导入前置：TRUNCATE 目标表（幂等重灌，对齐 db-import.mjs 语义）。
# 用 -append 追加而非 -overwrite——-overwrite 会 DROP 预建表（schema-gis.sql 的
# class/length_m/year 等列被源 schema 顶掉）；-append 保留我们设计的表结构。
# 容器内 psql 唯一入口：与 ogr2ogr 同款 PS7 坑——psql 的 NOTICE/stderr 会被
# ErrorActionPreference 升为终止错误，故函数内降级、成败以 $LASTEXITCODE 判定。
# 收口原因：降级逻辑原本只写在 Invoke-Ogr 里，其余六处裸调 docker exec 全部漏掉，
# 任何一条 NOTICE 都会中断整条流水线。
function Invoke-Psql([string]$sql) {
  $prev = $ErrorActionPreference
  $ErrorActionPreference = 'Continue'
  try {
    & $DockerCli exec beibu-postgis psql -U postgres -d v3_dev -c $sql 2>&1 | ForEach-Object { Write-Host $_ }
  } finally {
    $ErrorActionPreference = $prev
  }
  if ($LASTEXITCODE -ne 0) { throw "psql 失败 exit=$LASTEXITCODE：$sql" }
}

function Reset-Table([string]$table) {
  Write-Host "--- TRUNCATE $table ---"
  Invoke-Psql "TRUNCATE $table;"
}

function Invoke-Ogr([string]$dst, [string]$src, [string[]]$extraArgs) {
  Write-Host "--- ogr2ogr -> $dst ($src) ---"
  # 函数内降级 ErrorActionPreference：ogr2ogr stderr（Warning 1 等）不应中断，
  # 真实成败以 $LASTEXITCODE 判定（Append 到已存在图层时 Warning 属正常）
  $prev = $ErrorActionPreference
  $ErrorActionPreference = 'Continue'
  try {
    & $GDAL @extraArgs -f 'PostgreSQL' -t_srs 'EPSG:4490' -lco 'GEOMETRY_NAME=geom' `
      -nln $dst $PG $src 2>&1 | ForEach-Object { Write-Host $_ }
  } finally {
    $ErrorActionPreference = $prev
  }
  if ($LASTEXITCODE -ne 0) { throw "ogr2ogr 失败（$dst）exit=$LASTEXITCODE" }
}

function Import-Roads {
  # 源字段 osm_id/name/highway；highway → 临时列兜住，再 SQL 回填 class/length_m
  # （ogr2ogr plain append 按列名匹配，highway 无 class 列时须显式承接）
  Reset-Table 'roads'
  Invoke-Psql 'ALTER TABLE roads ADD COLUMN IF NOT EXISTS highway TEXT;'
  Invoke-Ogr 'roads' "$DataRoot\路网\beibu-roads.geojson" @('-append')
  # 长度按大地线（geography）算，不落任何 UTM 分带：路网 bbox 105.87~111.12 横跨
  # UTM 48N（102~108）与 49N（108~114）两带，投影分带一变 length_m 就变（带边缘
  # 系统性偏大达 0.5%），而最短路径的 distance 权重必须口径唯一、与分带选择无关。
  Invoke-Psql 'UPDATE roads SET class = highway;'
  Invoke-Psql 'UPDATE roads SET length_m = round(ST_Length(geom::geography)::numeric, 2);'
}
function Import-Railways {
  Reset-Table 'railways'
  Invoke-Ogr 'railways' "$DataRoot\路网\beibu-railways.geojson" @('-append')
}
function Import-Canal {
  Reset-Table 'canal'
  Invoke-Ogr 'canal' "$DataRoot\多边形\平陆运河\canal-schematic.geojson" @('-append')
}
function Import-Industrial {
  # 源 Polygon → 归一 MultiPolygon（-nlt PROMOTE_TO_MULTI）
  Reset-Table 'industrial_zones'
  Invoke-Ogr 'industrial_zones' "$DataRoot\多边形\工业园区\beibu-industrial.geojson" @('-append', '-nlt', 'PROMOTE_TO_MULTI')
}
function Import-Mangroves {
  # 全时相：每份 shp 先按裁剪窗 -spat 过滤，逐时相入库（-append）；
  # 每时相导入后立即回填 year（shp 源无 year 列，从文件名推断）——不可全量后一次回填（无法区分时相）
  Reset-Table 'mangroves'
  $gmw = "$DataRoot\多边形\红树林\GMW_v3\01_GMW_001_GlobalMangroveWatch\01_Data\gmw_v3"
  $years = @('1996','2007','2008','2009','2010','2015','2016','2017','2018','2019','2020')
  foreach ($y in $years) {
    $shp = Join-Path $gmw "gmw_v3_${y}_vec.shp"
    if (-not (Test-Path $shp)) { Write-Host "skip $y（无文件 $shp）"; continue }
    Invoke-Ogr 'mangroves' $shp @(@('-append', '-nlt', 'PROMOTE_TO_MULTI', '-spat') + $MANGROVE_SPAT + @('-skipfailures'))
    Invoke-Psql "UPDATE mangroves SET year = $y WHERE year IS NULL;"
  }
  # 面积同样走 geography（与 roads 长度同口径）：椭球面上的真实面积，不依赖 UTM 分带
  Invoke-Psql 'UPDATE mangroves SET area_km2 = round((ST_Area(geom::geography) / 1000000.0)::numeric, 2);'
}
function Import-Protected {
  $poly = "$DataRoot\多边形\保护用地\WDPA_extracted\WDPA_WDOECM_Aug2026_Public_CHN_shp-polygons.shp"
  if (Test-Path $poly) {
    Reset-Table 'protected_areas'
    Invoke-Ogr 'protected_areas' $poly @('-append', '-nlt', 'PROMOTE_TO_MULTI')
  } else {
    Write-Host '跳过 protected：polygons shp 未找到'
  }
}

switch ($Section) {
  'roads'      { Import-Roads }
  'railways'   { Import-Railways }
  'canal'      { Import-Canal }
  'industrial' { Import-Industrial }
  'mangroves'  { Import-Mangroves }
  'protected'  { Import-Protected }
  'all'        { Import-Roads; Import-Railways; Import-Canal; Import-Industrial; Import-Mangroves; Import-Protected }
}
Write-Host "`n导入完成。建议执行：npm run verify-gis"