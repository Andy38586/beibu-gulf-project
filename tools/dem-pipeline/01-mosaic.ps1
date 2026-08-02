# =============================================================================
# 01-mosaic.ps1
# DEM 预处理流水线 - 步骤1：拼接 6 个 ASTER GDEM .img -> dem_mosaic_utm48n.tif
# =============================================================================
# 说明：
#   任务原始设想是用 gdalbuildvrt + gdal_translate 拼接（假设 6 个 .img 投影一致）。
#   实勘探测发现：E107/E108 的 4 个 tile 是 EPSG:32648 (UTM 48N, 中央经线 105)，
#   而 E109 的 2 个 tile (ASTGTM_N21E109M.img, ASTGTM_N22E109X.img) 是
#   EPSG:32649 (UTM 49N, 中央经线 111)。这是 ASTER GDEM 按 UTM zone 分块的正常现象
#   （E109 落在 UTM 49N 范围 108-114E 内）。
#   因此改用 gdalwarp 一步完成 mosaic + 统一重投影到 EPSG:32648，
#   gdalwarp 会自动把每个输入重投影到目标 SRS 再拼接。
#
# 输入：C:\Users\JionHappY\Desktop\项目数据\浸没分析\ASTER-GDEM-30m\解压后\*.img (6 个)
# 输出：backend/data/flood/dem/dem_mosaic_utm48n.tif
# =============================================================================
#Requires -Version 5.1
$ErrorActionPreference = 'Stop'

# --- 路径配置 ---
$gdalBin    = 'C:\Program Files\QGIS 3.44.12\bin'
$inpDir     = 'C:\Users\JionHappY\Desktop\项目数据\浸没分析\ASTER-GDEM-30m\解压后'
$outDir     = 'c:\mypython\beibu-gulf-project\backend\data\flood\dem'
$outTif     = Join-Path $outDir 'dem_mosaic_utm48n.tif'

# --- 前置检查 ---
if (-not (Test-Path $gdalBin))            { throw "GDAL bin 目录不存在: $gdalBin" }
if (-not (Test-Path $inpDir))             { throw "输入目录不存在: $inpDir" }
if (-not (Test-Path $outDir))             { throw "输出目录不存在: $outDir" }
$gdalwarp = Join-Path $gdalBin 'gdalwarp.exe'
$gdalinfo = Join-Path $gdalBin 'gdalinfo.exe'
if (-not (Test-Path $gdalwarp))           { throw "找不到 gdalwarp.exe" }
if (-not (Test-Path $gdalinfo))           { throw "找不到 gdalinfo.exe" }

# --- 收集输入 .img 文件（按名称排序保证可复现） ---
$imgs = Get-ChildItem (Join-Path $inpDir '*.img') | Sort-Object Name | Select-Object -ExpandProperty FullName
if ($imgs.Count -ne 6) {
    throw "预期 6 个 .img 文件，实际找到 $($imgs.Count) 个"
}
Write-Host "找到 $($imgs.Count) 个输入 .img 文件：" -ForegroundColor Cyan
$imgs | ForEach-Object { Write-Host "  $_" }

# --- 执行 gdalwarp：mosaic + 统一重投影到 EPSG:32648 ---
# 参数说明：
#   -t_srs EPSG:32648   目标投影 UTM zone 48N（统一 E109 的 UTM 49N -> 48N）
#   -tr 30 30           强制 30m 像元（与原始一致）
#   -dstnodata 32767    保留原始 NoData
#   -r bilinear         DEM 连续数据用 bilinear 重采样
#   -co TILED=YES -co COMPRESS=LZW -co BIGTIFF=IF_SAFER
Write-Host "`n--- gdalwarp 拼接 + 重投影到 EPSG:32648 ---" -ForegroundColor Cyan
& $gdalwarp -t_srs EPSG:32648 -tr 30 30 -dstnodata 32767 -r bilinear `
    -of GTiff -co TILED=YES -co COMPRESS=LZW -co BIGTIFF=IF_SAFER `
    $imgs $outTif
if ($LASTEXITCODE -ne 0) { throw "gdalwarp 失败，exit code: $LASTEXITCODE" }

# --- 验证 ---
Write-Host "`n--- gdalinfo 验证 $outTif ---" -ForegroundColor Cyan
& $gdalinfo -norat -mm $outTif | Select-String -Pattern `
    'Driver:|Size is|ID\["EPSG"|Origin =|Pixel Size =|Upper Left|Lower Right|Band 1|Computed Min/Max|NoData Value'

Write-Host "`n[步骤1 完成] 产物: $outTif" -ForegroundColor Green
Write-Host "期望: EPSG:32648, 30m, Int16, NoData=32767, 覆盖 E107-E110/N21-N23" -ForegroundColor Yellow
