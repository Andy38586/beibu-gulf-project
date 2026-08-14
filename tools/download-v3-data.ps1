# v3 Data Downloader (run when network is available)
# Downloads free GIS data for the Beibu Gulf v3 project into the data folder.
# Requires: Windows 10+ (ships curl.exe). Optional: osmium (see docs) for OSM clipping.
# Usage:
#   powershell -ExecutionPolicy Bypass -File tools\download-v3-data.ps1
#   powershell -ExecutionPolicy Bypass -File tools\download-v3-data.ps1 -IncludeOSM -IncludeBathymetry
# Notes:
#   - Resume supported: re-run to continue interrupted downloads (curl -C -).
#   - Sources are public AWS/NOAA/Geofabrik endpoints; no registration needed.
#   - Registration-required sources (GlobeLand30 / Esri LC / GMW / WDPA) are NOT downloaded
#     here; see docs/v3-data-acquisition-2026-08-14.md (Chinese) for manual steps.

param(
  [string]$Target = "C:\Users\JionHappY\Desktop\项目数据",
  [switch]$IncludeOSM,        # China OSM extract ~1.4GB (roads + railways)
  [switch]$IncludeBathymetry  # SRTM15+ global bathymetry ~2.6GB (15 arc-sec)
)

$ErrorActionPreference = 'Continue'
$script:failCount = 0

function Ensure-Dir([string]$p) { New-Item -ItemType Directory -Force -Path $p | Out-Null }

function Get-File([string]$url, [string]$out) {
  Write-Host "[GET] $url" -ForegroundColor Cyan
  # -L follow redirects; -C - resume; --retry for flaky networks; --create-dirs
  & curl.exe -L -C - --retry 5 --retry-delay 3 --connect-timeout 30 -o $out $url 2>&1 | Out-Null
  if ($LASTEXITCODE -eq 0 -and (Test-Path $out)) {
    $mb = [math]::Round((Get-Item $out).Length / 1MB, 1)
    Write-Host "  OK  $out ($mb MB)" -ForegroundColor Green
  } else {
    Write-Host "  FAIL $url (exit $LASTEXITCODE) - check network/proxy" -ForegroundColor Red
    $script:failCount++
  }
}

# ---- folder skeleton ----
$base = $Target
$dirSrtm  = Join-Path $base "陆地DEM-30m\SRTM"
$dirGl30  = Join-Path $base "陆地DEM-30m\Copernicus-GLO30"
$dirBathy = Join-Path $base "海底DEM\SRTM15+"
$dirOsm   = Join-Path $base "路网\OSM-China"
$dirPoly  = Join-Path $base "多边形"
foreach ($d in @($dirSrtm, $dirGl30, $dirBathy, $dirOsm, $dirPoly)) { Ensure-Dir $d }

# ---- 1. Copernicus GLO-30 (ESA/AWS public bucket, ~30-60MB/tile) ----
# NOTE 2026-08-14: SRTM 30m skadi tiles removed from the public AWS bucket (NoSuchKey);
# GLO-30 is the primary land DEM (better quality than SRTM/ASTER). Use tools/download-v3-data.mjs
# instead of this script inside sandboxed shells (schannel TLS blocked there).
$gl30Base = "https://copernicus-dem-30m.s3.amazonaws.com"
Write-Host "`n=== Copernicus GLO-30 tiles (lat 20-23, lon 106-110) ===" -ForegroundColor Yellow
foreach ($lat in 20..23) {
  foreach ($lon in 106..110) {
    $name = "Copernicus_DSM_COG_10_N{0}_00_E{1}_00_DEM" -f $lat, $lon
    Get-File "$gl30Base/$name/$name.tif" (Join-Path $dirGl30 "$name.tif")
  }
}

# ---- 3. Bathymetry (optional, large) ----
if ($IncludeBathymetry) {
  Write-Host "`n=== SRTM15+ bathymetry (global 15 arc-sec, ~2.6GB) ===" -ForegroundColor Yellow
  Get-File "https://topex.ucsd.edu/pub/srtm15_plus/SRTM15+V2.6.nc" (Join-Path $dirBathy "SRTM15+V2.6.nc")
} else {
  Write-Host "`n[skip] Bathymetry (use -IncludeBathymetry to download SRTM15+, ~2.6GB)" -ForegroundColor DarkGray
}

# ---- 4. OSM China (optional, large; contains highway=* and railway=*) ----
if ($IncludeOSM) {
  Write-Host "`n=== OSM China extract (~1.4GB) ===" -ForegroundColor Yellow
  Get-File "https://download.geofabrik.de/asia/china-latest.osm.pbf" (Join-Path $dirOsm "china-latest.osm.pbf")
} else {
  Write-Host "`n[skip] OSM China (use -IncludeOSM, ~1.4GB; then clip Guangxi bbox with osmium)" -ForegroundColor DarkGray
}

# ---- summary ----
Write-Host "`n=== SUMMARY ===" -ForegroundColor Yellow
if ($script:failCount -eq 0) {
  Write-Host "All downloads completed. Folder: $base" -ForegroundColor Green
} else {
  Write-Host "$($script:failCount) download(s) failed. Fix network/proxy then re-run (resume supported)." -ForegroundColor Red
}
Write-Host "`nManual sources (registration required) - see docs/v3-数据获取清单-2026-08-14.md:"
Write-Host "  - GlobeLand30 2020 (cropland): http://www.globallandcover.com"
Write-Host "  - Esri 10m Land Cover 2020: https://www.arcgis.com/home/item.html?id=cfcb7609e563f475af5eaa108fc570c5"
Write-Host "  - Global Mangrove Watch v3 (mangroves): https://data.unep-wcmc.org/datasets/45"
Write-Host "  - WDPA (protected areas): https://www.protectedplanet.net"
