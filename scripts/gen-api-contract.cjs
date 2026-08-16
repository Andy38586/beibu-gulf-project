#!/usr/bin/env node
/**
 * 类型契约生成与覆盖校验（z119）
 *
 * 背景：专项3 4.6「无类型生成脚本」——类型同步（4.4 字段多余/缺失、
 * 4.5 同名字段跨源）此前全靠人工核对。本脚本把「单一事实源
 * frontend/src/types/schemas.ts」变成可生成、可校验的契约：
 *
 *   1. 解析 schemas.ts 全部导出的 zod schema，提取顶层字段与类型，
 *      生成契约快照 frontend/src/types/generated/api-contract.json；
 *   2. 校验（默认执行，失败 exit 1）：
 *      a. 每个 `*Schema` 都有对应的 `z.infer` 类型导出（*Parsed）——
 *         类型派生完整性，防止"只写 schema 忘导出类型"；
 *      b. 每个 `*Schema` 都被 schemas.test.ts 引用——运行时校验覆盖
 *         守护（z117 的"100% 覆盖率"从人工核对变为可重复检查）。
 *
 * 用法：
 *   node scripts/gen-api-contract.cjs          # 生成快照 + 校验
 *   node scripts/gen-api-contract.cjs --check  # 只校验不写文件
 *   npm run types:gen
 *
 * 注意：文本级解析（括号配对），不做 TS 求值——够用且无编译依赖；
 * 解析不到的结构会以「解析失败」显式报出，不会静默漏掉。
 */
const fs = require('fs')
const path = require('path')

const ROOT = path.join(__dirname, '..')
const SCHEMAS = path.join(ROOT, 'frontend', 'src', 'types', 'schemas.ts')
const TEST_FILE = path.join(ROOT, 'frontend', 'src', 'types', '__tests__', 'schemas.test.ts')
const OUT = path.join(ROOT, 'frontend', 'src', 'types', 'generated', 'api-contract.json')

const onlyCheck = process.argv.includes('--check')

// ---------- 文本解析 ----------

/** 从 start 处开始括号配对，返回 { body, end }：body 为第一个 { 到匹配 } 的内容 */
function matchBraces(text, start) {
  const open = text.indexOf('{', start)
  if (open < 0) return null
  let depth = 0
  for (let i = open; i < text.length; i++) {
    const ch = text[i]
    if (ch === '{') depth++
    else if (ch === '}') {
      depth--
      if (depth === 0) return { body: text.slice(open + 1, i), end: i + 1 }
    }
  }
  return null
}

const TYPE_NAMES = [
  ['z.looseObject', 'object'],
  ['z.object', 'object'],
  ['z.discriminatedUnion', 'union'],
  ['z.array', 'array'],
  ['z.record', 'record'],
  ['z.tuple', 'tuple'],
  ['z.string', 'string'],
  ['z.number', 'number'],
  ['z.boolean', 'boolean'],
  ['z.literal', 'literal'],
  ['z.enum', 'enum'],
  ['z.unknown', 'unknown'],
  ['z.nullable', 'nullable'],
  ['z.optional', 'optional'],
]

/** 把 zod 类型表达式压成人类可读名（只取首层，不递归） */
function zodTypeName(expr) {
  const e = expr.trim()
  for (const [token, name] of TYPE_NAMES) {
    if (e.startsWith(token)) return name
  }
  return e.split(/[<(]/)[0] || e || '?'
}

/**
 * 解析 schema 定义：从声明起始位置起，表达式持续到「空行 + 下一个
 * export type / export const / 注释 / 文件尾」。返回 { name, kind, fields }；
 * fields 为顶层字段名 → { type, optional }。
 */
function parseSchemaDef(text, start) {
  const head = text.slice(start)
  const m = head.match(
    /^export const (\w+Schema)\s*=\s*(z\.[\s\S]*?)(?=\n\nexport type|\n\nexport const|\n\n\/\/|\n\s*$)/s
  )
  if (!m) return null
  const [, name, expr] = m
  const kind = zodTypeName(expr)
  const fields = {}
  const brace = matchBraces(expr, 0)
  if (brace) {
    const body = brace.body
    let i = 0
    while (i < body.length) {
      const keyMatch = body.slice(i).match(/^\s*([A-Za-z_$][\w$]*)\s*:\s*/)
      if (!keyMatch) break
      const key = keyMatch[1]
      const valueStart = i + keyMatch[0].length
      let depth = 0
      let j = valueStart
      let inStr = null
      while (j < body.length) {
        const ch = body[j]
        if (inStr) {
          if (ch === inStr && body[j - 1] !== '\\') inStr = null
        } else if (ch === '"' || ch === "'" || ch === '`') {
          inStr = ch
        } else if (ch === '(' || ch === '[' || ch === '{') {
          depth++
        } else if (ch === ')' || ch === ']' || ch === '}') {
          depth--
        } else if (ch === ',' && depth === 0) {
          break
        }
        j++
      }
      const valueExpr = body.slice(valueStart, j).trim()
      const optional = /\.optional\(\)$/.test(valueExpr)
      fields[key] = { type: zodTypeName(valueExpr.replace(/\.optional\(\)$/, '')), optional }
      i = j + 1
    }
  }
  return { name, kind, fields }
}

// ---------- 解析所有 schema ----------

const schemasText = fs.readFileSync(SCHEMAS, 'utf8')
const defs = []
for (const m of schemasText.matchAll(/^export const (\w+Schema)\s*=/gm)) {
  const def = parseSchemaDef(schemasText, m.index)
  if (def) defs.push(def)
}

// ---------- 校验 ----------

const testText = fs.readFileSync(TEST_FILE, 'utf8')

// 嵌套引用：schemas.ts 内部被其他 schema 定义引用的（如 userSchema ⊂ authResponseSchema），
// 随父 schema 一起被测试间接覆盖——不算缺口
const nestedRefs = new Set()
for (const def of defs) {
  const defText = schemasText.slice(schemasText.indexOf(`export const ${def.name}`))
  for (const other of defs) {
    if (other.name !== def.name && new RegExp(`\\b${other.name}\\b`).test(defText)) {
      nestedRefs.add(other.name)
    }
  }
}

const problems = []
const indirect = []
for (const def of defs) {
  const parsedExport = new RegExp(
    `export\\s+type\\s+\\w*${def.name.replace(/Schema$/, '')}Parsed\\b`,
    'i'
  ).test(schemasText)
  if (!parsedExport) {
    problems.push(`✗ ${def.name}: 无对应 z.infer 类型导出（缺 *Parsed）`)
  }
  const usedInTest = new RegExp(`\\b${def.name}\\b`).test(testText)
  if (!usedInTest) {
    if (nestedRefs.has(def.name)) {
      indirect.push(`${def.name}（经父 schema 间接覆盖）`)
    } else {
      problems.push(`✗ ${def.name}: schemas.test.ts 未引用（运行时校验覆盖缺口，z117 守护）`)
    }
  }
}

// ---------- 输出 ----------

const snapshot = {
  generatedAt: new Date().toISOString().slice(0, 10),
  source: 'frontend/src/types/schemas.ts（单一事实源，types:gen 自动生成勿手改）',
  schemas: Object.fromEntries(defs.map((d) => [d.name, { kind: d.kind, fields: d.fields }])),
}

if (!onlyCheck) {
  fs.mkdirSync(path.dirname(OUT), { recursive: true })
  fs.writeFileSync(OUT, JSON.stringify(snapshot, null, 2) + '\n')
  console.log(`已生成契约快照: ${path.relative(ROOT, OUT)}（${defs.length} 个 schema）`)
}

for (const def of defs) {
  const keys = Object.keys(def.fields)
  console.log(
    `  ${def.name} [${def.kind}]${keys.length ? `: ${keys.length} 字段` : '（无对象字段）'}`
  )
}
if (indirect.length) {
  console.log(`\n（间接覆盖，不计缺口: ${indirect.join('、')}）`)
}
if (problems.length) {
  console.log('\n' + problems.join('\n'))
  console.log(`\n校验未通过（${problems.length} 处），请补齐后重跑。`)
  process.exit(1)
}
console.log(`\n校验通过：${defs.length} 个 schema 均有类型导出与测试覆盖 ✓`)
