<#
.SYNOPSIS
  Load v2 road-graph artifacts (TSV) into a PostGIS container and build the graph tables.

.DESCRIPTION
  The DB container has neither ogr2ogr/GDAL nor a host data mount, so:
    docker cp <TSV> /tmp  ->  psql -f roads-graph-import.sql  (raw load, \copy)
                          ->  psql -f roads-graph-build.sql   (directed costs, main component, indexes, self-checks)

  NOTE (target DB must have pgrouting): build step calls pgr_connectedComponents.
  The local compose image beibu-postgis ships postgis only -- point -Container at a
  pgrouting-capable container (e.g. bgr-review-pg), or CREATE EXTENSION pgrouting first.

  File is intentionally ASCII-only: Windows PowerShell 5.1 reads BOM-less UTF-8 files as
  ANSI/GBK, which shreds Chinese string literals and breaks parsing. Chinese prose lives in
  the .sql files and docs instead.

.EXAMPLE
  powershell -File tools/roads/import-roads-graph.ps1 -Container bgr-review-pg -Artifacts C:\osm\out

.NOTES
  PRODUCTION RUNBOOK (v2 graph rollout)
  -------------------------------------
  Step 0 (data, off-server): produce the artifacts with the extractor, on a machine with Python+pyosmium:
      python tools/osm/extract-roads-graph.py <out_dir> guangxi.osm.pbf guangdong.osm.pbf yunnan.osm.pbf hainan.osm.pbf
    (bbox default 106,20,111,24; province extracts come from download.openstreetmap.fr/extracts/asia/china/<prov>.osm.pbf)
    Outputs: beibu-roads-edges.tsv (~90 MB) + beibu-roads-vertices.tsv (~13 MB) + GeoJSON + meta.json (OSM snapshot stamp).

  Step 1 (prod DB): copy the two TSVs to the server, then run this script against the prod container:
      powershell -File tools/roads/import-roads-graph.ps1 -Container <prod-pg> -Artifacts <tsv_dir>
    It performs: docker cp -> roads-graph-import.sql (\copy into *_raw) -> roads-graph-build.sql
    (route_class_profile, roads_vertices, roads_edges with directed costs, main component, indexes, self-checks).
    The build is idempotent; a failed self-check aborts with a RAISE EXCEPTION (no partial graph silently kept).

  Step 2: redeploy the backend (route.repository already targets roads_edges and passes directed := true).
          The old roads_noded table stays in place as the rollback path (revert the commit + change ROUTING_TABLE back).

  Step 3: health-check with the QA queries, then watch one release before dropping the legacy table:
      psql -f tools/roads/roads-graph-qa.sql

  Caveats
    - /route/path is briefly unavailable while the graph is rebuilt (run in a low-traffic window).
    - The prod DB must have the pgrouting extension (build step uses pgr_connectedComponents).
#>
param(
  [string]$Container = 'beibu-postgis',
  [string]$Db = 'v3_dev',
  [string]$PgUser = 'postgres',
  [string]$Artifacts = 'C:\osm\out',
  [switch]$SkipBuild
)

$ErrorActionPreference = 'Stop'
$sqlDir = $PSScriptRoot

foreach ($f in 'beibu-roads-edges.tsv', 'beibu-roads-vertices.tsv') {
  $p = Join-Path $Artifacts $f
  if (-not (Test-Path $p)) {
    throw "Missing artifact: $p (run tools/osm/extract-roads-graph.py first)"
  }
  $mb = '{0:N1}' -f ((Get-Item $p).Length / 1MB)
  Write-Output "cp $f -> ${Container}:/tmp/  ($mb MB)"
  docker cp $p "${Container}:/tmp/$f"
}

foreach ($s in 'roads-graph-import.sql', 'roads-graph-build.sql') {
  docker cp (Join-Path $sqlDir $s) "${Container}:/tmp/$s"
}

Write-Output '--- raw load ---'
docker exec $Container psql -U $PgUser -d $Db -v ON_ERROR_STOP=1 -f /tmp/roads-graph-import.sql
if ($LASTEXITCODE -ne 0) { throw 'raw load failed' }

if (-not $SkipBuild) {
  Write-Output '--- build graph + self-checks ---'
  docker exec $Container psql -U $PgUser -d $Db -v ON_ERROR_STOP=1 -f /tmp/roads-graph-build.sql
  if ($LASTEXITCODE -ne 0) { throw 'graph build failed (see self-check errors above)' }
}

Write-Output 'Done.'
