# =============================================================================
# 06-restore-cut-dem.ps1
# DEM 预处理流水线 - 步骤6：复原 filled_utm48n_cut.tif（2026-08-30 新增）
# =============================================================================
# 背景：
#   原 filled_utm48n_cut.tif（169MB，gitignored）于 8-27 被本机清理进程删除，
#   git 历史无此文件（被忽略）。workspace dem/ 目录写入的副本实测分钟级再被删，
#   故复原落盘到 Desktop 处理成果目录（清理范围外），flood_engine.DEM_PATH
#   多级回退（FLOOD_DEM_PATH > workspace dem/ > Desktop 处理成果）。
#
# 口径披露（重要——不得包装为旧口径）：
#   - 源为 Copernicus GLO-30（gl30_filled_utm48n.tif，SAGA Wang & Liu 填洼，
#     海域原生 nodata），非旧 ASTER 链。旧 cut 的海面处理为 ad-hoc 步骤未入库，
#     不可复现；且冻结 251 档表本身含海面残差口径（2.5 档多边形实为外海条带）。
#   - 复原版与冻结表存在口径漂移（分档面积 −10~−40%，diag_datum 15~22%）。
#     冻结表仍是滑块权威口径；复原版仅服务查表 miss 的兜底演算与重生成能力。
#   - 垂直基准与旧产物一致（EGM96 系，diag_datum.py 可复测）。
#
# 输入：数据_/项目数据/陆地DEM-30m/处理成果/gl30_filled_utm48n.tif
# 输出：数据_/项目数据/浸没分析/处理成果/filled_utm48n_cut.tif
#       （可选再复制一份到 backend/data/flood/dem/，被删亦无妨）
# =============================================================================
#Requires -Version 5.1
$ErrorActionPreference = 'Stop'

# --- 路径配置 ---
$gdalBin  = 'C:\Program Files\QGIS 3.44.12\bin'
$gdalwarp = Join-Path $gdalBin 'gdalwarp.exe'
$srcTif   = 'C:\Users\JionHappY\Desktop\_北部湾项目\数据_\项目数据\陆地DEM-30m\处理成果\gl30_filled_utm48n.tif'
$dstTif   = 'C:\Users\JionHappY\Desktop\_北部湾项目\数据_\项目数据\浸没分析\处理成果\filled_utm48n_cut.tif'

if (-not (Test-Path $gdalwarp)) { throw "找不到 gdalwarp.exe: $gdalwarp" }
if (-not (Test-Path $srcTif))   { throw "GLO-30 填洼版不存在: $srcTif" }

# --- 裁切 + 投影归一（源已是 EPSG:32648/30m，同网格纯裁切，near 保真）---
# 裁切框由 251 档产物多边形 bbox 反推 + 边距：107.30-110.00E / 20.97-22.60N
# -srcnodata -99999（SAGA 约定）→ -dstnodata 32767（引擎/旧产物约定）
Write-Host "--- gdalwarp 裁切 GLO-30 填洼版 -> filled_utm48n_cut.tif ---"
& $gdalwarp -srcnodata -99999 -dstnodata 32767 -ot Int16 -tr 30 30 -r near `
    -te_srs EPSG:4326 -te 107.30 20.97 110.00 22.60 `
    -of GTiff -co TILED=YES -co COMPRESS=LZW -co BIGTIFF=IF_SAFER `
    $srcTif $dstTif -overwrite
if ($LASTEXITCODE -ne 0) { throw "gdalwarp 失败，exit code: $LASTEXITCODE" }

# --- 验证：与冻结表分档比对（漂移在披露范围内即通过）---
Write-Host "`n--- 验证：diag_datum + 分档比对 ---"
$venvPy = 'c:\workspace\beibu-gulf-project\backend\flood-service\.venv\Scripts\python.exe'
& $venvPy c:\workspace\beibu-gulf-project\tools\diag_datum.py $dstTif
Write-Host "完成：$dstTif"
