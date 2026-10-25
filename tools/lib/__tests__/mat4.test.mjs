// tools/lib/mat4.mjs 的判据（2026-10-25 F56，用户裁定 C：内部行主序单源 + 写出过一次 toCol）。
//
// 三类，缺一类这套收成就站不住：
//   ① 数学性质：结合律 / 单位阵 / 求逆往返 / 列主序往返 —— 证明「单源本身是对的」。
//   ② 与**改前实现**逐位等价：旧列主序公式（build-canal.mat4mul 等三处同款）与旧 applyMat
//      公式作为 oracle，在真实 tileset 矩阵上要求 `toEqual`（不是 toBeCloseTo）；
//      再加 build-canal 两个消费点（hubTargets / hubCutWindows）输出的钉住值。
//      —— 这一条才是「4 套收成 1 套没改语义」的凭证：几何字节级不变靠它兜底。
//   ③ 单源：tools/ 下除 mat4.mjs 外不许再冒出第二份 4×4 乘法（含阳性对照，防判据空转）。
//
// 为什么不用容差：矩阵乘法换成「先 toMath 再 mul 再 toCol」若真等价，浮点累加顺序完全一样，
// 结果必然逐位相同；一旦出现 1e-12 级差异，说明有人改了累加顺序（例如把 k 循环展开成
// 点积库调用），那正是本任务要防的「静默换口径」。用 toEqual 才能咬住它。
import { createHash } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

import { hubCutWindows, hubTargets } from '../../3dtiles-build/build-canal.mjs'
import { applyCol, identity, inv, mul, mulCol, mulPoint, toCol, toMath } from '../mat4.mjs'

const TILES = 'backend/static/pinglu/tiles'
const TILESET = path.join(TILES, 'tileset.json')
const TS = JSON.parse(fs.readFileSync(TILESET, 'utf8'))
const T = TS.root.transform
/** 马道枢纽 depth-1 child（与 reanchor.test.mjs 同一件；它自带旋转+平移，能咬住乘法顺序） */
const CHILD = TS.root.children.find((c) =>
  String(c.content?.uri ?? '').startsWith('madao-')
).transform

/**
 * 改前 build-canal.mjs:225 `mat4mul` 的逐字副本 —— **oracle，不是实现**。
 * 它只在本测试里活，用来证明单源 `mulCol` 与旧实现逐位一致；生产代码里已无此函数。
 */
function legacyMat4Mul(a, b) {
  const o = new Array(16)
  for (let c = 0; c < 4; c++)
    for (let r = 0; r < 4; r++) {
      let s = 0
      for (let k = 0; k < 4; k++) s += a[k * 4 + r] * b[c * 4 + k]
      o[c * 4 + r] = s
    }
  return o
}

/** 改前 build-canal.mjs:235 `applyMat` 的逐字副本（oracle，同上） */
function legacyApplyMat(m, p) {
  return [
    m[0] * p[0] + m[4] * p[1] + m[8] * p[2] + m[12],
    m[1] * p[0] + m[5] * p[1] + m[9] * p[2] + m[13],
    m[2] * p[0] + m[6] * p[1] + m[10] * p[2] + m[14],
  ]
}

/** 有旋转分量的样例矩阵（行主序）：只给对角阵测不出顺序错 */
function sampleA() {
  const c = Math.cos(0.37)
  const s = Math.sin(0.37)
  return [
    [c, -s, 0, 12.5],
    [s, c, 0, -7.25],
    [0, 0, 1, 3],
    [0, 0, 0, 1],
  ]
}
function sampleB() {
  const c = Math.cos(-1.1)
  const s = Math.sin(-1.1)
  return [
    [1, 0, 0, 0],
    [0, c, -s, 0],
    [0, s, c, 0],
    [0, 0, 0, 1],
  ]
}
function sampleC() {
  return [
    [1, 0, 0, -321.5],
    [0, 1, 0, 44.125],
    [0, 0, 1, 7.75],
    [0, 0, 0, 1],
  ]
}

describe('mat4 单源 — 数学性质', () => {
  it('单位阵：A·I = I·A = A（逐位）', () => {
    const A = sampleA()
    expect(mul(A, identity())).toEqual(A)
    expect(mul(identity(), A)).toEqual(A)
  })

  it('结合律：(A·B)·C = A·(B·C)', () => {
    const lhs = mul(mul(sampleA(), sampleB()), sampleC())
    const rhs = mul(sampleA(), mul(sampleB(), sampleC()))
    for (let r = 0; r < 4; r++)
      for (let c = 0; c < 4; c++) expect(lhs[r][c]).toBeCloseTo(rhs[r][c], 12)
  })

  it('mulPoint：M·p 与逐行点积同口径（p 为齐次列向量）', () => {
    const A = sampleA()
    const p = [3, -4, 5, 1]
    const out = mulPoint(A, p)
    for (let r = 0; r < 4; r++) {
      const want = A[r][0] * p[0] + A[r][1] * p[1] + A[r][2] * p[2] + A[r][3] * p[3]
      expect(out[r]).toBe(want)
    }
    // 仿射阵的第 4 元保持 1（写成行主序后这不再是"自动成立"，值得钉一下）
    expect(out[3]).toBe(1)
  })

  it('求逆往返：A·inv(A) = inv(A)·A = I', () => {
    // 7 位：ECEF 尺度的 tileset 矩阵（平移 6.4e6 m）做消元必然带 1e-16 相对误差，
    // 绝对误差折算到 1e-9 级；再紧就是在考浮点噪声，不是在考求逆。
    for (const A of [sampleA(), mul(sampleA(), sampleB()), toMath(T)]) {
      for (const prod of [mul(A, inv(A)), mul(inv(A), A)])
        for (let r = 0; r < 4; r++)
          for (let c = 0; c < 4; c++) expect(prod[r][c]).toBeCloseTo(r === c ? 1 : 0, 7)
    }
  })

  it('求逆：奇异阵抛错，不吐 NaN 阵（NaN 会一路静默传播到落位坐标）', () => {
    const singular = [
      [1, 2, 3, 4],
      [2, 4, 6, 8],
      [0, 0, 1, 0],
      [0, 0, 0, 1],
    ]
    expect(() => inv(singular)).toThrow('奇异矩阵')
  })

  it('列主序往返：toCol(toMath(a)) 逐位回到 a（真实 tileset transform）', () => {
    expect(toCol(toMath(T))).toEqual(T)
    expect(toCol(toMath(CHILD))).toEqual(CHILD)
  })

  it('toMath 下标口径：a[col*4+row] → M[row][col]（写反就是转置，转置会静默歪模型）', () => {
    const M = toMath([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16])
    expect(M[1][0]).toBe(2)
    expect(M[0][1]).toBe(5)
    expect(M[3][2]).toBe(12)
  })
})

describe('mat4 单源 — 与改前实现逐位等价（oracle）', () => {
  it('mulCol 与旧列主序公式逐位一致（三处删掉的 mat4mul/mul 同款公式）', () => {
    const pairs = [
      [T, CHILD],
      [CHILD, T],
      [T, T],
      [T, legacyMat4Mul(CHILD, CHILD)],
    ]
    for (const [a, b] of pairs) {
      expect(mulCol(a, b)).toEqual(legacyMat4Mul(a, b))
      expect(mulCol(a, b)).toEqual(toCol(mul(toMath(a), toMath(b))))
    }
  })

  it('applyCol 与旧 applyMat 公式逐位一致', () => {
    const M = legacyMat4Mul(T, CHILD)
    for (const p of [
      [0, 0, 0],
      [180, 162.5, 0],
      [-1234.5, 678.25, -9.5],
    ])
      expect(applyCol(M, p)).toEqual(legacyApplyMat(M, p))
  })

  it('mulCol 是适配器不是第二实现：= toCol(mul(toMath(a), toMath(b)))', () => {
    const a = legacyMat4Mul(T, CHILD)
    const b = legacyMat4Mul(CHILD, T)
    expect(mulCol(a, b)).toEqual(toCol(mul(toMath(a), toMath(b))))
  })
})

/** 改前 build-canal 消费点（124/153/158 三处 mat4mul）的输出，改前实测钉住 */
const GOLDEN_PROD_T_C = [
  -0.10863398956305745, 0.3618323277045208, -0.9258920147293321, 0, -0.9476892803192282,
  -0.31891139175003363, -0.01343697064373052, 0, -0.3001394413928923, 0.8759982253634907,
  0.37754923504144167, 0, -1914130.1421203401, 5578445.840214997, 2420425.8911354863, 1,
]
const GOLDEN_TARGETS = JSON.stringify([
  { name: '马道枢纽', e: 11340.172607643919, n: 27372.619491969523 },
  { name: '企石枢纽', e: 11422.704694153741, n: 13327.890277501085 },
  { name: '青年枢纽', e: -18319.84258371538, n: -21272.969084462875 },
])
const GOLDEN_WINDOWS_SHA256 = '21a837f60dd8002ecbe1879270abdf576139426af9ad3953c2eec9bb578ef740'
const GOLDEN_WINDOW0_C = [11196.266157748745, 27921.19447282546, -35.15032337977027]

describe('mat4 单源 — 消费点承重（红样）', () => {
  it('🔴 @guard-red-sample 顺序不可交换：root·child 逐位钉住；把单源 mul 的 A/B 调换即必红', () => {
    expect(mulCol(T, CHILD)).toEqual(GOLDEN_PROD_T_C)
    // 若有人把 mul 的 A/B 写反（或 mulCol 里 a/b 对调），下面这条"本该不同"会变成相同 ⇒ 说明
    // 上面的钉住值是被偶然对称的输入骗过的。两条一起才能证明本用例对顺序真敏感。
    expect(mulCol(CHILD, T)).not.toEqual(GOLDEN_PROD_T_C)
  })

  it('🔴 @guard-red-sample 消费点 hubTargets 逐位钉住（mul 注入 return [] ⇒ 本用例抛错/红）', () => {
    expect(JSON.stringify(hubTargets(TILES))).toBe(GOLDEN_TARGETS)
  })

  it('🔴 @guard-red-sample 消费点 hubCutWindows 逐位钉住（同上；3.5 KB 结构用哈希，失败看首窗 C）', () => {
    const w = hubCutWindows(TILES, { margin: 30 })
    const sha = createHash('sha256').update(JSON.stringify(w)).digest('hex')
    // 先报可读的分量：哈希不符时这条给出「哪一窗开始偏」，省得面对一串十六进制
    expect(w[0].C).toEqual(GOLDEN_WINDOW0_C)
    expect(sha).toBe(GOLDEN_WINDOWS_SHA256)
  })
})

/* ---------- ③ 单源：tools/ 下不许再有第二份 4×4 乘法 ---------- */

const TOOLS = fileURLToPath(new URL('../../', import.meta.url))
const AUTHORITY_REL = 'lib/mat4.mjs'
const SKIP = new Set(['node_modules', '.git', '.local', '__pycache__', 'coverage', 'dist'])
/** 只扫生产源码；`*.test.*` 是夹具面（本文件里的 oracle 就是"第二份"，按设计豁免） */
const isCandidate = (rel) => /\.(mjs|cjs|js)$/.test(rel) && !/\.test\./.test(rel)

/**
 * 一份 4×4 乘法的形态，两条都算：
 *   P1 列主序扁平：`k` 循环里累加 **且** 出现 `* 4 +` 下标（删掉的三处就是这个形状）；
 *   P2 行主序三重循环：`s += X[r][k] * Y[k][c]`（把单源 mul 抄一份到别处的形状）。
 *
 * 诚实边界：只认这两种记法。把累加拆成 `reduce`/点积库调用、或先转置再乘（不写扁平下标、
 * 也不写三重循环），本判据不红 —— 那时靠上面消费点的逐位钉住值兜底（语义变了必然红）。
 */
const FLAT_ACC = /for \(let k = 0; k < 4; k\+\+\)\s*s \+=/
const FLAT_IDX = /\*\s*4\s*\+/
const ROW_MUL = /for \(let k = 0; k < 4; k\+\+\)\s*s \+= \w+\[r\]\[k\] \* \w+\[k\]\[c\]/

function looksLikeMat4Mul(src) {
  return (FLAT_ACC.test(src) && FLAT_IDX.test(src)) || ROW_MUL.test(src)
}

function scanCopies() {
  const hits = []
  const walk = (dir) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      if (SKIP.has(e.name)) continue
      const p = path.join(dir, e.name)
      if (e.isDirectory()) walk(p)
      else if (isCandidate(e.name) && looksLikeMat4Mul(fs.readFileSync(p, 'utf8')))
        hits.push(path.relative(TOOLS, p).split(path.sep).join('/'))
    }
  }
  walk(TOOLS)
  return hits.sort()
}

describe('mat4 单源 — tools/ 下只剩一份实现', () => {
  it('阴性面：除 lib/mat4.mjs 外 0 处第二份 4×4 乘法', () => {
    expect(scanCopies()).toEqual([AUTHORITY_REL])
  })

  it('阳性对照：旧 mat4mul 源码必须被判据咬住（否则"0 命中"是判据空转）', () => {
    const legacy = `
      function mat4mul(a, b) {
        const o = new Array(16)
        for (let c = 0; c < 4; c++)
          for (let r = 0; r < 4; r++) {
            let s = 0
            for (let k = 0; k < 4; k++) s += a[k * 4 + r] * b[c * 4 + k]
            o[c * 4 + r] = s
          }
        return o
      }`
    expect(looksLikeMat4Mul(legacy)).toBe(true)
    expect(looksLikeMat4Mul(fs.readFileSync(path.join(TOOLS, AUTHORITY_REL), 'utf8'))).toBe(true)
    // 近失对照：3 元点积、非矩阵的标量乘，都不该被误判成"第二份 4×4"
    expect(looksLikeMat4Mul('for (let k = 0; k < 3; k++) s += a[k] * b[k]')).toBe(false)
    expect(looksLikeMat4Mul('for (const p of pts) sum += p.x * 4')).toBe(false)
  })
})
