/**
 * 前端数值比较容差（W72）。
 *
 * 与后端 `backend/src/common/numeric-tolerance.ts` 是**同族的跨进程两份**：前后端不共享
 * 构建，无法 import 同一份，故各自持有；两侧目前都只用到几何/整数性这一档（1e-9），
 * 语义边界与后端文件一致。
 *
 * 跨端一致性由 `tools/v3-guard/constants-audit.mjs` 的浮点容差族对账（PC-2）：前端是
 * 后端三档全集的子集，同名档不同值即红；把本文件清空或自立档名同样红。
 */
export const COMPARE_TOLERANCE = 1e-9
