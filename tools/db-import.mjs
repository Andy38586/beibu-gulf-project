// v3 数据入库脚本 v2 —— 读现有 JSON(仓库 backend/data/) -> 生成 SQL(import.sql) + 对账报告(import-report.md)
// 用法: node tools/db-import.mjs
// 然后: docker cp .tmp-pip/import.sql beibu-postgis:/tmp/ && docker exec beibu-postgis psql -U postgres -d v3_dev -f /tmp/import.sql
//
// v2 硬化（手册 T2.2）：三城化映射（qz/bh/fcg）｜运行时文件缺失容错｜逐表对账报告｜幂等（TRUNCATE 重灌语义）
// 纯函数 buildImport 供单测注入 fixture（backend/__tests__/tools/db-import.test.js）
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'

const esc = (v) => (v == null ? 'NULL' : `'${String(v).replaceAll("'", "''")}'`)
const pt = (lng, lat) =>
  lng == null || lat == null ? 'NULL' : `ST_SetSRID(ST_MakePoint(${lng}, ${lat}), 4490)`

// ===== 显式映射常量（新增类型/城市只改这里）=====
const CITIES = [
  ['qz', '钦州'],
  ['bh', '北海'],
  ['fcg', '防城港'],
]
// [文件名段, poi_facilities.type 值]——与前端 facilityConfig 的类型 key 对齐
const POI_TYPES = [
  ['hospital', 'hospital'],
  ['primary_school', 'primary_school'],
  ['middle_school', 'middle_school'],
  ['park', 'park'],
  ['bus_station', 'bus_station'],
  ['mall', 'mall'],
]

/** 读存在则返回解析结果，不存在返回 null（运行时文件容错，记入对账报告） */
function readOptional(dataDir, p, report) {
  const full = path.join(dataDir, p)
  if (!fs.existsSync(full)) {
    report.warnings.push(`源文件不存在，按空集处理: ${p}`)
    return null
  }
  return JSON.parse(fs.readFileSync(full, 'utf8'))
}

/**
 * 构建导入语句与对账报告（纯函数，可测）
 * @param {string} dataDir backend/data 绝对/相对路径
 * @param {{warnings: string[]}} report 警告收集器
 * @returns {{ statements: string[], tables: Record<string, {source:number, written:number, filtered:number}> }}
 */
export function buildImport(dataDir, report = { warnings: [] }) {
  const statements = []
  const tables = {}

  const begin = (name) => (tables[name] ??= { source: 0, written: 0, filtered: 0 })

  statements.push('BEGIN;')
  // 幂等语义：TRUNCATE 重灌——开发库全量重建，重跑结果一致（专项5 指标 8.2）
  statements.push(
    'TRUNCATE users, plans, favorites, ports, poi_facilities, xiaoqu, flood_facilities, data_archive RESTART IDENTITY CASCADE;'
  )

  // ===== users（运行时文件；password 占位——Nest 重建认证后旧密码失效，用户已于 v3 路径确认）=====
  const users = readOptional(dataDir, 'users.json', report) ?? []
  const usersT = begin('users')
  usersT.source = users.length
  for (const u of users) {
    statements.push(
      `INSERT INTO users (id, username, password, token_version, created_at) VALUES (${esc(u.id)}, ${esc(u.username)}, 'v3-migrated', ${u.tokenVersion ?? 0}, ${esc(u.createdAt)});`
    )
    usersT.written++
  }

  // ===== plans（孤儿方案过滤：外键约束会拦，导入前过滤并计入 filtered）=====
  const plans = readOptional(dataDir, 'plans.json', report) ?? []
  const plansT = begin('plans')
  plansT.source = plans.length
  const validUserIds = new Set(users.map((u) => u.id))
  for (const p of plans) {
    if (!validUserIds.has(p.userId)) {
      plansT.filtered++
      report.warnings.push(`跳过孤儿方案 ${p.id}（userId 不在 users 中）`)
      continue
    }
    statements.push(
      `INSERT INTO plans (id, user_id, name, payload, created_at, updated_at) VALUES (${esc(p.id)}, ${esc(p.userId)}, ${esc(p.name)}, '${JSON.stringify(p).replaceAll("'", "''")}', ${esc(p.createdAt)}, ${esc(p.updatedAt)});`
    )
    plansT.written++
  }

  // ===== favorites（运行时文件，2026-09-01 时点不存在，按空集处理）=====
  const favorites = readOptional(dataDir, 'favorites.json', report) ?? []
  const favT = begin('favorites')
  favT.source = favorites.length
  for (const f of favorites) {
    statements.push(
      `INSERT INTO favorites (user_id, item_type, item_id, created_at) VALUES (${esc(f.userId)}, ${esc(f.itemType)}, ${esc(f.itemId)}, ${esc(f.createdAt)});`
    )
    favT.written++
  }

  // ===== ports（源已迁至前端静态目录——GET /ports 端点删除时回迁；backend/data 优先）=====
  const portsPath = fs.existsSync(path.join(dataDir, 'ports.json'))
    ? 'backend/data/ports.json'
    : 'frontend/public/data/ports.json'
  const ports = fs.existsSync(portsPath) ? JSON.parse(fs.readFileSync(portsPath, 'utf8')) : []
  if (!fs.existsSync(path.join(dataDir, 'ports.json'))) {
    report.warnings.push(`ports 源回退至 ${portsPath}（backend/data/ports.json 已不存在）`)
  }
  const portsT = begin('ports')
  portsT.source = ports.length
  for (const p of ports) {
    statements.push(
      `INSERT INTO ports (id, name, address, type, phone, geom) VALUES (${esc(p.id)}, ${esc(p.name)}, ${esc(p.address)}, ${esc(p.type)}, ${esc(p.phone)}, ${pt(p.lng, p.lat)});`
    )
    portsT.written++
  }

  // ===== poi_facilities（三城 × 6 类）=====
  const poiT = begin('poi_facilities')
  for (const [city] of CITIES) {
    for (const [fileKey, type] of POI_TYPES) {
      const items = readOptional(dataDir, `site-selection/${city}_${fileKey}.json`, report) ?? []
      poiT.source += items.length
      for (const f of items) {
        if (f.lng == null || f.lat == null) {
          poiT.filtered++
          report.warnings.push(`跳过缺坐标 POI ${f.id}（${city}_${fileKey}）`)
          continue
        }
        statements.push(
          `INSERT INTO poi_facilities (id, type, name, district, city, geom) VALUES (${esc(f.id)}, '${type}', ${esc(f.name)}, ${esc(f.district)}, '${city}', ${pt(f.lng, f.lat)});`
        )
        poiT.written++
      }
    }
  }

  // ===== xiaoqu（三城）=====
  const xqT = begin('xiaoqu')
  for (const [city] of CITIES) {
    const items = readOptional(dataDir, `site-selection/${city}_xiaoqu.json`, report) ?? []
    xqT.source += items.length
    for (const x of items) {
      if (x.lng == null || x.lat == null) {
        xqT.filtered++
        report.warnings.push(`跳过缺坐标小区 ${x.id}（${city}_xiaoqu）`)
        continue
      }
      statements.push(
        `INSERT INTO xiaoqu (id, name, district, city, geom) VALUES (${esc(x.id)}, ${esc(x.name)}, ${esc(x.district)}, '${city}', ${pt(x.lng, x.lat)});`
      )
      xqT.written++
    }
  }

  // ===== flood_facilities =====
  const fp = readOptional(dataDir, 'flood/facilityPoints.json', report) ?? { facilities: [] }
  const floodT = begin('flood_facilities')
  floodT.source = fp.facilities?.length ?? 0
  for (const f of fp.facilities ?? []) {
    statements.push(
      `INSERT INTO flood_facilities (id, name, type, port, elevation, value, damage_rate, risk_level, geom) VALUES (${esc(f.id)}, ${esc(f.name)}, ${esc(f.type)}, ${esc(f.port)}, ${f.elevation}, ${f.value}, ${f.damageRate}, ${esc(f.riskLevel)}, ${pt(f.lng, f.lat)});`
    )
    floodT.written++
  }

  // ===== data_archive（静态真数据原样存档；假数据/mock 不入库；ports 已有独立表且源在前端静态，不再存档）=====
  const archiveFiles = [
    ...['index', 'cargo', 'container', 'container_model', 'throughput_model', 'traffic', 'berth']
      .filter((n) => fs.existsSync(path.join(dataDir, `forecast/${n}.json`)))
      .map((n) => `forecast/${n}.json`),
    ...CITIES.flatMap(([city]) =>
      [...POI_TYPES.map(([k]) => k), 'xiaoqu'].map((k) => `site-selection/${city}_${k}.json`)
    ),
    ...[
      'facilityPoints',
      'floodArea',
      'floodStatistics',
      'waterLevel',
      'water-area',
      'terrainProfile',
    ]
      .filter((n) => fs.existsSync(path.join(dataDir, `flood/${n}.json`)))
      .map((n) => `flood/${n}.json`),
  ]
  const archiveT = begin('data_archive')
  archiveT.source = archiveFiles.length
  for (const rel of archiveFiles) {
    const raw = fs.readFileSync(path.join(dataDir, rel), 'utf8')
    const sha = crypto.createHash('sha256').update(raw).digest('hex')
    const payload = raw.replaceAll("'", "''")
    statements.push(
      `INSERT INTO data_archive (name, payload, sha256) VALUES (${esc(rel)}, '${payload}'::jsonb, '${sha}');`
    )
    archiveT.written++
  }

  statements.push('COMMIT;')
  return { statements, tables }
}

/** 对账报告 markdown（每表 source/written/filtered 全等即 PASS） */
export function renderReport(tables, warnings) {
  const lines = [
    '# 数据迁移对账报告',
    '',
    `生成时间：${new Date().toISOString()}`,
    '',
    '| 表 | 源条数 | 写入 | 过滤 | 结果 |',
    '| --- | --- | --- | --- | --- |',
  ]
  let allPass = true
  for (const [name, t] of Object.entries(tables)) {
    const pass = t.source === t.written + t.filtered
    if (!pass) allPass = false
    lines.push(
      `| ${name} | ${t.source} | ${t.written} | ${t.filtered} | ${pass ? 'PASS' : 'FAIL'} |`
    )
  }
  lines.push('', `**总体：${allPass ? 'PASS' : 'FAIL'}**`)
  if (warnings.length) {
    lines.push('', '## 警告', '', ...warnings.map((w) => `- ${w}`))
  }
  return lines.join('\n')
}

// ===== CLI 入口（仅直接执行时运行；被测试 import 时不触发）=====
if (
  process.argv[1] &&
  import.meta.url === new URL(`file://${process.argv[1].replaceAll('\\', '/')}`).href
) {
  const report = { warnings: [] }
  const { statements, tables } = buildImport('backend/data', report)

  fs.mkdirSync('.tmp-pip', { recursive: true })
  fs.writeFileSync('.tmp-pip/import.sql', statements.join('\n'), 'utf8')
  fs.writeFileSync('.tmp-pip/import-report.md', renderReport(tables, report.warnings), 'utf8')

  const summary = Object.entries(tables)
    .map(([n, t]) => `${n} ${t.written}/${t.source}`)
    .join(', ')
  console.log(`generated import.sql: ${statements.length - 2} statements`)
  console.log(`report: .tmp-pip/import-report.md (${summary})`)
}
