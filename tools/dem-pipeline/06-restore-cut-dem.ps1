# =============================================================================
# 06-restore-cut-dem.ps1
# DEM 预处理流水线 - 步骤6：复原/重建 filled_utm48n_cut.tif（2026-08-30 全链路重算版）
# =============================================================================
# 背景：
#   原 filled_utm48n_cut.tif（169MB，gitignored）8-27 被一次性清理删除，git 无存。
#   2026-08-30 用户拍板"旧 DEM 派生数据全部换新、彻底覆盖"，全链路以
#   "ASTER 填洼版 + 海岸线矢量海掩膜" 重建本文件并重算 251 档/六档/剖面/设施高程。
#
# 源选择实证（面试可讲）：
#   - ASTER GDEM：沿海低地真实（0~11m），但海面为整 0 值非 nodata → 不掩膜则海面全算淹没；
#   - GLO-30：海面 0~13m 成片伪值、大陆侧沿海偏高 12~30m → 掩膜后淹没量崩塌，不适用；
#   - WorldCover 水类外海 75% 缺失、水域矢量不含海 → 均不可用；
#   - 海岸线矢量（beibu-coastline.geojson，~14m 顶点间距）→ "岸线以南=海" 标准制图约定。
#
# 链路：06-sea-mask.py（ASTER 填洼版 + 海岸线掩膜）→ gdalwarp 同网格裁切
#       （UTM48N/30m，-r near，nodata 归一 32767/Int16）→ filled_utm48n_cut.tif
# 裁切框：107.30-110.00E / 20.97-22.60N（251 档产物 bbox 反推 + 边距）。
#
# 已知取舍（披露）：岛屿（涠洲岛等）位于大陆岸线以南，并入海掩膜；
#   滩涂（岸线以南 intertidal）计入海，低档淹没仅含岸线以北沿海低地。
#
# 2026-10-04 修订（本脚本此前跑不起来，四处死路径 + 一处缺参，逐条修）：
#   ① venv：backend/flood-service/.venv 已随 FastAPI 移除 ⇒ 改 backend/algorithm-service/.venv；
#   ② ASTER 源与输出：原写 Desktop\数据_\... 单点，实际原件在 06-数据备份\数据_\...；
#      中间件与 cut 改回 workspace（.local\dem-work\），与 10-landsea-merge.py / 07b 的默认读入一致；
#   ③ 海掩膜缺第 4 参（测深栅格）：只跑海岸线单判据 = 2026-08-30 旧行为（会把码头岸线抹成海），
#      现补 $bathy=sea_custom.tif（由 09b-srtm15-sea-grid.ps1 生成、与 DEM 同 CRS 的投影栅格）；
#   ④ diag_datum 路径：实际在 tools\diag\diag_datum.py（原写 tools\diag_datum.py）。
#   python 调用一律加 -X utf8：脚本 stdout 含 "km²" 等字符，GBK 控制台会 UnicodeEncodeError。
#
# 复算证据（2026-10-04，对现役 cut 逐位比对）：本脚本两步产出的 filled_utm48n_cut.tif
#   与 .local\dem-work\filled_utm48n_cut.tif 逐像元差 0（数组 md5 ed15d45e…）。
# =============================================================================
#Requires -Version 5.1
$ErrorActionPreference = 'Stop'

# --- 路径配置 ---
$gdalBin  = 'C:\Program Files\QGIS 3.44.12\bin'
$gdalwarp = Join-Path $gdalBin 'gdalwarp.exe'
$repo     = 'C:\workspace\beibu-gulf-project'
$venvPy   = Join-Path $repo 'backend\algorithm-service\.venv\Scripts\python.exe'
$aster    = 'C:\Users\JionHappY\Desktop\_北部湾项目\06-数据备份\数据_\项目数据\浸没分析\处理成果\filled_CGCS2000_int16.tif'
$coast    = 'C:\Users\JionHappY\Desktop\_北部湾项目\06-数据备份\数据_\项目数据\海岸线\beibu-coastline.geojson'
$bathy    = Join-Path $repo '.local\dem-sea-work\sea_custom.tif'
$masked   = Join-Path $repo '.local\dem-work\aster_coastmasked.tif'
$dstTif   = Join-Path $repo '.local\dem-work\filled_utm48n_cut.tif'

if (-not (Test-Path $gdalwarp)) { throw "找不到 gdalwarp.exe: $gdalwarp" }
if (-not (Test-Path $venvPy))   { throw "找不到 venv python: $venvPy" }
if (-not (Test-Path $aster))    { throw "ASTER 填洼版不存在: $aster" }
if (-not (Test-Path $coast))    { throw "海岸线不存在: $coast" }
if (-not (Test-Path $bathy))    { throw "测深栅格不存在: $bathy（请先跑 09b-srtm15-sea-grid.ps1）" }
New-Item -ItemType Directory -Force (Split-Path $masked) | Out-Null
New-Item -ItemType Directory -Force (Split-Path $dstTif) | Out-Null

# --- 1. 海岸线海掩膜（ASTER 填洼版 -> 掩膜版）---
Write-Host "--- [1/2] 06-sea-mask.py：海岸线 ∩ 测深 ∩ 源DEM 三判据置 nodata ---"
& $venvPy -X utf8 (Join-Path $repo 'tools\dem-pipeline\06-sea-mask.py') $aster $masked $coast $bathy
if ($LASTEXITCODE -ne 0) { throw "06-sea-mask.py 失败" }

# --- 2. 同网格裁切 + nodata/dtype 归一 ---
Write-Host "--- [2/2] gdalwarp 裁切 -> filled_utm48n_cut.tif ---"
& $gdalwarp -srcnodata 32767 -dstnodata 32767 -ot Int16 -tr 30 30 -r near `
    -te_srs EPSG:4326 -te 107.30 20.97 110.00 22.60 `
    -of GTiff -co TILED=YES -co COMPRESS=LZW -co BIGTIFF=IF_SAFER `
    $masked $dstTif -overwrite
if ($LASTEXITCODE -ne 0) { throw "gdalwarp 失败，exit code: $LASTEXITCODE" }

# --- 验证：重算后跑 diag_datum（判据 <5%）---
Write-Host "`n--- 验证：diag_datum ---"
& $venvPy -X utf8 (Join-Path $repo 'tools\diag\diag_datum.py') $dstTif
Write-Host "完成：$dstTif（随后重跑 tools/flood/engine/precompute_levels.py + tools/flood/flood_realify.py 刷新全部派生数据）"
