// v3 data downloader (Node) - works in sandboxed shells where Windows schannel TLS is blocked.
// REQUIRED: node >= 24 with --use-env-proxy, and HTTPS_PROXY/HTTP_PROXY env pointing to a
// working proxy (e.g. http://127.0.0.1:7890).
//
// Usage:
//   $env:HTTPS_PROXY = "http://127.0.0.1:7890"; $env:HTTP_PROXY = "http://127.0.0.1:7890"
//   node --use-env-proxy tools/download-v3-data.mjs "C:\Users\JionHappY\Desktop\项目数据" [--osm] [--bathymetry]
//
// Features: Range-based resume, 5x retry, 4-way concurrency for tiles, progress log.
// SRTM 30m is NOT included: the public skadi bucket no longer serves those keys (2026-08 verified);
// Copernicus GLO-30 (better quality) covers the land-DEM requirement.

import fs from 'node:fs'
import path from 'node:path'

const target = process.argv[2] ?? 'C:\\Users\\JionHappY\\Desktop\\项目数据'
const includeOsm = process.argv.includes('--osm')
const includeBathy = process.argv.includes('--bathymetry')

const RETRIES = 5
const CONCURRENCY = 4

function ensureDir(p) {
  fs.mkdirSync(p, { recursive: true })
}

async function download(url, file) {
  const tmp = file + '.part'
  let existing = 0
  try {
    existing = fs.existsSync(tmp) ? fs.statSync(tmp).size : 0
  } catch {}
  for (let attempt = 1; attempt <= RETRIES; attempt++) {
    try {
      const headers = existing > 0 ? { Range: `bytes=${existing}-` } : {}
      const res = await fetch(url, { headers, redirect: 'follow' })
      if (res.status === 416) {
        // Range not satisfiable -> file already complete
        fs.renameSync(tmp, file)
        console.log(`[done] ${path.basename(file)} (already complete)`)
        return true
      }
      if (!res.ok && res.status !== 206) {
        throw new Error(`HTTP ${res.status}`)
      }
      const mode = existing > 0 && res.status === 206 ? 'a' : 'w'
      if (res.status === 200) existing = 0 // server ignored range, restart
      const out = fs.createWriteStream(tmp, { flags: mode })
      const reader = res.body.getReader()
      let total = existing
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        if (!out.write(value)) await new Promise((r) => out.once('drain', r))
        total += value.length
      }
      await new Promise((r) => out.end(r))
      fs.renameSync(tmp, file)
      const mb = (total / 1048576).toFixed(1)
      console.log(`[done] ${path.basename(file)} ${mb} MB`)
      return true
    } catch (e) {
      // keep partial for resume
      try { existing = fs.existsSync(tmp) ? fs.statSync(tmp).size : 0 } catch {}
      console.log(`[retry ${attempt}/${RETRIES}] ${path.basename(file)}: ${e.message} (resume @ ${existing})`)
      await new Promise((r) => setTimeout(r, 2000 * attempt))
    }
  }
  console.log(`[FAIL] ${path.basename(file)}`)
  return false
}

async function runBatch(urls) {
  let i = 0
  let ok = 0
  const worker = async () => {
    while (i < urls.length) {
      const { url, file } = urls[i++]
      if (await download(url, file)) ok++
    }
  }
  await Promise.all(Array.from({ length: CONCURRENCY }, worker))
  return ok
}

const base = target
const dirGl30 = path.join(base, '陆地DEM-30m', 'Copernicus-GLO30')
const dirOsm = path.join(base, '路网', 'OSM-China')
const dirBathy = path.join(base, '海底DEM')
ensureDir(dirGl30)
ensureDir(dirOsm)
ensureDir(dirBathy)

const gl30 = []
for (let lat = 20; lat <= 23; lat++) {
  for (let lon = 106; lon <= 110; lon++) {
    const name = `Copernicus_DSM_COG_10_N${lat}_00_E${lon}_00_DEM`
    gl30.push({
      url: `https://copernicus-dem-30m.s3.amazonaws.com/${name}/${name}.tif`,
      file: path.join(dirGl30, `${name}.tif`),
    })
  }
}

const osm = []
if (includeOsm) {
  osm.push({
    url: 'https://download.geofabrik.de/asia/china-latest.osm.pbf',
    file: path.join(dirOsm, 'china-latest.osm.pbf'),
  })
}

const bathy = []
if (includeBathy) {
  bathy.push({
    url: 'https://topex.ucsd.edu/pub/srtm15_plus/SRTM15_V2.6.nc',
    file: path.join(dirBathy, 'SRTM15_V2.6.nc'),
  })
}

console.log(`[plan] GLO-30 tiles: ${gl30.length}, OSM: ${osm.length}, bathymetry: ${bathy.length}`)
console.log(`[plan] target: ${base}`)

const gl30Ok = await runBatch(gl30)
console.log(`[summary] GLO-30: ${gl30Ok}/${gl30.length}`)
if (osm.length) console.log(`[summary] OSM: ${(await runBatch(osm))}/${osm.length}`)
if (bathy.length) console.log(`[summary] bathymetry: ${(await runBatch(bathy))}/${bathy.length}`)
console.log('[all done]')
