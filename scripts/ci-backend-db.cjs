#!/usr/bin/env node
/**
 * ci-backend-db.cjs —— 覆盖率②落地：独立测试库 + 后端全链（ci:local 后端段唯一入口）
 *
 * 用法:
 *   node scripts/ci-backend-db.cjs              # 建库 → 灌数 → 真库跑测 → 棘轮 → 看门狗 → 清库
 *   node scripts/ci-backend-db.cjs --scan-only  # 只扫/清 __t3_% 残留并输出，不建库、不跑测试（红样用）
 *
 * 环境变量（均可选）:
 *   V3_CI_DB            测试库名，默认 beibu_gulf_ci_test
 *   V3_CI_PG_CONTAINER  Postgres 容器名，默认 beibu-postgis
 *
 * ---------------------------------------------------------------------------
 * 为什么需要这个脚本（2026-10-25）
 * ---------------------------------------------------------------------------
 * 后端覆盖率基线 96.28% 是 **CI 真库口径**（.github/workflows/ci.yml 的 backend-tests job
 * 设 V3_INTEGRATION_DB=1 并先跑 ci-seed.sh）。本地 `npm run ci:local` 原先直连开发库
 * beibu-gulf-data：既写开发库，又因为 V3_INTEGRATION_DB 未设让 81 个真库用例合法跳过，
 * 覆盖率掉到 89.45% —— 与 96.28% 是**跨口径比对**，怎么调都是错。
 * 更严重的是旧链后端段用 `coverage-ratchet.cjs … --update`：本地跑出更高值就写回基线，
 * 门禁被静默钝化（本次事故的直接原因）。
 *
 * 本脚本的立场：
 *   1. **绝不碰开发库**。目标库解析出来若等于 beibu-gulf-data 或系统库 → 立刻 exit 1；
 *      全流程只对测试库做 CREATE/DROP/写，开发库一个字节都不写。
 *   2. 测试库**每轮重建**（terminate → DROP IF EXISTS → CREATE），灌 schema + 仓库真数据
 *      + 三份夹具，灌完对账 251/83/3/6/12/7；对不上即 exit 1（库是脏的，覆盖率无意义）。
 *   3. 跑测必须**真库口径**：注入 V3_INTEGRATION_DB=1 / V3_ROADS_FIXTURE=1 / PG_DATABASE=<测试库>，
 *      棘轮对 backend/coverage-baseline.json **严格比对（禁止 --update）**，看门狗同 env。
 *   4. `__t3_%` 残留（真库 e2e 造的临时用户）跑前先清、finally 再清；中断留下的脏数据
 *      不许跨轮存活，也不许被当成"干净"。
 *   5. 测试库无论成功失败都 DROP（先 terminate）；清理/删库失败 exit 1 ——
 *      宁可红，也不留一个"看起来跑过了"的残留库。
 *
 * 为什么一切走 `docker exec -i … psql`：本机无 host 端 psql/pg_isready（实测），
 * 容器内 psql 是唯一可用客户端；也避免为一个 CI 脚本引入 pg 依赖（工程红线：不新增 npm 依赖）。
 */

'use strict'

const fs = require('node:fs')
const path = require('node:path')
const { spawn, spawnSync } = require('node:child_process')

const REPO_ROOT = path.resolve(__dirname, '..')
const ENV_FILE = path.join(REPO_ROOT, 'backend', '.env')
const TMP_DIR = path.join(REPO_ROOT, '.local', 'tmp')
const IMPORT_SQL = path.join(TMP_DIR, 'import.sql')
const FLOOD_SQL = path.join(TMP_DIR, 'flood-import.sql')

const DEFAULT_TEST_DB = 'beibu_gulf_ci_test'
const DEFAULT_CONTAINER = 'beibu-postgis'
/** 开发库（红线）：任何情况下不得作为目标库，也绝不允许出现在被灌入的 SQL 里 */
const DEV_DB = 'beibu-gulf-data'
/** 绝不 DROP 的库：开发库 + 系统库 */
const FORBIDDEN_DBS = new Set([DEV_DB, 'postgres', 'template0', 'template1', 'template_postgis'])
/** 灌库对账基准：flood_levels / flood_facilities / roads_edges(主分量) / poi / xiaoqu / 选址格 */
const EXPECTED_COUNTS = '251/83/3/6/12/7'

/**
 * 标识符白名单：
 *   - 库名只收 [A-Za-z0-9_]（Postgres 里带连字符的库必须处处加引号，测试库没必要冒这个险；
 *     开发库 beibu-gulf-data 另有 FORBIDDEN_DBS 显式拦截，不靠字符集兜）；
 *   - 容器名允许连字符（beibu-postgis 本身就有）。
 */
const DB_NAME_RE = /^[A-Za-z_][A-Za-z0-9_]*$/
const CONTAINER_NAME_RE = /^[A-Za-z_][A-Za-z0-9_-]*$/

const SCHEMA_FILES = [
  'tools/db/db-schema.sql',
  'tools/db/db-schema-gis.sql',
  'tools/db/db-schema-flood.sql',
  'tools/db/schema-migrations.sql',
]

const FIXTURE_FILES = [
  'backend/test/seed/roads-graph-fixture.sql',
  'backend/test/seed/site-analysis-fixture.sql',
  'backend/test/seed/suitability-cells-fixture.sql',
]

const COUNT_SQL =
  "SELECT (SELECT count(*) FROM flood_levels) || '/' || " +
  '(SELECT count(*) FROM flood_facilities) || ' +
  "'/' || (SELECT count(*) FROM roads_edges WHERE main_comp IS TRUE) || '/' || " +
  "(SELECT count(*) FROM poi_facilities WHERE id LIKE 'TF-%') || '/' || " +
  "(SELECT count(*) FROM xiaoqu WHERE id LIKE 'TF-%') || '/' || " +
  '(SELECT count(*) FROM suitability_cells WHERE id BETWEEN 900001 AND 900007)'

/** 残留探测：前缀与用户硬约束一致（`__t3_%`；LIKE 里 `_` 仍是单字符通配，即更宽的匹配） */
const RESIDUE_COUNT_SQL = "SELECT count(*) FROM users WHERE username LIKE '__t3_%'"

/**
 * 清理残留：必须**先删子表**再删 users —— plans/favorites 的 user_id 都是 REFERENCES users(id)
 * 且没有 ON DELETE CASCADE，顺序反了直接撞外键。三条语句包在同一事务里，避免删一半悬空。
 */
const RESIDUE_CLEAN_SQL = [
  'BEGIN;',
  "DELETE FROM favorites WHERE user_id IN (SELECT id FROM users WHERE username LIKE '__t3_%');",
  "DELETE FROM plans WHERE user_id IN (SELECT id FROM users WHERE username LIKE '__t3_%');",
  "DELETE FROM users WHERE username LIKE '__t3_%';",
  'COMMIT;',
].join(' ')

// ── 纯函数区（scripts/__tests__/ci-backend-db.test.mjs 直接 require 这些）────────────

/**
 * 解析测试库名。默认 beibu_gulf_ci_test；V3_CI_DB 可覆盖。
 * @param {Record<string, string | undefined>} [env]
 * @returns {string}
 * @throws {Error} 名称非法，或指向开发库/系统库（调用方 exit 1）
 */
function resolveTestDb(env = process.env) {
  const raw = String((env && env.V3_CI_DB) ?? '').trim()
  const name = raw === '' ? DEFAULT_TEST_DB : raw
  // 顺序要紧：先判「是不是开发库/系统库」（给出可读的红线理由），再判字符集。
  // 反过来的话 beibu-gulf-data 会先被字符集（带连字符）拦掉，报错变成"名字非法"，红线理由就丢了。
  if (FORBIDDEN_DBS.has(name.toLowerCase())) {
    throw new Error(
      `拒绝执行：目标库 ${name} 是开发库或系统库。本脚本只操作独立测试库（默认 ${DEFAULT_TEST_DB}）`
    )
  }
  if (!DB_NAME_RE.test(name)) {
    throw new Error(
      `V3_CI_DB 非法（只允许字母/数字/下划线，且不以数字开头）：${JSON.stringify(name)}`
    )
  }
  return name
}

/**
 * 解析 Postgres 容器名。默认 beibu-postgis；V3_CI_PG_CONTAINER 可覆盖。
 * @param {Record<string, string | undefined>} [env]
 * @returns {string}
 */
function resolveContainer(env = process.env) {
  const raw = String((env && env.V3_CI_PG_CONTAINER) ?? '').trim()
  const name = raw === '' ? DEFAULT_CONTAINER : raw
  if (!CONTAINER_NAME_RE.test(name)) {
    throw new Error(`V3_CI_PG_CONTAINER 非法：${JSON.stringify(name)}`)
  }
  return name
}

/**
 * 手工解析 .env（不引 dotenv：工程红线）。只做本脚本需要的事：
 * KEY=VALUE、跳过注释/空行、剥成对引号、兼容 `export ` 前缀。
 * @param {string} content
 * @returns {Record<string, string>}
 */
function parseEnvFile(content) {
  /** @type {Record<string, string>} */
  const out = {}
  for (const line of String(content).split(/\r?\n/)) {
    const trimmed = line.trim()
    if (trimmed === '' || trimmed.startsWith('#')) continue
    const eq = trimmed.indexOf('=')
    if (eq <= 0) continue
    const key = trimmed
      .slice(0, eq)
      .replace(/^export\s+/, '')
      .trim()
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) continue
    let value = trimmed.slice(eq + 1).trim()
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1)
    }
    out[key] = value
  }
  return out
}

/**
 * 组装跑测环境：真库门控 + 测试库 + backend/.env 的连接参数。
 * @param {Record<string, string>} dotenv
 * @param {string} database
 * @param {Record<string, string | undefined>} [base] 默认 process.env
 * @returns {NodeJS.ProcessEnv}
 */
function buildTestEnv(dotenv, database, base = process.env) {
  /** @type {NodeJS.ProcessEnv} */
  const env = { ...base }
  // 连接参数以 backend/.env 为准（本机唯一真值），库名强制为测试库
  for (const key of ['PG_HOST', 'PG_PORT', 'PG_USER', 'PG_PASSWORD']) {
    if (dotenv[key] !== undefined) env[key] = dotenv[key]
  }
  env.PG_DATABASE = database
  env.V3_INTEGRATION_DB = '1'
  env.V3_ROADS_FIXTURE = '1'
  // 显式摘掉全量数据集门控：那 1 个 skip 是「数据型」，本链不假装跑全量
  delete env.V3_FULL_DATASET
  return env
}

// ── 日志 / 进程工具 ─────────────────────────────────────────────────────────────

const LOG_PREFIX = '[ci-db]'
const log = (...args) => console.log(LOG_PREFIX, ...args)
const warn = (...args) => console.warn(LOG_PREFIX, ...args)

let stepNo = 0
const step = (msg) => log(`${String(++stepNo).padStart(2, '0')}. ${msg}`)

/** Windows 下 npm/npx 是 .cmd，Node 20+ 禁止无 shell 直接 spawn（EINVAL）⇒ 统一走 shell */
const NPM_CMD = process.platform === 'win32' ? 'npm.cmd' : 'npm'
const USE_SHELL = process.platform === 'win32'

/**
 * 跑一条短 psql 命令（同步）。
 * @param {{ container: string }} ctx
 * @param {string} database
 * @param {string[]} args
 */
function psqlSync(ctx, database, args) {
  const full = ['exec', '-i', ctx.container, 'psql', '-U', 'postgres', '-d', database]
  full.push('-v', 'ON_ERROR_STOP=1', ...args)
  return spawnSync('docker', full, {
    cwd: REPO_ROOT,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  })
}

/**
 * 执行 psql 并断言成功；返回 stdout（trim 过）。
 * @param {{ container: string }} ctx
 * @param {string} database
 * @param {string[]} args
 * @param {string} what 出错上下文
 * @returns {string}
 */
function psqlOrThrow(ctx, database, args, what) {
  const r = psqlSync(ctx, database, args)
  if (r.error) throw new Error(`${what}：无法启动 docker（${r.error.message}）`)
  if (r.status !== 0) {
    const detail = String(r.stderr || r.stdout || '')
      .trim()
      .slice(0, 4000)
    throw new Error(`${what} 失败（psql exit ${r.status}）\n${detail}`)
  }
  return String(r.stdout || '').trim()
}

/**
 * 以流的方式把 .sql 喂给容器内 psql（`-f -`）。
 * 为什么不用 spawnSync 的 input：flood-import.sql 实测 49MB，一次性塞 stdin 既吃内存，
 * 又有「父子双管道同时写满」的死锁风险；createReadStream.pipe 没有这个问题。
 * @param {{ container: string }} ctx
 * @param {string} database
 * @param {string} filePath
 * @param {string} what
 * @returns {Promise<void>}
 */
function psqlFile(ctx, database, filePath, what) {
  return new Promise((resolve, reject) => {
    if (!fs.existsSync(filePath)) {
      reject(new Error(`${what}：SQL 文件不存在 ${path.relative(REPO_ROOT, filePath)}`))
      return
    }
    const args = [
      'exec',
      '-i',
      ctx.container,
      'psql',
      '-U',
      'postgres',
      '-d',
      database,
      '-v',
      'ON_ERROR_STOP=1',
      '-q',
      '-f',
      '-',
    ]
    const child = spawn('docker', args, { cwd: REPO_ROOT, stdio: ['pipe', 'pipe', 'pipe'] })
    let stdout = ''
    let stderr = ''
    child.stdout.setEncoding('utf8')
    child.stderr.setEncoding('utf8')
    child.stdout.on('data', (d) => {
      stdout += d
    })
    child.stderr.on('data', (d) => {
      stderr += d
    })

    const stream = fs.createReadStream(filePath)
    // 子进程提前退出会让 stdin 写端 EPIPE，属预期失败通道，统一由 close 事件收口
    child.stdin.on('error', () => {})
    stream.on('error', (e) => {
      child.kill()
      reject(new Error(`${what}：读取 ${path.relative(REPO_ROOT, filePath)} 失败（${e.message}）`))
    })
    stream.pipe(child.stdin)

    child.on('error', (e) => reject(new Error(`${what}：无法启动 docker（${e.message}）`)))
    child.on('close', (code) => {
      if (code === 0) {
        resolve()
        return
      }
      const detail = String(stderr || stdout || '')
        .trim()
        .slice(0, 4000)
      reject(new Error(`${what} 失败（psql exit ${code}）\n${detail}`))
    })
  })
}

/**
 * 跑一个 node 生成器（继承 stdio 便于看它对账输出）。
 * @param {string[]} args
 * @param {string} what
 */
function runNode(args, what) {
  const r = spawnSync(process.execPath, args, { cwd: REPO_ROOT, stdio: 'inherit' })
  if (r.error) throw new Error(`${what}：无法启动 node（${r.error.message}）`)
  if (r.status !== 0) throw new Error(`${what} 失败（exit ${r.status}）`)
}

/**
 * 跑 npm 脚本，返回退出码（不抛错：测试失败也要先把库清干净）。
 * @param {string[]} args
 * @param {Record<string, string | undefined>} env
 * @returns {number}
 */
function runNpm(args, env) {
  const r = spawnSync(NPM_CMD, args, {
    cwd: REPO_ROOT,
    stdio: 'inherit',
    env,
    shell: USE_SHELL,
  })
  if (r.error) {
    warn(`npm 启动失败（${r.error.message}）`)
    return 1
  }
  return r.status === null ? 1 : r.status
}

/**
 * 分块扫描生成物里是否混入 `\connect` 或开发库名。
 * 灌库前的最后一道保险：生成器理论上不会写这些，但 SQL 一旦带上 `\connect beibu-gulf-data`，
 * 整份数据就进了开发库 —— 这种事故不能靠"生成器应该没问题"兜。
 * @param {string} filePath
 * @param {string} what
 */
function assertNoDevDbRefs(filePath, what) {
  const CHUNK = 1024 * 1024
  const carryLen = 64 // 防止 token 跨块断开
  const fd = fs.openSync(filePath, 'r')
  try {
    const buf = Buffer.allocUnsafe(CHUNK)
    let carry = ''
    for (;;) {
      const n = fs.readSync(fd, buf, 0, CHUNK, null)
      if (n <= 0) break
      const text = carry + buf.toString('utf8', 0, n)
      if (/^\s*\\connect/m.test(text) || text.includes(DEV_DB)) {
        throw new Error(`${what}：生成物里出现 \\connect 或开发库名 ${DEV_DB}，拒绝灌库`)
      }
      carry = text.slice(-carryLen)
    }
  } finally {
    fs.closeSync(fd)
  }
}

// ── 库操作 ─────────────────────────────────────────────────────────────────────

/**
 * 终止目标库上的其他连接（DROP DATABASE 前置条件）。
 * @param {{ container: string }} ctx
 * @param {string} database
 */
function terminateConnections(ctx, database) {
  psqlOrThrow(
    ctx,
    'postgres',
    [
      '-tA',
      '-c',
      `SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = '${database}' AND pid <> pg_backend_pid()`,
    ],
    `terminate ${database} 连接`
  )
}

/**
 * @param {{ container: string }} ctx
 * @param {string} database
 * @returns {boolean}
 */
function databaseExists(ctx, database) {
  const out = psqlOrThrow(
    ctx,
    'postgres',
    ['-tA', '-c', `SELECT 1 FROM pg_database WHERE datname = '${database}'`],
    `查询库 ${database} 是否存在`
  )
  return out === '1'
}

/**
 * 删除测试库：先踢连接再 DROP；常规 DROP 失败用 PG13+ 的 WITH (FORCE) 兜一次。
 * @param {{ container: string }} ctx
 * @param {string} database
 */
function dropDatabase(ctx, database) {
  if (FORBIDDEN_DBS.has(database.toLowerCase())) {
    throw new Error(`拒绝 DROP 受保护库：${database}`)
  }
  if (!databaseExists(ctx, database)) {
    log(`   ${database} 不存在，无需 DROP`)
    return
  }
  try {
    terminateConnections(ctx, database)
  } catch (e) {
    warn(`terminate 失败（继续尝试 DROP）：${String(e.message).split('\n')[0]}`)
  }
  const r = psqlSync(ctx, 'postgres', ['-c', `DROP DATABASE IF EXISTS "${database}"`])
  if (r.status === 0) return
  const forced = psqlSync(ctx, 'postgres', [
    '-c',
    `DROP DATABASE IF EXISTS "${database}" WITH (FORCE)`,
  ])
  if (forced.status !== 0) {
    const detail = String(forced.stderr || forced.stdout || '')
      .trim()
      .slice(0, 2000)
    throw new Error(`DROP DATABASE ${database} 失败：${detail}`)
  }
}

/**
 * 扫描 __t3_% 残留；>0 时清理并复扫。
 * @param {{ container: string }} ctx
 * @param {string} database
 * @param {{ clean?: boolean }} [opts] clean 默认 true
 * @returns {{ found: number, remaining: number }}
 */
function scanResidue(ctx, database, opts = {}) {
  const clean = opts.clean !== false
  const before = Number(
    psqlOrThrow(ctx, database, ['-tA', '-c', RESIDUE_COUNT_SQL], '__t3_ 残留扫描')
  )
  if (!Number.isFinite(before)) throw new Error('__t3_ 残留扫描：计数非数值')
  if (before === 0 || !clean) return { found: before, remaining: before }

  log(`   发现 ${before} 条 __t3_% 残留，清理中…`)
  psqlOrThrow(ctx, database, ['-q', '-c', RESIDUE_CLEAN_SQL], '__t3_ 残留清理')
  const after = Number(
    psqlOrThrow(ctx, database, ['-tA', '-c', RESIDUE_COUNT_SQL], '__t3_ 残留复扫')
  )
  return { found: before, remaining: Number.isFinite(after) ? after : -1 }
}

/**
 * 建库 + 灌 schema/真数据/夹具 + 对账。
 * @param {{ container: string, database: string }} ctx
 */
async function seedDatabase(ctx) {
  const { database } = ctx

  step(`重建测试库 ${database}（terminate → DROP IF EXISTS → CREATE）`)
  terminateConnections(ctx, database)
  psqlOrThrow(ctx, 'postgres', ['-c', `DROP DATABASE IF EXISTS "${database}"`], `DROP ${database}`)
  psqlOrThrow(ctx, 'postgres', ['-c', `CREATE DATABASE "${database}"`], `CREATE ${database}`)

  step('扩展 postgis / pgrouting')
  psqlOrThrow(
    ctx,
    database,
    [
      '-q',
      '-c',
      'CREATE EXTENSION IF NOT EXISTS postgis; CREATE EXTENSION IF NOT EXISTS pgrouting;',
    ],
    'CREATE EXTENSION'
  )

  for (const rel of SCHEMA_FILES) {
    step(`schema：${rel}`)
    await psqlFile(ctx, database, path.join(REPO_ROOT, rel), rel)
  }

  step('仓库真数据：node tools/db/db-import.mjs --allow-runtime-missing')
  fs.mkdirSync(TMP_DIR, { recursive: true })
  runNode(['tools/db/db-import.mjs', '--allow-runtime-missing'], 'db-import.mjs')
  assertNoDevDbRefs(IMPORT_SQL, 'import.sql')
  await psqlFile(ctx, database, IMPORT_SQL, 'import.sql 灌库')

  step('淹没档位真数据：node tools/flood/flood-levels-to-pg.mjs')
  runNode(['tools/flood/flood-levels-to-pg.mjs'], 'flood-levels-to-pg.mjs')
  assertNoDevDbRefs(FLOOD_SQL, 'flood-import.sql')
  await psqlFile(ctx, database, FLOOD_SQL, 'flood-import.sql 灌库')

  for (const rel of FIXTURE_FILES) {
    step(`夹具：${rel}`)
    await psqlFile(ctx, database, path.join(REPO_ROOT, rel), rel)
  }

  step('灌数对账（flood_levels/flood_facilities/roads_edges/poi/xiaoqu/选址格）')
  const counts = psqlOrThrow(ctx, database, ['-tA', '-c', COUNT_SQL], '灌数对账')
  log(`   实测 ${counts}，期望 ${EXPECTED_COUNTS}`)
  if (counts !== EXPECTED_COUNTS) {
    throw new Error(`灌数对账不符：期望 ${EXPECTED_COUNTS}，实测 ${counts}`)
  }
}

// ── 入口 ───────────────────────────────────────────────────────────────────────

/**
 * @param {string[]} argv
 * @returns {Promise<number>} exit code
 */
async function run(argv) {
  const scanOnly = argv.includes('--scan-only')
  const unknown = argv.filter((a) => a !== '--scan-only')
  if (unknown.length > 0) warn(`忽略未知参数：${unknown.join(' ')}`)

  // 库名/容器名解析放在执行期（不放模块顶层）：require 本文件做单测时不应有任何副作用
  const database = resolveTestDb(process.env)
  const container = resolveContainer(process.env)
  const ctx = { container, database }

  log(`测试库 ${database} ｜ 容器 ${container} ｜ 模式 ${scanOnly ? 'scan-only' : 'full'}`)

  const inspect = spawnSync('docker', ['inspect', '-f', '{{.State.Running}}', container], {
    cwd: REPO_ROOT,
    encoding: 'utf8',
  })
  if (inspect.status !== 0) {
    const detail = String(inspect.stderr || '')
      .trim()
      .slice(0, 500)
    throw new Error(`容器 ${container} 不可用：${detail}`)
  }
  if (String(inspect.stdout).trim() !== 'true') {
    throw new Error(`容器 ${container} 未运行（docker start ${container}）`)
  }

  if (scanOnly) {
    step(`scan-only：扫描 ${database} 的 __t3_% 残留（不建库、不跑测试）`)
    if (!databaseExists(ctx, database)) {
      log(`   库 ${database} 不存在 ⇒ 无残留`)
      return 0
    }
    const { found, remaining } = scanResidue(ctx, database, { clean: true })
    if (found === 0) {
      log('   残留 0 条 ⇒ 干净')
      return 0
    }
    log(`   清理前 ${found} 条，清理后 ${remaining} 条`)
    if (remaining !== 0) {
      warn('清理后仍有残留 —— 判红')
      return 1
    }
    // 红样语义：扫到过残留就不是"干净态"，即使已清干净也返回非 0，让调用方看见
    warn('已清理残留 —— 本次判红（红样语义）')
    return 1
  }

  const dotenv = fs.existsSync(ENV_FILE) ? parseEnvFile(fs.readFileSync(ENV_FILE, 'utf8')) : {}
  if (!fs.existsSync(ENV_FILE)) warn('backend/.env 不存在，PG_* 走默认值')

  const testEnv = buildTestEnv(dotenv, database)
  let failure = 0
  let seeded = false

  try {
    await seedDatabase(ctx)
    seeded = true

    step('跑前扫 __t3_% 残留（真库 e2e 可能留下临时用户）')
    const pre = scanResidue(ctx, database, { clean: true })
    log(pre.found === 0 ? '   残留 0 条' : `   清理 ${pre.found} 条，剩余 ${pre.remaining} 条`)
    if (pre.remaining !== 0) throw new Error('跑前 __t3_% 清理后仍不为 0')

    step('真库跑测：npm run test:report:be（含 coverage 产物）')
    const testCode = runNpm(['--prefix', 'backend', 'run', 'test:report'], testEnv)
    if (testCode !== 0) {
      failure = testCode
      warn(`后端测试失败（exit ${testCode}）—— 跳过棘轮/看门狗，仍会清库`)
    } else {
      step('覆盖率棘轮（严格比对，禁止 --update）')
      const ratchetCode = runNpm(
        [
          'exec',
          '--',
          'node',
          'scripts/coverage-ratchet.cjs',
          'backend/coverage/coverage-summary.json',
          'backend/coverage-baseline.json',
        ],
        testEnv
      )
      if (ratchetCode !== 0) {
        failure = ratchetCode
        warn(`覆盖率棘轮未通过（exit ${ratchetCode}）`)
      } else {
        step('测试看门狗：node scripts/test-watchdog.cjs --project backend')
        const watchdogCode = runNpm(
          ['exec', '--', 'node', 'scripts/test-watchdog.cjs', '--project', 'backend'],
          testEnv
        )
        if (watchdogCode !== 0) {
          failure = watchdogCode
          warn(`看门狗未通过（exit ${watchdogCode}）`)
        }
      }
    }
  } catch (e) {
    warn(`中止：${e && e.message ? e.message : e}`)
    failure = failure || 1
  } finally {
    // 清理段自身失败必须翻红（不能把"没清干净"吞成绿）
    try {
      if (seeded && databaseExists(ctx, database)) {
        step('finally：复扫 __t3_% 残留并清理')
        const post = scanResidue(ctx, database, { clean: true })
        if (post.remaining !== 0) {
          warn(`finally 残留清理后仍为 ${post.remaining} 条`)
          failure = failure || 1
        }
      }
      step(`finally：DROP 测试库 ${database}（先 terminate 连接）`)
      dropDatabase(ctx, database)
      log(`   ${database} 已删除`)
    } catch (e) {
      warn(`finally 失败：${e && e.message ? e.message : e}`)
      failure = failure || 1
    }
  }

  if (failure === 0) log('后端真库全链通过')
  else warn(`后端真库全链失败（exit ${failure}）`)
  return failure
}

if (require.main === module) {
  run(process.argv.slice(2))
    .then((code) => {
      process.exitCode = code
    })
    .catch((e) => {
      console.error(`${LOG_PREFIX} 致命错误：${e && e.message ? e.message : e}`)
      process.exitCode = 1
    })
}

module.exports = {
  resolveTestDb,
  resolveContainer,
  parseEnvFile,
  buildTestEnv,
  DEFAULT_TEST_DB,
  DEFAULT_CONTAINER,
  DEV_DB,
}
