// v3 数据入库脚本 —— 读现有 JSON(仓库 backend/data/) -> 生成 SQL(INSERT)，供 docker exec psql 执行
// 用法: node tools/db-import.mjs   (输出到 .tmp-pip/import.sql)
// 然后: docker cp .tmp-pip/import.sql beibu-postgis:/tmp/ && docker exec beibu-postgis psql -U postgres -d v3_dev -f /tmp/import.sql
import crypto from 'node:crypto'
import fs from 'node:fs'

const B = (p) => JSON.parse(fs.readFileSync('backend/data/' + p, 'utf8'))
const esc = (v) => (v == null ? 'NULL' : `'${String(v).replaceAll("'", "''")}'`)
const pt = (lng, lat) =>
  lng == null || lat == null ? 'NULL' : `ST_SetSRID(ST_MakePoint(${lng}, ${lat}), 4490)`

const sql = []
sql.push('BEGIN;')
sql.push(
  'TRUNCATE users, plans, ports, poi_facilities, xiaoqu, flood_facilities, data_archive RESTART IDENTITY CASCADE;'
)

// users (password: bcrypt 哈希含 $ 触发 PG 美元引用解析错误；v3 认证在 NestJS 重建，此处导入占位值)
const users = B('users.json')
for (const u of users)
  sql.push(
    `INSERT INTO users (id, username, password, token_version, created_at) VALUES (${esc(u.id)}, ${esc(u.username)}, 'v3-migrated', ${u.tokenVersion ?? 0}, ${esc(u.createdAt)});`
  )

// plans —— 外键过滤孤儿数据(users 中不存在的 userId；JSON 文件时代无法发现，DB 外键暴露)
const plans = B('plans.json')
const validUserIds = new Set(users.map((u) => u.id))
const orphanPlans = plans.filter((p) => !validUserIds.has(p.userId))
if (orphanPlans.length) {
  console.log(
    `[warn] 跳过孤儿方案 ${orphanPlans.length} 条: ${orphanPlans.map((p) => p.id).join(',')}`
  )
}
for (const p of plans.filter((p) => validUserIds.has(p.userId)))
  sql.push(
    `INSERT INTO plans (id, user_id, name, payload, created_at, updated_at) VALUES (${esc(p.id)}, ${esc(p.userId)}, ${esc(p.name)}, '${JSON.stringify(p).replaceAll("'", "''")}', ${esc(p.createdAt)}, ${esc(p.updatedAt)});`
  )

// ports
const ports = B('ports.json')
for (const p of ports)
  sql.push(
    `INSERT INTO ports (id, name, address, type, phone, geom) VALUES (${esc(p.id)}, ${esc(p.name)}, ${esc(p.address)}, ${esc(p.type)}, ${esc(p.phone)}, ${pt(p.lng, p.lat)});`
  )

// poi_facilities (6 类设施文件)
const poiTypes = [
  ['qz_hospital', 'hospital'],
  ['qz_primary_school', 'primary_school'],
  ['qz_middle_school', 'middle_school'],
  ['qz_park', 'park'],
  ['qz_bus_station', 'bus_station'],
  ['qz_mall_and_supermarket', 'mall'],
]
for (const [file, type] of poiTypes) {
  const items = B(`site-selection/${file}.json`)
  for (const f of items)
    sql.push(
      `INSERT INTO poi_facilities (id, type, name, district, geom) VALUES (${esc(f.id)}, '${type}', ${esc(f.name)}, ${esc(f.district)}, ${pt(f.lng, f.lat)});`
    )
}

// xiaoqu
const xiaoqu = B('site-selection/xiaoqu.json')
for (const x of xiaoqu)
  sql.push(
    `INSERT INTO xiaoqu (id, name, district, geom) VALUES (${esc(x.id)}, ${esc(x.name)}, ${esc(x.district)}, ${pt(x.lng, x.lat)});`
  )

// flood_facilities (facilityPoints.json = {metadata, facilities:[...]})
const fp = B('flood/facilityPoints.json')
for (const f of fp.facilities)
  sql.push(
    `INSERT INTO flood_facilities (id, name, type, port, elevation, value, damage_rate, risk_level, geom) VALUES (${esc(f.id)}, ${esc(f.name)}, ${esc(f.type)}, ${esc(f.port)}, ${f.elevation}, ${f.value}, ${f.damageRate}, ${esc(f.riskLevel)}, ${pt(f.lng, f.lat)});`
  )

// data_archive —— 全部静态真数据 JSON 原样存档（假数据/mock 不入库）
// 范围: ports + forecast/*.json + site-selection/*.json + flood/*.json（不含 dem/ 栅格与 .gz 预计算表）
const archiveFiles = [
  'ports.json',
  ...['index', 'cargo', 'container', 'throughput', 'throughput_model', 'traffic', 'berth'].map(
    (n) => `forecast/${n}.json`
  ),
  ...[
    'xiaoqu',
    'qz_hospital',
    'qz_primary_school',
    'qz_middle_school',
    'qz_park',
    'qz_bus_station',
    'qz_mall_and_supermarket',
  ].map((n) => `site-selection/${n}.json`),
  ...[
    'facilityPoints',
    'floodArea',
    'floodStatistics',
    'waterLevel',
    'water-area',
    'terrainProfile',
  ].map((n) => `flood/${n}.json`),
]
for (const rel of archiveFiles) {
  const raw = fs.readFileSync('backend/data/' + rel, 'utf8')
  const sha = crypto.createHash('sha256').update(raw).digest('hex')
  const payload = raw.replaceAll("'", "''") // JSON 转义单引号
  sql.push(
    `INSERT INTO data_archive (name, payload, sha256) VALUES (${esc(rel)}, '${payload}'::jsonb, '${sha}');`
  )
}

sql.push('COMMIT;')
fs.writeFileSync('C:/workspace/beibu-gulf-project/.tmp-pip/import.sql', sql.join('\n'), 'utf8')
console.log(
  `generated import.sql: ${sql.length - 1} statements (archive ${archiveFiles.length} files)`
)
