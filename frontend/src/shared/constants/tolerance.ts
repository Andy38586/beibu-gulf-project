/**
 * 前端数值比较容差（W72）。
 *
 * 与后端 `backend/src/common/numeric-tolerance.ts` 是**同族的跨进程两份**：前后端不共享
 * 构建，无法 import 同一份，故各自持有；两侧目前都只用到几何/整数性这一档（1e-9），
 * 语义边界与后端文件一致。
 *
 * 跨端一致性**没有守卫**（改一侧不改另一侧不会红）——属新增判据域（§四-10），已在台账登记为缺口。
 */
export const COMPARE_TOLERANCE = 1e-9
