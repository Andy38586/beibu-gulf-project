/**
 * tileset 包围盒工具（F60，2026-10-25 用户裁定 C）。
 *
 * 实测（3 变体 × 3 tileset × 5 距离 × 2 视角，共 90 帧）padding 0 / 现值 / 2 倍
 * 的 Cesium `statistics.visited` 完全一致且均 >0：padding 不是剔除的承重项，
 * 历史上的可见性故障根因是 glTF/ENU 轴序错位（见 build-bridges / build-roads 注释）。
 * 故各 builder 不再各写 +5/+20/+50，统一取本常量；保留 5 m 作为近机位边缘视角的
 * 保守余量（实测 0 也可用，但 5 m 不改变可见性且留出浮点/包围盒对齐余量）。
 */

/** 包围盒半轴统一 padding（米）。改这里 = 改所有 builder，禁止再写站点级魔法数。 */
export const BOX_PADDING_M = 5

/** 给半轴三元组加统一 padding */
export function paddedHalf(half, padding = BOX_PADDING_M) {
  return [half[0] + padding, half[1] + padding, half[2] + padding]
}

/**
 * 合并轴对齐 box 数组（3D Tiles box：中心 + 3 个半轴向量，本仓均为轴对齐）。
 * @param {number[][]} boxes
 * @returns {{center:number[], half:number[]}}
 */
export function mergeBoxes(boxes) {
  if (!boxes.length) throw new Error('mergeBoxes: 至少需要一个 box')
  const mn = [Infinity, Infinity, Infinity]
  const mx = [-Infinity, -Infinity, -Infinity]
  for (const b of boxes) {
    for (let k = 0; k < 3; k++) {
      const h = b[3 + k * 4]
      mn[k] = Math.min(mn[k], b[k] - h)
      mx[k] = Math.max(mx[k], b[k] + h)
    }
  }
  return {
    center: [(mn[0] + mx[0]) / 2, (mn[1] + mx[1]) / 2, (mn[2] + mx[2]) / 2],
    half: [(mx[0] - mn[0]) / 2, (mx[1] - mn[1]) / 2, (mx[2] - mn[2]) / 2],
  }
}

/** 中心 + 半轴 → 3D Tiles 轴对齐 box 数组 */
export function boxFromCenterHalf(center, half) {
  return [center[0], center[1], center[2], half[0], 0, 0, 0, half[1], 0, 0, 0, half[2]]
}
