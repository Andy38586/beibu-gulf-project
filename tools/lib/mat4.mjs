/**
 * mat4.mjs — 4×4 齐次变换矩阵的**唯一**实现（行主序 `number[4][4]`）。
 *
 * ## 表示（单一口径）
 *
 * 内部一律行主序：`M[行][列]`，点当列向量右乘，`p' = M · p`。
 * 列主序扁平 `number[16]`（`a[列*4+行]`，即 glTF / 3D Tiles `transform` 字段的 Cesium 语义）
 * **只出现在边界**：进来用 `toMath`，出去用 `toCol`。
 *
 * 这里没有第二套乘法：`mulCol` / `applyCol` 只是「转进来 → 调 `mul` / `mulPoint` → 转出去」
 * 的薄适配器，给那些手里已经是列主序 16 数组、又不该在调用点重复写换算的消费方用。
 *
 * ## 为什么集中（2026-10-25 F56，用户裁定 C：两套保留 + 分层）
 *
 * 改前同一语义有四份实现：`reanchor-hubs.mjs` 的行主序版，以及 `build-canal.mjs` 的
 * `mat4mul`、`probe-ground-boundary.mjs` / `probe-canal-hub-overlap.mjs` 的 `mul`
 * （后三份都是列主序扁平）。「乘法顺序（A·B 谁先作用）」与「主/列序换算」这两个口径
 * 分散在四处，改一处得同时改四处；而漏改的表现不是报错，是**模型歪了 / 包围盒飘了**
 * ——本项目已经踩过这类静默缺陷（见 glb.mjs 顶部那段 ENU 直通的复盘）。
 *
 * 现在：**算**只在这里（行主序），**存/传**才转列主序（`toCol`），转换点一眼可数。
 *
 * ## 不属于本件
 *
 * 轴序（`ENU → glTF Y-up` 的 `[e, u, -n]`）**不在这里**：唯一权威源是
 * `tools/3dtiles-build/glb.mjs` 的 `enuToGltf`（及其逆 `gltfToEnu`）。矩阵与轴序是两件事，
 * 混在一起改就分不清「转错了」还是「轴反了」。
 *
 * ## 约定
 *
 * `mul(A, B)` 是数学上的 `A·B`：作用到点上**先 B 后 A**，
 * 即 `mulPoint(mul(A, B), p)` ≡ `A·(B·p)`。顺序不可交换（`A·B ≠ B·A`），
 * 「谁是父、谁是子」由调用点举证，红样见 `tools/lib/__tests__/mat4.test.mjs`。
 */

/** 4×4 单位阵（行主序）。 */
export function identity() {
  return [
    [1, 0, 0, 0],
    [0, 1, 0, 0],
    [0, 0, 1, 0],
    [0, 0, 0, 1],
  ]
}

/**
 * 矩阵乘：`A · B`（先 B 后 A）。行主序 `number[4][4]` 进出。
 * @param {number[][]} A
 * @param {number[][]} B
 * @returns {number[][]}
 */
export function mul(A, B) {
  const R = Array.from({ length: 4 }, () => [0, 0, 0, 0])
  for (let r = 0; r < 4; r++)
    for (let c = 0; c < 4; c++) {
      let s = 0
      for (let k = 0; k < 4; k++) s += A[r][k] * B[k][c]
      R[r][c] = s
    }
  return R
}

/**
 * 矩阵 × 点：`M · p`（p 为 4 元齐次列向量，仿射变换时第 4 元取 1）。
 * @param {number[][]} M
 * @param {number[]} p
 * @returns {number[]} 4 元结果（含 w）
 */
export function mulPoint(M, p) {
  const out = [0, 0, 0, 0]
  for (let r = 0; r < 4; r++) {
    let s = 0
    for (let k = 0; k < 4; k++) s += M[r][k] * p[k]
    out[r] = s
  }
  return out
}

/**
 * 求逆（高斯-若尔当消元，含部分选主与行交换）。奇异矩阵抛错，不返回 NaN 阵——
 * NaN 会一路静默传播到落位坐标，比抛错难查得多。
 * @param {number[][]} A
 * @returns {number[][]}
 */
export function inv(A) {
  const M = A.map((r) => r.slice())
  const R = identity()
  for (let c = 0; c < 4; c++) {
    let p = c
    for (let r = c + 1; r < 4; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r
    if (Math.abs(M[p][c]) < 1e-12) throw new Error('奇异矩阵')
    if (p !== c) {
      ;[M[c], M[p]] = [M[p], M[c]]
      ;[R[c], R[p]] = [R[p], R[c]]
    }
    const d = M[c][c]
    for (let k = 0; k < 4; k++) {
      M[c][k] /= d
      R[c][k] /= d
    }
    for (let r = 0; r < 4; r++) {
      if (r === c) continue
      const f = M[r][c]
      for (let k = 0; k < 4; k++) {
        M[r][k] -= f * M[c][k]
        R[r][k] -= f * R[c][k]
      }
    }
  }
  return R
}

/**
 * 列主序扁平 16 → 行主序 `number[4][4]`（边界入口）。
 * `M[row][col] = a[col*4+row]`，即 glTF / 3D Tiles `transform` 的 Cesium 读法。
 * @param {number[]} a
 * @returns {number[][]}
 */
export function toMath(a) {
  const M = Array.from({ length: 4 }, () => [0, 0, 0, 0])
  for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) M[r][c] = a[c * 4 + r]
  return M
}

/**
 * 行主序 `number[4][4]` → 列主序扁平 16（边界出口）。
 * 写 tileset / glTF 的 `transform` 前**过这一次**，别在调用点手抄下标。
 * @param {number[][]} M
 * @returns {number[]}
 */
export function toCol(M) {
  const a = new Array(16)
  for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) a[c * 4 + r] = M[r][c]
  return a
}

/**
 * 列主序扁平 16 的矩阵乘（边界适配器）：`toCol(mul(toMath(a), toMath(b)))`。
 *
 * 语义与 `mul` 完全一致（`a·b`，先 b 后 a），只是两端不做行/列序搬家——
 * 给 `tileset.root.transform × child.transform` 这类「原生就是 Cesium 数组链」的调用点用。
 * **不是第二套实现**：乘法只有 `mul` 一处，这里只做两次换算。
 * @param {number[]} a
 * @param {number[]} b
 * @returns {number[]} 列主序 16
 */
export function mulCol(a, b) {
  return toCol(mul(toMath(a), toMath(b)))
}

/**
 * 列主序扁平 16 的矩阵 × 3 维点（边界适配器）：`mulPoint(toMath(m), [...p, 1])` 取前 3 元。
 *
 * 与 `mulCol` 同理：只做换算，算法在 `mulPoint`。
 * @param {number[]} m 列主序 16
 * @param {number[]} p `[x, y, z]`
 * @returns {number[]} `[x', y', z']`
 */
export function applyCol(m, p) {
  return mulPoint(toMath(m), [p[0], p[1], p[2], 1]).slice(0, 3)
}
