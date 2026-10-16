/**
 * 桥构件色（GLB 顶点 COLOR_0）—— tools 侧唯一来源：`tools/3dtiles-build/build-bridges.mjs`
 * 建模、`tools/3dtiles-build/__tests__/build.test.mjs` 分桶断言、`tools/diag/probe-bridge-vert.py`
 * 按顶点色分桶（deck/pier/rail/tower）三处一律从这里派生。
 *
 * 为什么是 .mjs 而不是 .json：消费者跨 JS/PY 两侧，而两侧各抄一份时色值漂移**不报错**，
 * 只让探针分桶为空、判据恒红（P3·D23 余项，同 terrain_enc.py 一族问题）。
 * .mjs 让 JS 侧直接 import（无 fs 读取、无路径假设），PY 侧按固定形状解析同一个文件。
 *
 * 判据：`build.test.mjs` 的「桥构件色单源」describe（扫 JS 站点内联三元组）+
 * `tools/diag/test_bridge_palette.py`（扫 PY 站点）。改色值必须改这一份。
 */
export const BRIDGE_PALETTE = {
  deck: [0.72, 0.72, 0.74],
  pier: [0.55, 0.55, 0.57],
  rail: [0.35, 0.42, 0.55],
  tower: [0.8, 0.78, 0.72],
}
