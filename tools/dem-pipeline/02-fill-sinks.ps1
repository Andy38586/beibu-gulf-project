# =============================================================================
# 02-fill-sinks.ps1
# DEM 预处理流水线 - 步骤2：SAGA 填洼 (Wang & Liu) -> filled_utm48n.tif
# =============================================================================
# 说明：
#   使用 SAGA 9.12.4 的 ta_preprocessor 模块 5 "Fill Sinks XXL (Wang & Liu)"。
#   注意：任务描述原写 ta_preprocessor 4，但 SAGA 9.12.4 中：
#     [4] = Fill Sinks (Planchon/Darboux, 2001)
#     [5] = Fill Sinks (Wang & Liu)  ← 本脚本用这个（XXL 版本，适合大文件）
#   参数名也不同于任务描述：输入参数是 -ELEV（不是 -INPUT）。
#
#   SAGA 直接调用 saga_cmd.exe 会缺 DLL，必须先设 PATH。
#   还需设 GDAL_DATA / PROJ_LIB，否则 SAGA 内置 GDAL 找不到投影定义文件。
#
#   SAGA 输出的 GeoTIFF 是 Float32、NoData=-99999（SAGA 默认）。
#   本脚本保留这一中间状态，数据类型/NoData 的还原在步骤3 gdalwarp 中处理。
#
# 输入：backend/data/flood/dem/dem_mosaic_utm48n.tif
# 输出：backend/data/flood/dem/filled_utm48n.tif（+ .sgrd/.sdat/.mgrd 中间产物）
# =============================================================================
#Requires -Version 5.1
$ErrorActionPreference = 'Stop'

# --- 路径配置 ---
$qgisRoot  = 'C:\Program Files\QGIS 3.44.12'
$saga      = Join-Path $qgisRoot 'apps\saga\saga_cmd.exe'
$gdalBin   = Join-Path $qgisRoot 'bin'
$gdalinfo  = Join-Path $gdalBin 'gdalinfo.exe'
$outDir    = 'c:\workspace\beibu-gulf-project\backend\data\flood\dem'
$srcTif    = Join-Path $outDir 'dem_mosaic_utm48n.tif'
$tmpSgrd   = Join-Path $outDir 'dem_mosaic.sgrd'      # SAGA 中间 grid
$filledSgrd = Join-Path $outDir 'filled_utm48n.sgrd'  # 填洼后 SAGA grid
$filledTif  = Join-Path $outDir 'filled_utm48n.tif'   # 最终输出

# --- 前置检查 ---
if (-not (Test-Path $saga))     { throw "saga_cmd.exe 不存在: $saga" }
if (-not (Test-Path $srcTif))   { throw "步骤1 产物不存在: $srcTif（请先运行 01-mosaic.ps1）" }

# --- 环境变量（SAGA 依赖） ---
# 必须 QGIS bin + saga 目录在 PATH 前；GDAL_DATA/PROJ_LIB 指向 QGIS 自带数据
$env:PATH = "$gdalBin;$qgisRoot\apps\saga;$qgisRoot\apps\Python312;$qgisRoot\apps\qgis-ltr\bin;" + $env:PATH
$env:GDAL_DATA = Join-Path $qgisRoot 'apps\gdal\share\gdal'
$env:PROJ_LIB  = Join-Path $qgisRoot 'share\proj'

# --- 2.1 导入 GeoTIFF -> SAGA grid (io_gdal 0 = Import Raster) ---
Write-Host "--- 2.1 io_gdal 0 导入 GeoTIFF -> SAGA grid ---" -ForegroundColor Cyan
& $saga io_gdal 0 -FILES "$srcTif" -GRIDS "$tmpSgrd"
if ($LASTEXITCODE -ne 0) { throw "SAGA 导入失败，exit code: $LASTEXITCODE" }

# --- 2.2 填洼 (ta_preprocessor 5 = Fill Sinks XXL Wang & Liu) ---
# -ELEV 输入 DEM grid；-FILLED 输出填洼后 grid；-MINSLOPE 0.01 保证排水连续
Write-Host "`n--- 2.2 ta_preprocessor 5 Fill Sinks (Wang & Liu, MINSLOPE=0.01) ---" -ForegroundColor Cyan
Write-Host "（大文件约需 2-3 分钟，请等待）" -ForegroundColor Yellow
& $saga ta_preprocessor 5 -ELEV "$tmpSgrd" -FILLED "$filledSgrd" -MINSLOPE 0.01
if ($LASTEXITCODE -ne 0) { throw "SAGA 填洼失败，exit code: $LASTEXITCODE" }

# --- 2.3 导出 SAGA grid -> GeoTIFF (io_gdal 2 = Export GeoTIFF) ---
Write-Host "`n--- 2.3 io_gdal 2 导出 SAGA grid -> GeoTIFF ---" -ForegroundColor Cyan
& $saga io_gdal 2 -GRIDS "$filledSgrd" -FILE "$filledTif"
if ($LASTEXITCODE -ne 0) { throw "SAGA 导出失败，exit code: $LASTEXITCODE" }

# --- 验证 ---
Write-Host "`n--- gdalinfo 验证 $filledTif ---" -ForegroundColor Cyan
& $gdalinfo -norat -mm $filledTif | Select-String -Pattern `
    'Driver:|Size is|ID\["EPSG"|Origin =|Pixel Size =|Upper Left|Lower Right|Band 1|Computed Min/Max|NoData Value'

Write-Host "`n[步骤2 完成] 产物: $filledTif" -ForegroundColor Green
Write-Host "注意: SAGA 输出为 Float32 / NoData=-99999，步骤3 会还原为 Int16 / NoData=32767" -ForegroundColor Yellow
Write-Host "期望: EPSG:32648, 30m, 尺寸与 mosaic 一致, Min>=原始Min, Max<=原始Max" -ForegroundColor Yellow
