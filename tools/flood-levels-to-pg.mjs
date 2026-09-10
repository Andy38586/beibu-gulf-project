// 淹没档位表灌入 PostGIS —— algorithm-service 下沉的配套灌数器（2026-09-10）
//
// 用法:
//   node tools/flood-levels-to-pg.mjs
// 然后:
//   docker cp .tmp-pip/flood-import.sql beibu-postgis:/tmp/ \
//     && docker exec beibu-postgis psql -U postgres -d v3_dev -f /tmp/flood-import.sql
//
// 设计依据: docs/算法服务下沉PostGIS-设计-2026-09-10.md（v3）
// 复用 tools/db-import.mjs 的「生成 SQL + psql 执行」模式——纯 Node，不引入 pg 依赖。
//
// ⚠️ 本脚本**只处理 flood_levels**。
//    flood_facilities（83 个设施）早已由 tools/db-import.mjs:219 灌入，属既有资产，
//    **本脚本既不重灌也不 TRUNCATE 它**（早期版本误写 TRUNCATE flood_levels, flood_facilities，
//     会清掉现有 83 行——已修正）。
//
// 关键约束（踩了必错，详见 design §2.1）:
//   1. 几何**手工拼 MULTIPOLYGON 文本**，等价于 ST_Collect（仅聚集不合并）。
//      **绝不可改用 ST_Union**——那会融合相交/相邻多边形，导致 ST_Dump 拆出的集合
//      与原 features 数组不一致（脚本末尾的 DO $$ 断言会立刻报错）。
//   2. 坐标为 4490 存储口径，与 db-import.mjs 一致（ST_SetSRID(...,4490)），不做投影转换。
//   3. riskLevel 不落库——由 NestJS 复用现有 deriveRiskLevel() 派生（单一事实源）。
//   4. 幂等：只 TRUNCATE flood_levels 后重灌。

import fs from 'node:fs'
import path from 'node:path'
import zlib from 'node:zlib'

const ROOT = path.resolve(import.meta.dirname, '..')
const LEVELS_GZ = path.join(ROOT, 'backend', 'data', 'flood', 'flood_levels.json.gz')
const OUT_DIR = path.join(ROOT, '.tmp-pip')
const OUT_SQL = path.join(OUT_DIR, 'flood-import.sql')
const OUT_REPORT = path.join(OUT_DIR, 'flood-import-report.md')

const SRID = 4490 // CGCS2000，项目约定「4490 存、4326 出」

// 数字转 WKT 字面量：WKT 不接受科学计数法，极小值须展开
const num = (v) => {
  const n = Number(v)
  if (!Number.isFinite(n)) throw new Error(`非有限数值: ${v}`)
  const s = String(n)
  return s.includes('e') || s.includes('E') ? n.toFixed(9) : s
}

const ringWkt = (ring) => `(${ring.map((p) => `${num(p[0])} ${num(p[1])}`).join(',')})`
const polygonWkt = (poly) => `(${poly.map(ringWkt).join(',')})`

/**
 * 把一档的 features 数组拼成 MULTIPOLYGON WKT。
 * 每个 feature 是独立 Polygon，直接并列 = ST_Collect 语义（不融合）。
 */
function multiPolygonWkt(features) {
  if (!features || features.length === 0) return null // 该档无淹没 → geom = NULL
  const polys = features.map((f) => f.geometry.coordinates)
  return `MULTIPOLYGON(${polys.map(polygonWkt).join(',')})`
}

function readLevels() {
  const raw = zlib.gunzipSync(fs.readFileSync(LEVELS_GZ)).toString('utf-8')
  return JSON.parse(raw)
}

function buildSql(levels) {
  const lines = []
  lines.push('-- 由 tools/flood-levels-to-pg.mjs 生成，请勿手改')
  lines.push('-- 幂等：只清空 flood_levels 后重灌（不动 flood_facilities —— 那是既有资产）')
  lines.push('TRUNCATE flood_levels;')
  lines.push('')

  const warnings = []
  let totalFeatures = 0
  let levelCount = 0

  const keys = Object.keys(levels).sort((a, b) => Number(a) - Number(b))
  for (const key of keys) {
    const v = levels[key]
    if (v.error) {
      warnings.push(`档位 ${key} 在预计算时失败（${v.error}），跳过`)
      continue
    }
    const feats = v.features ?? []

    // 源侧自洽校验：featureCount 应等于 features 长度
    if (typeof v.featureCount === 'number' && v.featureCount !== feats.length) {
      warnings.push(
        `档位 ${key}: featureCount=${v.featureCount} 与 features 长度 ${feats.length} 不一致`
      )
    }
    totalFeatures += feats.length
    levelCount += 1

    const wkt = multiPolygonWkt(feats)
    const geomExpr = wkt ? `ST_SetSRID(ST_GeomFromText('${wkt}'), ${SRID})` : 'NULL'
    lines.push(
      `INSERT INTO flood_levels (level, feature_count, flooded_km2, geom) VALUES (${num(key)}, ${feats.length}, ${num(v.floodedKm2 ?? 0)}, ${geomExpr});`
    )
  }

  lines.push('')
  lines.push('-- 落库自检：feature_count 必须等于实际几何数（若不等，说明几何被融合了）')
  lines.push(
    "DO $$ DECLARE bad int; BEGIN SELECT count(*) INTO bad FROM flood_levels WHERE geom IS NOT NULL AND feature_count <> ST_NumGeometries(geom); IF bad > 0 THEN RAISE EXCEPTION 'feature_count 与实际几何数不符的档位数: %（几何可能被 ST_Union 融合）', bad; END IF; END $$;"
  )

  return { sql: lines.join('\n'), warnings, levelCount, totalFeatures }
}

function main() {
  if (!fs.existsSync(LEVELS_GZ)) throw new Error(`缺档位数据: ${LEVELS_GZ}`)

  const levels = readLevels()
  const { sql, warnings, levelCount, totalFeatures } = buildSql(levels)

  fs.mkdirSync(OUT_DIR, { recursive: true })
  fs.writeFileSync(OUT_SQL, sql, 'utf-8')

  const sizeMb = (fs.statSync(OUT_SQL).size / 1048576).toFixed(1)
  const report = [
    '# flood_levels 灌数报告',
    '',
    `- 档位数: ${levelCount}（源键 ${Object.keys(levels).length}）`,
    `- features 总数: ${totalFeatures}`,
    `- 输出: ${path.relative(ROOT, OUT_SQL)}（${sizeMb} MB）`,
    `- 影响范围: 仅 flood_levels；flood_facilities（83 行）不在本脚本管辖内`,
    '',
    warnings.length
      ? `## 告警（${warnings.length}）\n\n${warnings.map((w) => `- ${w}`).join('\n')}`
      : '## 无告警',
  ].join('\n')
  fs.writeFileSync(OUT_REPORT, report, 'utf-8')

  console.log(`✅ 生成 ${path.relative(ROOT, OUT_SQL)}（${sizeMb} MB）`)
  console.log(`   档位 ${levelCount} / features ${totalFeatures}`)
  if (warnings.length) {
    console.log(`   ⚠️ ${warnings.length} 条告警，详见报告`)
    for (const w of warnings.slice(0, 10)) console.log(`     - ${w}`)
  }
  console.log('')
  console.log('下一步:')
  console.log('  docker cp .tmp-pip/flood-import.sql beibu-postgis:/tmp/')
  console.log('  docker exec beibu-postgis psql -U postgres -d v3_dev -f /tmp/flood-import.sql')
}

main()
