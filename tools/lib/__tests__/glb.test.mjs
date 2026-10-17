import fs from 'node:fs'
import { fileURLToPath } from 'node:url'

import ts from 'typescript'
import { describe, expect, it } from 'vitest'

import { accessor, BIN_CHUNK, CS, GLB_MAGIC, JSON_CHUNK, NC, readGLB } from '../glb.mjs'

/**
 * 守 `tools/lib/glb.mjs` 是 tools 侧 GLB 读链**唯一**来源。
 *
 * 为什么必须有这份判据：把 GLB 布局（chunk 类型、componentType/type 映射、步长）抄成第二份
 * **不会报错**——只会让探针读到另一套偏移（改一处不报错 = AGENTS 七-7）。断言的不是「有没有测试」，
 * 而是「第二份手抄还在不在」。
 *
 * 判据面 = tools/ 下 .mjs/.cjs/.js（含子目录），两路：
 *   ① 结构路径：`function readGLB/readGlb/loadGLB/readAccessor/readIndices/readChunks` 的第二份定义。
 *   ② 值路径：CS 形态对象字面量（>=3 个 5120..5126 数字键）、NC 形态（>=3 个 SCALAR/VEC2/VEC3/VEC4 键）、
 *      chunk 类型数值字面量（十进制/十六进制同咬）、`.byteStride` 成员访问、'BIN\\u0000' 字面量。
 *
 * 失效条件（诚实边界）：
 *   - 只认这些记法。把 CS 拆成两个 dict 再拼（`{...A, ...B}`）、或手工切 chunk 而不写 chunk 常量，判据不红。
 *   - 数值比对按值相等（不按文本），故十六进制与十进制同咬；但 `0x4e4f534a + 0` 这类算式不红。
 *   - 判据自身与 `*.test.*` 不在扫描面（测试夹具不是生产站点；`3dtiles-build/__tests__/build.test.mjs`
 *     有自造读器与 chunk 字面量断言，那是合成字节夹具，按设计豁免）。
 *   - 未跟踪目录（_traetmp / tmp-* / .local 等）不扫——判据输入必须受版本控制（5.4）。
 */
const ROOT = new URL('../../../', import.meta.url)
/** tools/ 自身（扫描根）：判据只扫 tools 下的 JS 站点，frontend/backend 不在面内 */
const TOOLS = new URL('../../', import.meta.url)
const AUTHORITY_REL = 'tools/lib/glb.mjs'
const GUARD_REL = 'tools/lib/__tests__/glb.test.mjs'
/** 只转发、不实现：readGLB 的第二定义在权威源，这里允许 re-export */
const FORWARDERS = new Set(['tools/3dtiles-build/glb-read.mjs'])
const SKIP = new Set(['node_modules', '.git', '.local', '.venv', '__pycache__', 'coverage', 'dist'])
const SCAN_EXT = /\.(mjs|cjs|js)$/

/** 第二份读器定义（值路径之外的结构路径） */
const BANNED_FNS = ['readGLB', 'readGlb', 'loadGLB', 'readAccessor', 'readIndices', 'readChunks']
/** CS 形态：>=3 个 GLB componentType 数字键的对象字面量 */
const CS_CODES = new Set(Object.keys(CS).map(Number))
/** NC 形态：>=3 个 glTF type 字符串键的对象字面量 */
const NC_TYPES = new Set(Object.keys(NC))
/** chunk 类型与 magic 的数值字面量（含十六进制写法，按值比） */
const BANNED_NUMS = [GLB_MAGIC, JSON_CHUNK, BIN_CHUNK]
/** glTF 的 bufferView 步长键名；读链收口后只剩权威源访问它 */
const STRIDE_KEY = 'byteStride'
/** BIN chunk 的 ascii 标记（旧 canal-hub 读法用它比对 chunk 类型） */
const BIN_TAG = 'BIN' + String.fromCharCode(0)

function numValue(text) {
  if (/^0[xX][0-9a-fA-F]+$/.test(text)) return Number.parseInt(text.slice(2), 16)
  return Number(text)
}

/** 一个源码里有没有「第二份手抄」——返回命中说明数组（空数组 = 干净） */
function findCopies(source, file) {
  const sf = ts.createSourceFile(file, source, ts.ScriptTarget.ES2022, true, ts.ScriptKind.JS)
  const hits = []
  const line = (n) => sf.getLineAndCharacterOfPosition(n.getStart()).line + 1
  const forwarder = FORWARDERS.has(file)
  const visit = (n) => {
    if (ts.isFunctionDeclaration(n) && n.name && BANNED_FNS.includes(n.name.text) && !forwarder)
      hits.push(file + ':' + line(n) + ' 第二份读器定义 ' + n.name.text)
    if (
      ts.isVariableDeclaration(n) &&
      ts.isIdentifier(n.name) &&
      BANNED_FNS.includes(n.name.text) &&
      !forwarder
    ) {
      const init = n.initializer
      const isFn = init && (ts.isArrowFunction(init) || ts.isFunctionExpression(init))
      if (isFn)
        hits.push(file + ':' + line(n) + ' 第二份读器定义 ' + n.name.text + '（函数表达式）')
    }
    if (ts.isNumericLiteral(n) && BANNED_NUMS.includes(numValue(n.text)))
      hits.push(file + ':' + line(n) + ' chunk/magic 字面量 ' + n.text)
    if (ts.isStringLiteral(n) && n.text === BIN_TAG)
      hits.push(file + ':' + line(n) + ' BIN chunk ascii 标记字面量')
    if (ts.isPropertyAccessExpression(n) && n.name.text === STRIDE_KEY)
      hits.push(file + ':' + line(n) + ' .' + STRIDE_KEY + ' 步长取法')
    if (ts.isObjectLiteralExpression(n)) {
      let csHits = 0
      let ncHits = 0
      for (const p of n.properties) {
        if (!ts.isPropertyAssignment(p)) continue
        const key = p.name
        // 键名可能是标识符（`SCALAR: 1`）也可能是字符串（`'SCALAR': 1`），两种都咬
        const keyName = ts.isIdentifier(key) || ts.isStringLiteral(key) ? key.text : null
        if (ts.isNumericLiteral(key) && CS_CODES.has(Number(key.text))) csHits++
        if (keyName !== null && NC_TYPES.has(keyName)) ncHits++
      }
      if (csHits >= 3)
        hits.push(file + ':' + line(n) + ' CS 形态对象字面量（' + csHits + ' 个 componentType 键）')
      if (ncHits >= 3)
        hits.push(file + ':' + line(n) + ' NC 形态对象字面量（' + ncHits + ' 个 type 键）')
    }
    ts.forEachChild(n, visit)
  }
  visit(sf)
  return hits
}

/** 递归扫 tools/（豁免：权威源自身、判据自身、*.test.*） */
function scanRepo() {
  const hits = []
  let scanned = 0
  const walk = (url, relDir) => {
    for (const e of fs.readdirSync(url, { withFileTypes: true })) {
      const rel = relDir + e.name
      // dist* 是构建产物（含 vendored Cesium 打包件），不是站点；与 geo.test.mjs 同口径
      if (SKIP.has(e.name) || e.name.startsWith('tmp-') || e.name.startsWith('dist')) continue
      if (e.name.startsWith('.')) continue
      if (e.isDirectory()) {
        walk(new URL(e.name + '/', url), rel + '/')
        continue
      }
      if (
        !SCAN_EXT.test(e.name) ||
        /\.test\./.test(e.name) ||
        rel === AUTHORITY_REL ||
        rel === GUARD_REL
      )
        continue
      scanned++
      hits.push(...findCopies(fs.readFileSync(new URL(e.name, url), 'utf8'), rel))
    }
  }
  walk(TOOLS, 'tools/')
  return { hits, scanned }
}

/** 站点是否（直接或经一层本地转发）从权威源取读链 */
function wiredToAuthority(rel) {
  const text = fs.readFileSync(new URL(rel, ROOT), 'utf8')
  if (text.includes('lib/glb.mjs')) return true
  for (const m of text.matchAll(/from\s+'(\.[^']+)'/g)) {
    const target = m[1].replace(/\.mjs$/, '.mjs')
    const url = new URL(target, new URL(rel, ROOT))
    if (!fs.existsSync(url)) continue
    if (fs.readFileSync(url, 'utf8').includes('lib/glb.mjs')) return true
  }
  return false
}

describe('GLB 读链单源（P4 遗留 glb.py/glb.mjs 补做）', () => {
  it('权威源形状：chunk 常量与两张映射表齐全', () => {
    expect(GLB_MAGIC).toBe(0x46546c67)
    expect(JSON_CHUNK).toBe(0x4e4f534a)
    expect(BIN_CHUNK).toBe(0x004e4942)
    expect(
      Object.keys(CS)
        .map(Number)
        .sort((a, b) => a - b)
    ).toEqual([5120, 5121, 5122, 5123, 5125, 5126])
    expect(Object.keys(NC).sort()).toEqual(['SCALAR', 'VEC2', 'VEC3', 'VEC4'])
  })

  it('真语料取数：入库 canal.glb 可读且元素宽度 = componentType 原生宽度', () => {
    // fileURLToPath 而非 URL.pathname：Linux 上 pathname 剥首斜杠会退化成相对路径
    // （CI run 287/288 的 ENOENT 红样），Windows 上恰好是绝对路径故本机一直绿。
    const file = fileURLToPath(
      new URL('../../../backend/static/pinglu/canal/canal.glb', import.meta.url)
    )
    expect(fs.existsSync(file), '夹具必须受版本控制（5.4）').toBe(true)
    const { json, bin } = readGLB(file)
    expect(json.asset.version).toBe('2.0')
    expect(Buffer.isBuffer(bin)).toBe(true)
    const ai = json.meshes[0].primitives[0].attributes.POSITION
    const a = json.accessors[ai]
    const arr = accessor(json, bin, ai)
    expect(arr.length).toBe(a.count * NC[a.type])
    expect(arr.constructor.name).toBe(
      { 5126: 'Float32Array', 5125: 'Uint32Array', 5123: 'Uint16Array' }[a.componentType]
    )
  })

  it('tools 下无第二份手抄（阴性 0 命中 + 阳性/近失对照）', () => {
    // 对照值一律从权威源派生，不得手写——否则改权威值会让判据自己误红
    const young = [
      'function readGLB(file) { return file }',
      'const readAccessor = (json, bin, i) => i',
      'const loadGLB = function (f) { return f }',
      'const CS = { ' +
        Object.keys(CS)
          .slice(0, 3)
          .map((k) => k + ': ' + CS[k])
          .join(', ') +
        ' }',
      'const NC = { SCALAR: 1, VEC2: 2, VEC3: 3 }',
      'const ty = ' + JSON_CHUNK,
      'const ty = 0x' + JSON_CHUNK.toString(16),
      'const off = buf.readUInt32LE(' + BIN_CHUNK + ')',
      'const stride = bv.byteStride || sz * nc',
      // 源码里写成 \u0000 转义，解到 AST 就是带 NUL 的字符串字面量（旧 canal-hub 读法）
      'if (tag === ' + JSON.stringify('BIN' + String.fromCharCode(0)) + ') bin = d',
    ]
    for (const s of young) expect(findCopies(s, 'synth-positive.mjs'), s).not.toEqual([])

    // 近失样本：同形但不含禁值 ⇒ 不许红
    const nearMiss = [
      'function readGltf(file) { return file }',
      'const CS = { 5120: 1, 5121: 1 }',
      'const NC = { SCALAR: 1, VEC2: 2 }',
      'const ty = ' + (JSON_CHUNK + 1),
      'const idx = accessor(json, bin, i)',
      'const s = bv.stride || sz * nc',
      "const m = 'BIN'",
    ]
    for (const s of nearMiss) expect(findCopies(s, 'synth-negative.mjs'), s).toEqual([])

    const { hits, scanned } = scanRepo()
    expect(scanned, '扫描面为空 ⇒ 根路径写错，先红').toBeGreaterThan(50)
    expect(hits).toEqual([])
  })

  it('8 个消费者仍从权威源取读链（含一层转发）', () => {
    const stations = [
      'tools/lib/glb.mjs',
      'tools/3dtiles-build/glb-read.mjs',
      'tools/3dtiles-build/glb.mjs',
      'tools/3dtiles-build/ground-ref.mjs',
      'tools/3dtiles-build/clean-cargo.mjs',
      'tools/3dtiles-build/rebuild-containers.mjs',
      'tools/3dtiles-build/build-roads.mjs',
      'tools/diag/probe-canal-hub-overlap.mjs',
      'tools/diag/probe-ground-boundary.mjs',
    ]
    for (const rel of stations)
      expect(wiredToAuthority(rel), rel + ' 未从 ' + AUTHORITY_REL + ' 取 GLB 读链').toBe(true)
  })
})
