#!/usr/bin/env node
// verify.mjs — GIS 入库质检（T4.1 产物之一）：连 PG 按表跑质检四件套，输出 JSON 对账报告。
// 与 db-import.mjs 的 import-report 同一纪律：结构化输出、可断言、可进 CI（npm run verify-gis）。
//
// 用法:
//   node tools/gis-import/verify.mjs                    # 默认连 v3_dev，质检全部 gis 表
//   node tools/gis-import/verify.mjs --table=roads      # 单表质检
//   node tools/gis-import/verify.mjs --json             # 机器可读 JSON（CI 用）
//
// 连接参数走环境变量（缺省本机 v3_dev，对齐 docker-compose.v3.yml）：
//   GIS_DB_HOST / GIS_DB_PORT / GIS_DB_USER / GIS_DB_PASSWORD / GIS_DB_NAME
import { createRequire } from 'node:module'
import { resolve } from 'node:path'

const require = createRequire(resolve('backend/nest/package.json'))
const { Pool } = require('pg')

// 北部湾业务范围（EPSG:4326 经纬度）——单一事实源：backend/nest/src/common/constants/gis.constants.ts
// （GULF_BOUNDS）。工具脚本不经 TS 编译，此处内联同一数值，改范围须双处同步。
const GULF_BOUNDS = { minLng: 105, maxLng: 115, minLat: 18, maxLat: 25 }

const db = {
  host: process.env.GIS_DB_HOST ?? 'localhost',
  port: Number(process.env.GIS_DB_PORT ?? 5432),
  user: process.env.GIS_DB_USER ?? 'postgres',
  password: process.env.GIS_DB_PASSWORD ?? 'postgres',
  database: process.env.GIS_DB_NAME ?? 'v3_dev',
  connectionTimeoutMillis: 5000,
}

// 每表质检规格：期望 SRID、几何类型（首要素断言）、bbox 判定依据（表内任一几何越出业务边界即 FAIL）
// checkBBox：北部湾业务域数据（roads/POI 等）须全部落在业务边界内；
// protected_areas 为全国 WDPA 保护区（任务卡 T4.2 明确全量入库），跨省多边形合法越界，豁免
const TABLES = [
  { name: 'roads', geomType: 'LINESTRING', srid: 4490, checkBBox: true },
  { name: 'railways', geomType: 'LINESTRING', srid: 4490, checkBBox: true },
  { name: 'canal', geomType: 'LINESTRING', srid: 4490, checkBBox: true },
  { name: 'industrial_zones', geomType: 'MULTIPOLYGON', srid: 4490, checkBBox: true },
  { name: 'mangroves', geomType: 'MULTIPOLYGON', srid: 4490, checkBBox: true },
  { name: 'protected_areas', geomType: 'MULTIPOLYGON', srid: 4490, checkBBox: false },
]

function runChecks(spec) {
  const { minLng, maxLng, minLat, maxLat } = GULF_BOUNDS
  const bboxCheck =
    spec.checkBBox === false
      ? '(SELECT 0) AS out_of_bounds,'
      : `(SELECT count(*) FROM ${spec.name}
        WHERE geom IS NOT NULL AND NOT (
          ST_XMin(geom) >= ${minLng} AND ST_XMax(geom) <= ${maxLng} AND
          ST_YMin(geom) >= ${minLat} AND ST_YMax(geom) <= ${maxLat}
        )) AS out_of_bounds,`
  return `
    SELECT
      (SELECT count(*) FROM ${spec.name})                          AS count,
      (SELECT count(*) FROM ${spec.name}
        WHERE geom IS NOT NULL AND NOT ST_IsValid(geom))           AS invalid_geom,
      (SELECT count(*) FROM ${spec.name} WHERE geom IS NULL)       AS null_geom,
      ${bboxCheck}
      (SELECT count(*) FROM ${spec.name}
        WHERE geom IS NOT NULL AND GeometryType(geom) = '${spec.geomType}') AS typed_geom,
      (SELECT ST_SRID(geom) FROM ${spec.name} WHERE geom IS NOT NULL LIMIT 1) AS srid
  `
}

// 质检判定（纯函数，可单测）：由查询行构造 checks/entry。
// rows sample: { count, invalid_geom, null_geom, out_of_bounds, typed_geom, srid }
export function evaluateChecks(spec, row) {
  const count = Number(row.count)
  const typed = Number(row.typed_geom)
  const bboxExempt = spec.checkBBox === false
  const checks = {
    count: count > 0,
    srid: Number(row.srid) === spec.srid,
    invalid_geom: Number(row.invalid_geom) === 0,
    null_geom: count === 0 || Number(row.null_geom) === 0,
    bbox_ok: bboxExempt || count === 0 || Number(row.out_of_bounds) === 0,
    geom_type_ok: count === 0 || typed === count,
  }
  const empty = count === 0
  return {
    entry: {
      table: spec.name,
      count,
      srid: Number(row.srid),
      invalid_geom: Number(row.invalid_geom),
      bbox_ok: checks.bbox_ok,
      geom_type_ok: checks.geom_type_ok,
      // 空表 = 未导入，不算质检失败（全部导入完成后应全部非空）
      fail: empty
        ? ['not_imported']
        : Object.entries(checks)
            .filter(([, v]) => !v)
            .map(([k]) => k),
    },
    checks,
    empty,
  }
}

function formatLine(spec, { entry, checks, empty }) {
  return (
    `${empty ? 'SKIP' : entry.fail.length === 0 ? 'PASS' : 'FAIL'} ${spec.name.padEnd(18)} ` +
    `count=${String(entry.count).padStart(7)} srid=${entry.srid ?? '-'} invalid=${entry.invalid_geom} type=${checks.geom_type_ok ? 'ok' : 'BAD'}`
  )
}

async function verifyOne(pool, spec, json) {
  const { rows } = await pool.query(runChecks(spec))
  const { entry, checks, empty } = evaluateChecks(spec, rows[0])
  if (json) return entry
  console.log(formatLine(spec, { entry, checks, empty }))
  return entry
}

async function main() {
  const json = process.argv.includes('--json')
  const tableArg = process.argv.find((a) => a.startsWith('--table='))
  const specList = tableArg ? TABLES.filter((t) => t.name === tableArg.split('=')[1]) : TABLES

  const pool = new Pool(db)
  pool.on('error', (err) => {
    // pg 在空闲连接出错时 emit 'error'——无监听器会使进程静默崩溃（吞掉主流程 try/catch）
    console.error(err.message ?? String(err))
  })
  const results = []
  try {
    for (const spec of specList) {
      results.push(await verifyOne(pool, spec, json))
    }
  } finally {
    await pool.end()
  }

  const pass = results.every((r) => r.fail.length === 0)
  if (json) {
    process.stdout.write(
      JSON.stringify({ overall: pass ? 'PASS' : 'FAIL', tables: results }, null, 2) + '\n'
    )
  } else {
    console.log(`\n总体：${pass ? 'PASS' : 'FAIL'}（${results.length} 表）`)
  }
  process.exit(pass ? 0 : 1)
}

main().catch((e) => {
  const msg = e.message ?? String(e)
  const code = e?.code ?? ''
  if (code === 'ECONNREFUSED' || msg.includes('ECONNREFUSED') || msg.includes('connect')) {
    console.error(
      `无法连接 PostGIS（${db.host}:${db.port}/${db.database}）——容器是否启动？docker compose -f docker-compose.v3.yml up -d postgis`
    )
  } else {
    console.error(msg)
  }
  process.exit(1)
})
