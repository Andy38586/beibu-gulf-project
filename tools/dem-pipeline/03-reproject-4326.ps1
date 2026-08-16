# =============================================================================
# 03-reproject-4326.ps1
# DEM 预处理流水线 - 步骤3：重投影到 EPSG:4326 -> dem_4326.tif (Web 母本)
# =============================================================================
# 说明：
#   将填洼后的 filled_utm48n.tif (EPSG:32648) 重投影到 EPSG:4326 (WGS84 经纬度)，
#   作为 WebGIS 统一输入母本。
#
#   关键处理（修正步骤2 SAGA 的输出格式）：
#   - -srcnodata -99999  显式指定源 NoData（SAGA 默认 -99999）
#   - -dstnodata 32767    目标 NoData 还原为原始 ASTER GDEM 的 32767
#   - -ot Int16           数据类型还原为 Int16（SAGA 输出为 Float32）
#   （DEM 高程范围 -5~1844m，Int16 足够；32767 远超最大值，作为 NoData 安全）
#
# 输入：backend/data/flood/dem/filled_utm48n.tif
# 输出：backend/data/flood/dem/dem_4326.tif
# =============================================================================
#Requires -Version 5.1
$ErrorActionPreference = 'Stop'

# --- 路径配置 ---
$gdalBin  = 'C:\Program Files\QGIS 3.44.12\bin'
$gdalwarp = Join-Path $gdalBin 'gdalwarp.exe'
$gdalinfo = Join-Path $gdalBin 'gdalinfo.exe'
$outDir   = 'c:\workspace\beibu-gulf-project\backend\data\flood\dem'
$srcTif   = Join-Path $outDir 'filled_utm48n.tif'
$dstTif   = Join-Path $outDir 'dem_4326.tif'

# --- 前置检查 ---
if (-not (Test-Path $gdalwarp)) { throw "找不到 gdalwarp.exe" }
if (-not (Test-Path $gdalinfo)) { throw "找不到 gdalinfo.exe" }
if (-not (Test-Path $srcTif))   { throw "步骤2 产物不存在: $srcTif（请先运行 02-fill-sinks.ps1）" }

# --- 执行 gdalwarp 重投影 EPSG:32648 -> EPSG:4326 ---
# 参数说明：
#   -t_srs EPSG:4326     目标坐标系 WGS84 经纬度
#   -srcnodata -99999    源 NoData（SAGA 输出）
#   -dstnodata 32767     目标 NoData（还原为 ASTER GDEM 标准）
#   -ot Int16            输出数据类型 Int16（还原，SAGA 输出为 Float32）
#   -r bilinear          DEM 连续数据用 bilinear
#   -co TILED=YES -co COMPRESS=LZW -co BIGTIFF=IF_SAFER
Write-Host "--- gdalwarp 重投影 EPSG:32648 -> EPSG:4326 ---" -ForegroundColor Cyan
& $gdalwarp -t_srs EPSG:4326 -srcnodata -99999 -dstnodata 32767 -ot Int16 `
    -of GTiff -co TILED=YES -co COMPRESS=LZW -co BIGTIFF=IF_SAFER `
    -r bilinear $srcTif $dstTif
if ($LASTEXITCODE -ne 0) { throw "gdalwarp 失败，exit code: $LASTEXITCODE" }

# --- 验证 ---
Write-Host "`n--- gdalinfo 验证 $dstTif ---" -ForegroundColor Cyan
& $gdalinfo -norat -mm $dstTif | Select-String -Pattern `
    'Driver:|Size is|ID\["EPSG"|Origin =|Pixel Size =|Upper Left|Lower Right|Band 1|Computed Min/Max|NoData Value'

Write-Host "`n[步骤3 完成] Web 母本: $dstTif" -ForegroundColor Green
Write-Host "期望: EPSG:4326, 覆盖 E107-E110/N21-N23, NoData=32767, Int16, LZW" -ForegroundColor Yellow
