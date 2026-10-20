/**
 * 契约字段比对（`scripts/gen-api-contract.cjs` 的纯逻辑部分，单独成文件是为了能被测试导入）。
 *
 * 为什么单独抽出来：`gen-api-contract.cjs` 是线性脚本，顶层就跑完全部校验并可能 `process.exit`，
 * 导入即执行 ⇒ 无法为它写单元测试。而这个文件里的两个函数恰好是 W44 判据的全部承重逻辑
 * （「注解声明的后端类型存不存在」与「字段集合、可选性是否一致」），若无测试就等于
 * 「判据从未红过」——AGENTS §5.4 第四条：从未红过的门禁 = 不存在。
 *
 * 文本级解析，与脚本其余部分同粒度：不引 TS 编译器、不做类型求值。
 */

/**
 * 解析 TS 源码里指定 interface / type 的顶层字段与可选性。
 *
 * 为什么必须看可选性而不只看字段名：后端把 `foo?: number` 改成 `foo: number` 时，
 * 字段名一字未变，只判「名字还在」的判据全绿，而前端 zod 的 `.optional()` 已是另一个契约。
 * 这正是专项3 指标 7.6 里此前完全没有机器判据的那一半。
 *
 * 支持同文件内的 `extends`（`interface A extends B { … }` 会合并 B 的字段）——
 * `DiversionYearResult extends DiversionBreakdown { year: number }` 就是这种形状，
 * 不合并会把 `year` 误判成「zod 有 / 后端无」。
 *
 * @returns {Object<string,{optional:boolean}> | null} 解析不到返回 null（由调用方显式报错，不静默跳过）
 */
function parseTypeHead(src, typeName) {
  const head = new RegExp(`(?:export\\s+)?(?:interface|type)\\s+${typeName}\\b([^{=]*)[={]`)
  const m = head.exec(src)
  if (!m) return null
  const extendsList = []
  const ext = /\bextends\s+([\w$.,\s<>[\]]+)/.exec(m[1])
  if (ext) {
    for (const part of ext[1].split(',')) {
      const name = part
        .trim()
        .replace(/<[\s\S]*$/, '')
        .trim()
      if (/^[A-Za-z_$][\w$]*$/.test(name)) extendsList.push(name)
    }
  }
  return { index: m.index, headEnd: m.index + m[0].length - 1, extendsList }
}

/** 取从 `braceAt` 开始的配平花括号体（不含两端括号）；解析不到返回 null */
function braceBody(src, braceAt) {
  const open = src.indexOf('{', braceAt)
  if (open < 0) return null
  let depth = 0
  for (let i = open; i < src.length; i++) {
    if (src[i] === '{') depth++
    else if (src[i] === '}') {
      depth--
      if (depth === 0) return src.slice(open + 1, i)
    }
  }
  return null
}

/**
 * 把顶层（不在 {} () [] 内）的 `;` `,` 换成换行，交给下面的逐行扫描。
 *
 * 为什么必须切：`interface Base { x: number; y?: string }` 是合法 TS，只按换行切时
 * 整份体是一行，`x: number; y?: string` 被当成一个字段的 `rest`，`y` 静默消失，
 * 再由 compareFields 报成「y: zod 有 / 后端类型无」——噪声红，且找不到原因。
 */
function topLevelBreaks(body) {
  let out = ''
  let depth = 0
  for (const ch of body) {
    if ('{[('.includes(ch)) depth++
    // 夹住下界：`=>` 里的 `>` 会把深度压成负数，之后所有行都被当成嵌套行跳过
    else if ('}])'.includes(ch)) depth = Math.max(0, depth - 1)
    out += depth === 0 && (ch === ';' || ch === ',') ? '\n' : ch
  }
  return out
}

/** 逐行扫顶层字段；嵌套对象/映射里的字段属于别的契约，不计入本层 */
function scanFieldLines(body) {
  const out = {}
  let lineDepth = 0
  for (const raw of topLevelBreaks(body).split('\n')) {
    // 去行注释；块注释整段跳过（`/* ... */` 常见于字段说明或 JSDoc 尾巴）
    const line = raw
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/\/\/.*$/, '')
      .trim()
    if (!line) continue
    const before = lineDepth
    for (const ch of line) {
      if ('{[(<'.includes(ch)) lineDepth++
      else if ('}])>'.includes(ch)) lineDepth = Math.max(0, lineDepth - 1)
    }
    if (before !== 0) continue
    const fm = line.match(/^(?:readonly\s+)?([A-Za-z_$][\w$]*)(\??)\s*:\s*(.*)$/)
    if (!fm) continue
    out[fm[1]] = { optional: fm[2] === '?' || /\|\s*undefined\b/.test(fm[3]) }
  }
  return out
}

function tsTypeFields(src, typeName, seen = new Set()) {
  if (seen.has(typeName)) return {} // 循环 extends 防御：不死循环，也不把字段算两遍
  seen.add(typeName)
  const head = parseTypeHead(src, typeName)
  if (!head) return null
  const body = braceBody(src, head.headEnd)
  if (body === null) return null
  const merged = {}
  for (const parent of head.extendsList) {
    const parentFields = tsTypeFields(src, parent, seen)
    if (parentFields) Object.assign(merged, parentFields)
  }
  Object.assign(merged, scanFieldLines(body))
  return merged
}

/**
 * 比对 zod 侧字段集合与后端类型侧字段集合，返回漂移清单（空数组 = 一致）。
 *
 * 返回**结构化条目**而不是成品文案：文案是等价可改的，判据不该钉死它。
 * W44 初版直接返回中文串（`a: zod 选填 / 后端类型 必填`），于是测试只能钉措辞——
 * 一次同义改写（选填→可选）就会把本该绿的判据抹红（AGENTS §5.3 第三式）。
 * 现在文案由调用侧 `gen-api-contract.cjs` 决定，测试断的是 `issue` 与两侧可选标志。
 *
 * 三个 issue 语义：`zod-only` 前端多写、`ts-only` 后端多写、`optionality` 名字相同而可选性不同。
 * 两个方向都报：只报一个方向时，「后端删了字段」与「前端多写了字段」里总有一半看不见。
 */
function compareFields(zodFields, tsFields) {
  const drift = []
  for (const [field, z] of Object.entries(zodFields)) {
    if (!(field in tsFields)) {
      drift.push({ field, issue: 'zod-only' })
    } else if (tsFields[field].optional !== z.optional) {
      drift.push({
        field,
        issue: 'optionality',
        zodOptional: z.optional,
        tsOptional: tsFields[field].optional,
      })
    }
  }
  for (const field of Object.keys(tsFields)) {
    if (!(field in zodFields)) drift.push({ field, issue: 'ts-only' })
  }
  return drift
}

/**
 * 读 schema 声明上方紧贴的注释块，返回 `{ file, type, noType }`；无注解返回 null。
 *
 * 为什么 `noType` 也要在这里判：注解写到第二个 token（后端类型名）之前，
 * 它只能核对「字段名还在后端文件里」，判不了字段集合与可选性——而那正是指标 7.6
 * 的抽查项。2026-10-20（W44）实测 9 条注解里 8 条停在这个降级状态，全绿。
 * 若只把类型名加成「可选」，这 8 条会永久沉默；故缺类型名时必须由注解显式声明
 * `@backend-contract-no-type <为什么没有可配对类型>`，否则报错。
 */
function backendContractOf(schemasText, declStart) {
  const lines = schemasText.slice(0, declStart).split('\n')
  const block = []
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i].trim()
    if (line === '') continue
    // 只向上回溯连续注释；遇到代码即停（注解必须紧贴该 schema 的声明注释块）
    if (!line.startsWith('//') && !line.startsWith('*') && !line.startsWith('/*')) return null
    block.push(line)
    const hit = line.match(/^\/\/\s*@backend-contract\s+(\S+)(?:\s+(\w+))?/)
    if (hit) {
      // 理由必须写，不允许只打一个标记：`@backend-contract-no-type` 后面空的等于没声明。
      const noTypeLine = block.find((l) => /@backend-contract-no-type\b/.test(l))
      const reason = noTypeLine
        ? noTypeLine.replace(/^.*@backend-contract-no-type\b/, '').trim()
        : null
      return { file: hit[1], type: hit[2] ?? null, noType: reason }
    }
  }
  return null
}

/**
 * 注解本身的判据：缺类型名必须有 `@backend-contract-no-type <理由>` 声明。
 *
 * 单独成函数是为了能被测试直接喂合成注解——否则这条判据只能靠改真实 schemas.ts
 * 来验，测一次就得动生产文件。
 */
function annotationProblems(name, ann) {
  if (!ann || ann.type) return []
  if (ann.noType) return []
  return [
    `✗ ${name}: @backend-contract 只有路径没有类型名，只能判「字段名还在」，` +
      `判不了字段集合与可选性（专项3 指标 7.6 的抽查项）。` +
      `补上后端类型名；确无可配对类型时，在同一注释块写 ` +
      `\`@backend-contract-no-type <为什么没有可配对类型>\`，不得默不作声地降级。`,
  ]
}

module.exports = { tsTypeFields, compareFields, backendContractOf, annotationProblems }
