#!/usr/bin/env node
/**
 * check-mock-contract.cjs — mock 数据契约护栏（数据流契约 R-mock,⑤）
 *
 * 背景：mock(frontend/public/data)与 api(backend/data)两套数据物理隔离,
 * 但契约必须一致——否则"mock 通、api 断"的漂移会在演示时爆。
 *
 * 校验规则：
 * 1. public/data 下所有 JSON 文件(递归)必须可解析为对象
 * 2. 信封型（含 code 或 data 字段）必须同时含 code+data（与后端 sendSuccess 契约一致）
 * 3. 每个文件必须带 `_contractVersion`（顶层,版本升级时递增,旧 mock 自动拒绝）
 *
 * 用法：
 *   node scripts/check-mock-contract.cjs        # 校验(不通过 exit 1)
 *   node scripts/check-mock-contract.cjs --fix  # 自动注入缺失的 _contractVersion
 */
const fs = require('node:fs')
const path = require('node:path')

const FIX = process.argv.includes('--fix')
const MOCK_DIR = path.join(__dirname, '..', 'frontend', 'public', 'data')
const CURRENT_VERSION = 1

function walk(dir, out) {
  for (const f of fs.readdirSync(dir)) {
    const p = path.join(dir, f)
    const st = fs.statSync(p)
    if (st.isDirectory()) walk(p, out)
    else if (f.endsWith('.json')) out.push(p)
  }
}

const files = []
walk(MOCK_DIR, files)

let errors = 0
for (const f of files) {
  const rel = f.split(path.sep).join('/').replace(/.*public\/data\//, '')

  let j
  try {
    j = JSON.parse(fs.readFileSync(f, 'utf8'))
  } catch {
    console.error(`[mock-contract] ✗ ${rel}: JSON 解析失败`)
    errors++
    continue
  }
  if (typeof j !== 'object' || j === null || Array.isArray(j)) {
    console.error(`[mock-contract] ✗ ${rel}: 顶层必须是对象(信封或数据对象)`)
    errors++
    continue
  }

  // 信封型判定:code 与 data 同时存在 = 信封;仅 code 无 data = 半信封(可疑);
  // 仅 data 无 code = 数据型(业务字段恰叫 data,如 forecast/berth.json 的预测序列),允许
  const hasCode = 'code' in j
  const hasData = 'data' in j
  if (hasCode && !hasData) {
    console.error(
      `[mock-contract] ✗ ${rel}: 有 code 无 data 的半信封,参考 backend/utils/response.js(信封=code+data 成对)`
    )
    errors++
    continue
  }

  // 契约版本:缺失 → --fix 注入,否则报错;版本不一致 → 报错
  if (j._contractVersion === undefined) {
    if (FIX) {
      j._contractVersion = CURRENT_VERSION
      fs.writeFileSync(f, JSON.stringify(j, null, 2) + '\n', 'utf8')
      console.log(`[mock-contract] ✓ ${rel}: 已注入 _contractVersion=${CURRENT_VERSION}`)
    } else {
      console.error(`[mock-contract] ✗ ${rel}: 缺 _contractVersion(运行 --fix 注入)`)
      errors++
    }
  } else if (j._contractVersion !== CURRENT_VERSION) {
    console.error(`[mock-contract] ✗ ${rel}: _contractVersion=${j._contractVersion} ≠ 当前 ${CURRENT_VERSION}`)
    errors++
  }
}

if (errors > 0) {
  console.error(`[mock-contract] ✗ ${errors} 处不通过`)
  process.exit(1)
}
console.log(`[mock-contract] ✓ 全部通过(${files.length} 个 mock 文件)`)
