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
 *         守护（z117 的"100% 覆盖率"从人工核对变为可重复检查）；
 *      c. 反向核对（2026-09-23 补）：带 `@backend-contract <路径>` 注解的 schema，
 *         其每个字段名必须仍以键位出现在注解指向的后端文件里——后端删/改名而契约
 *         未同步时，a/b 两条都不会红（实测 exit=0），故补此条。
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
    // z 与 . 之间允许换行/空格（`= z\n.object(...)` 多行起链形态，b018）
    const re = new RegExp('^' + token.replace(/\./g, '\\s*\\.\\s*'))
    if (re.test(e)) return name
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
  // `z\b` 而非 `z\.`：允许 `= z` 换行起链（affectedFacilitySchema 即此形态，
  // 旧正则要求 z 后紧跟 . ⇒ 整条声明不进气场、快照整条缺失，b018）
  const m = head.match(
    /^export const (\w+Schema)\s*=\s*(z\b[\s\S]*?)(?=\n\nexport type|\n\nexport const|\n\n\/\/|\n\s*$)/s
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
      if (!keyMatch) {
        // 对象体内的注释/空行不再终止字段扫描（b018：旧实现遇首行非键即 break，
        // 该 schema 之后的全部顶层字段被截断，快照系统性少记）
        const commentMatch = body.slice(i).match(/^\s*(\/\/[^\n]*|\/\*[\s\S]*?\*\/)/)
        if (commentMatch) {
          i += commentMatch[0].length
          continue
        }
        const nl = body.indexOf('\n', i)
        if (nl < 0) break
        i = nl + 1
        continue
      }
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
// 解析失败显式报出（b018：旧实现 `if (def) defs.push(def)` 静默丢弃，
// 头注释宣称的「不会静默漏掉」不成立——声明数与快照数对不上无人知）
const parseFailures = []
const declStarts = [...schemasText.matchAll(/^export const (\w+Schema)\s*=/gm)].map((m) => ({
  name: m[1],
  index: m.index,
}))
for (const m of schemasText.matchAll(/^export const (\w+Schema)\s*=/gm)) {
  const def = parseSchemaDef(schemasText, m.index)
  if (def) defs.push(def)
  else parseFailures.push(m[1])
}

// ---------- 校验 ----------

const testText = fs.readFileSync(TEST_FILE, 'utf8')

// 嵌套引用：schemas.ts 内部被其他 schema 定义引用的（如 userSchema ⊂ authResponseSchema），
// 随父 schema 一起被测试间接覆盖——不算缺口。
// ⚠️ 只在本 schema 自身声明体内找（截到下一个 export）——旧实现 slice 到 EOF，
// 每个 schema 的文本都包含其后全部声明 ⇒ nestedRefs ≈ 全集 ⇒ 本检查恒不报告（b018）
const nestedRefs = new Set()
for (const def of defs) {
  const own = declStarts.find((d) => d.name === def.name)
  const nextExport = schemasText.indexOf('\nexport ', own.index + 10)
  const defText = schemasText.slice(own.index, nextExport < 0 ? schemasText.length : nextExport)
  for (const other of defs) {
    if (other.name !== def.name && new RegExp(`\\b${other.name}\\b`).test(defText)) {
      nestedRefs.add(other.name)
    }
  }
}

const problems = [
  ...parseFailures.map((n) => `✗ ${n}: 声明解析失败（生成器无法提取字段，请检查声明形态）`),
]

// ---------- 反向核对：后端字段消失必红 ----------
//
// 背景：本脚本的校验此前全是"正向"的（schema 有没有类型导出、有没有被测试引用）。
// 后端把某字段删掉/改名时，schema 依旧自洽 ⇒ 快照与覆盖率都不红（实测 exit=0），
// 契约里就留着一个没人产出的字段（affectedCount 即这类遗留）。
//
// 判据：带 `// @backend-contract <相对路径>` 注解的 schema，其每个字段名都必须在该后端
// 文件里以**键位**出现（字段名后接 , : ) }）——只要求"名字还在"，不要求解析后端 AST；
// 文本级判定，与本脚本其余部分同粒度。注解写在 schema 声明的上方注释里。
function backendContractOf(declStart) {
  const lines = schemasText.slice(0, declStart).split('\n')
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i].trim()
    if (line === '') continue
    const hit = line.match(/^\/\/\s*@backend-contract\s+(\S+)/)
    if (hit) return hit[1]
    // 只向上回溯连续注释；遇到代码即停（注解必须紧贴该 schema 的声明注释块）
    if (!line.startsWith('//') && !line.startsWith('*') && !line.startsWith('/*')) return null
  }
  return null
}

const contractBackends = {}
for (const def of defs) {
  const own = declStarts.find((d) => d.name === def.name)
  const rel = backendContractOf(own.index)
  if (!rel) continue
  const abs = path.join(ROOT, rel)
  if (!fs.existsSync(abs)) {
    problems.push(`✗ ${def.name}: @backend-contract 指向的文件不存在（${rel}）`)
    continue
  }
  const src = fs.readFileSync(abs, 'utf8')
  const occurrence = {}
  for (const field of Object.keys(def.fields)) {
    // 键位 = 字段名后接 , : ) }；`const affectedPorts = [...]` 这种引用不算
    const hits = src.match(new RegExp(`\\b${field}\\s*(?:[,:]|\\)|\\})`, 'g'))
    occurrence[field] = hits ? hits.length : 0
    // 硬性判据：契约字段必须在后端真被产出（0 次 = 死字段，affectedCount 即此类）
    if (occurrence[field] === 0) {
      problems.push(`✗ ${def.name}.${field}: ${rel} 里已是 0 次键位出现（后端删/改名而未同步契约）`)
    }
  }
  contractBackends[def.name] = { file: rel, occurrence }
}
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
  // 带 @backend-contract 注解的 schema：字段在后端文件里的键位出现次数。
  // 计数入快照 ⇒ 后端删掉某一处产出即成「快照不同步」而必红（下面的新鲜度比对覆盖它）；
  // 0 次则由上面的硬性判据直接报错（不允许靠重生成快照把消失的字段"洗白"）。
  backendContracts: contractBackends,
}

if (!onlyCheck) {
  fs.mkdirSync(path.dirname(OUT), { recursive: true })
  fs.writeFileSync(OUT, JSON.stringify(snapshot, null, 2) + '\n')
  console.log(`已生成契约快照: ${path.relative(ROOT, OUT)}（${defs.length} 个 schema）`)
} else if (fs.existsSync(OUT)) {
  // 产物新鲜度断言（b018）：--check 只跑校验、不写文件，若不比对生成物与现算结果，
  // 「快照过期」无人知（曾出现 schemas.ts 已改 7 天而快照 generatedAt 停在旧日期）。
  // 比对排除 generatedAt（日期字段每天变化，不参与内容判据）。
  const committed = JSON.parse(fs.readFileSync(OUT, 'utf8'))
  const { generatedAt: _ignored, ...committedRest } = committed
  const { generatedAt: _alsoIgnored, ...freshRest } = snapshot
  if (JSON.stringify(committedRest) !== JSON.stringify(freshRest)) {
    problems.push('✗ 契约快照与 schemas.ts 不同步：请跑 npm run types:gen 后提交生成物')
  }
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
