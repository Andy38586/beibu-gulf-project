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
$DockerExec = "& `"$DockerCli`" exec beibu-postgis"

$DataRoot = 'C:\Users\JionHappY\Desktop\_北部湾项目\数据_\项目数据'
# PG 连接（对齐 docker-compose.v3.yml 与 verify.mjs）
$PG = 'PG:host=localhost port=5432 user=postgres password=postgres dbname=v3_dev active_schema=public'

# 红树林广西 bbox（EPSG:4326）：全球 107 万要素先裁剪再入库，骤减量级
$GUANGXI_BBOX = '104 20 113 27'

# 导入前置：TRUNCATE 目标表（幂等重灌，对齐 db-import.mjs 语义）。
# 用 -append 追加而非 -overwrite——-overwrite 会 DROP 预建表（schema-gis.sql 的
# class/length_m/year 等列被源 schema 顶掉）；-append 保留我们设计的表结构。
function Reset-Table([string]$table) {
  Write-Host "--- TRUNCATE $table ---"
  $prev = $ErrorActionPreference
  $ErrorActionPreference = 'Continue'
  try {
    & $DockerCli exec beibu-postgis psql -U postgres -d v3_dev -c "TRUNCATE $table;" 2>&1 | ForEach-Object { Write-Host $_ }
  } finally {
    $ErrorActionPreference = $prev
  }
  if ($LASTEXITCODE -ne 0) { throw "TRUNCATE 失败（$table）" }
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
  & $DockerCli exec beibu-postgis psql -U postgres -d v3_dev -c "ALTER TABLE roads ADD COLUMN IF NOT EXISTS highway TEXT;" 2>&1 | ForEach-Object { Write-Host $_ }
  Invoke-Ogr 'roads' "$DataRoot\路网\beibu-roads.geojson" @('-append')
  & $DockerCli exec beibu-postgis psql -U postgres -d v3_dev -c "UPDATE roads SET class = highway; UPDATE roads SET length_m = round(ST_Length(ST_Transform(geom, 32648))::numeric, 2);" 2>&1 | ForEach-Object { Write-Host $_ }
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
  # 全时相：每份 shp 先按广西 bbox 裁剪，逐时相入库（-append）；
  # 每时相导入后立即回填 year（shp 源无 year 列，从文件名推断）——不可全量后一次回填（无法区分时相）
  Reset-Table 'mangroves'
  $gmw = "$DataRoot\多边形\红树林\GMW_v3\01_GMW_001_GlobalMangroveWatch\01_Data\gmw_v3"
  $years = @('1996','2007','2008','2009','2010','2015','2016','2017','2018','2019','2020')
  foreach ($y in $years) {
    $shp = Join-Path $gmw "gmw_v3_${y}_vec.shp"
    if (-not (Test-Path $shp)) { Write-Host "skip $y（无文件 $shp）"; continue }
    Invoke-Ogr 'mangroves' $shp @('-append', '-nlt', 'PROMOTE_TO_MULTI', '-spat', '104', '20', '113', '27', '-skipfailures')
    & $DockerCli exec beibu-postgis psql -U postgres -d v3_dev -c "UPDATE mangroves SET year = $y WHERE year IS NULL;" 2>&1 | ForEach-Object { Write-Host $_ }
  }
  & $DockerCli exec beibu-postgis psql -U postgres -d v3_dev -c "UPDATE mangroves SET area_km2 = round((ST_Area(ST_Transform(geom, 32649)) / 1000000.0)::numeric, 2);" 2>&1 | ForEach-Object { Write-Host $_ }
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