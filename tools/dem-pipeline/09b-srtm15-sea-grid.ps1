# =============================================================================
# 09b-srtm15-sea-grid.ps1
# DEM 预处理流水线 - 步骤 9b：SRTM15+ 海底 DEM → 工作格网（步骤 10 的海侧输入）
# =============================================================================
# 背景（2026-10-04 补）：
#   10-landsea-merge.py 的海侧输入 sea_custom.tif 此前**没有生成脚本**——原文件是一次性
#   手工命令的产物，`.tif` 又全程 gitignored ⇒ 干净检出复现不出海陆一体 DEM（台账 z047
#   的"workspace 内可复现"缺口）。本脚本把那两步固定下来，并与现役产物逐位比对通过。
#
# 链路（两步）：
#   [1] gdal_translate：全球 SRTM15+V2.6.nc → 裁到工作格网窗口（15″ 原生网格快照）
#       窗口 = 06-restore-cut-dem.ps1 的陆地裁切框（107.30-110.00E / 20.97-22.60N）。
#       -a_srs EPSG:4326 必须有：NETCDF 子数据集不带 CRS，缺它时 gdalwarp 会因
#       "未知源坐标系"产出 1×1 空图（2026-10-04 实测）。
#   [2] gdalwarp：重投影到陆地 cut 的**同一 CRS**（从 cut 现读 WKT，不手抄）、30m、
#       双线性、Float32、nodata=NaN。刻意不传 -te/-te_srs：本机 GDAL 对它们静默忽略
#       （10-landsea-merge.py 头注坑②），输出范围交给 GDAL 按源范围自动取。
#
# 复算证据（2026-10-04，对现役产物逐位比对）：
#   srtm_4326_full.tif  648×392  max|Δ|=0
#   sea_custom.tif     9357×6074 max|Δ|=0（NaN 掩膜也一致）
#   ⇒ 接 10-landsea-merge.py 产出的 landsea_utm48n.tif 与现役逐位一致（数组 md5 77f83a25…）
#
# 失效条件：
#   ① 换 SRTM15+ 版本/范围 ⇒ 第 [1] 步窗口须按新源重取并重跑比对；
#   ② 陆地 cut 换 CRS ⇒ 第 [2] 步自动跟随（现读 WKT），但产物网格会变，须重跑 10/11；
#   ③ 外置 nc 缺失 ⇒ 本脚本报错停下，不回退任何近似源。
# =============================================================================
#Requires -Version 5.1
param(
    [string]$Nc = 'C:\Users\JionHappY\Desktop\_北部湾项目\06-数据备份\数据_\项目数据\海底DEM\SRTM15_V2.6.nc',
    [string]$Cut = '',
    [string]$OutDir = ''
)
$ErrorActionPreference = 'Stop'
$repo = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
if (-not $Cut)    { $Cut = Join-Path $repo '.local\dem-work\filled_utm48n_cut.tif' }
if (-not $OutDir) { $OutDir = Join-Path $repo '.local\dem-sea-work' }

$gdalBin  = 'C:\Program Files\QGIS 3.44.12\bin'
$gdalTr   = Join-Path $gdalBin 'gdal_translate.exe'
$gdalWarp = Join-Path $gdalBin 'gdalwarp.exe'
$gdalSrs  = Join-Path $gdalBin 'gdalsrsinfo.exe'
$gdalInfo = Join-Path $gdalBin 'gdalinfo.exe'
foreach ($exe in @($gdalTr, $gdalWarp, $gdalSrs, $gdalInfo)) {
    if (-not (Test-Path $exe)) { throw "找不到 $exe" }
}
if (-not (Test-Path $Nc))  { throw "SRTM15+ 源不存在: $Nc" }
if (-not (Test-Path $Cut)) { throw "陆地 cut 不存在: $Cut（请先跑 06-restore-cut-dem.ps1）" }
New-Item -ItemType Directory -Force $OutDir | Out-Null

$full4326 = Join-Path $OutDir 'srtm_4326_full.tif'
$seaOut   = Join-Path $OutDir 'sea_custom.tif'
$crsFile  = Join-Path $OutDir 'srtm_work_crs.wkt'

# --- [1/2] 裁窗口（15″ 原生网格快照；窗口与陆地裁切框同一矩形）---
Write-Host '--- [1/2] gdal_translate：SRTM15+ → 工作窗口（EPSG:4326，15″ 快照）---'
$dsn = 'NETCDF:"{0}":z' -f ($Nc -replace '\\', '/')
& $gdalTr -q -a_srs EPSG:4326 -projwin 107.30 22.60 110.00 20.97 -of GTiff $dsn $full4326
if ($LASTEXITCODE -ne 0) { throw "gdal_translate 失败，exit $LASTEXITCODE" }

# --- [2/2] 重投影到 cut 的工作 CRS（30m 双线性，Float32/NaN）---
Write-Host '--- [2/2] gdalwarp：→ 工作格网（cut 的 CRS，30m，bilinear，nodata=NaN）---'
& $gdalSrs -o wkt1 $Cut | Out-File -Encoding ascii $crsFile
& $gdalWarp -q -overwrite -t_srs $crsFile -tr 30 30 -r bilinear -of GTiff -ot Float32 -dstnodata nan $full4326 $seaOut
if ($LASTEXITCODE -ne 0) { throw "gdalwarp 失败，exit $LASTEXITCODE" }

# --- 验证：网格尺寸 + 覆盖断言（海侧必须盖住陆地 cut 的四角，否则窗口取错当场红）---
# 用 gdalinfo 文本解析而不是 -json：本机 Windows PowerShell 5.1 的 ConvertFrom-Json
# 遇到元数据里的空键名会直接抛错（2026-10-04 实测）。
function Read-GdalInfo([string]$tif) {
    $txt = & $gdalInfo -norat $tif
    $size = [regex]::Match($txt, 'Size is (\d+), (\d+)')
    $ul = [regex]::Match($txt, 'Upper Left\s+\(\s*([-\d.]+),\s*([-\d.]+)\)')
    $lr = [regex]::Match($txt, 'Lower Right\s+\(\s*([-\d.]+),\s*([-\d.]+)\)')
    if (-not $size.Success -or -not $ul.Success -or -not $lr.Success) {
        throw "gdalinfo 输出无法解析（$tif）"
    }
    [pscustomobject]@{
        W = [int]$size.Groups[1].Value; H = [int]$size.Groups[2].Value
        ULx = [double]$ul.Groups[1].Value; ULy = [double]$ul.Groups[2].Value
        LRx = [double]$lr.Groups[1].Value; LRy = [double]$lr.Groups[2].Value
    }
}
Write-Host "`n--- 验证（对照现役：648×392 / 9357×6074）---"
$c = Read-GdalInfo $Cut
$s = Read-GdalInfo $seaOut
# 用 F1 而不是 N1：N 会按本机文化插千分位（实测打印成 427,204.8，肉眼难对）
Write-Host ("cut  {0}x{1}  UL=({2:F1},{3:F1})  LR=({4:F1},{5:F1})" -f $c.W, $c.H, $c.ULx, $c.ULy, $c.LRx, $c.LRy)
Write-Host ("sea  {0}x{1}  UL=({2:F1},{3:F1})  LR=({4:F1},{5:F1})" -f $s.W, $s.H, $s.ULx, $s.ULy, $s.LRx, $s.LRy)
# 覆盖断言：西/北边界必须不内缩；东/南允许 ≤150m（5 像元）缺口——现役一对的实测缺口是
# 东 91.6m（SRTM15+ 网格与 cut 网格不同源的自然落差，10-landsea-merge.py 用"最近邻兜底"
# 处理边界外采样）。缺口 >150m 说明窗口取错，当场红。
$gapE = $c.LRx - $s.LRx; $gapN = $c.ULy - $s.ULy
Write-Host ("缺口：东 {0:F1} m ｜ 北 {1:F1} m（阈值 150 m）" -f $gapE, $gapN)
if ($s.ULx -gt $c.ULx -or $s.LRy -gt $c.LRy -or $gapE -gt 150 -or $gapN -gt 150) {
    throw '海侧栅格覆盖不足（>150m）——窗口取错，产物不可用'
}
Write-Host '[步骤 9b 完成] 海侧输入就绪，可跑 10-landsea-merge.py' -ForegroundColor Green
