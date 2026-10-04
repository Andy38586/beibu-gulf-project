/**
 * **LOD 统一切换口径**（三枢纽与钦州港作业区共用一个权威源）。
 *
 * 含义：细化开关（"带内容 + 有子节点"的节点）的 `geometricError ÷ maximumScreenSpaceError`
 * （米 GE / 像素 SSE）。Cesium 的 `SSE = GE · drawingBufferHeight / (distance · sseDenominator)`，
 * 粗精切换发生在 `SSE > maxSSE` ⇒ **同视口下 K 相同的资产在同一相机距离切换**。
 *
 * ## 取值来源（不是拍的）
 *
 * 沿三枢纽现网值锚定：枢纽细化开关 GE 由包围尺度归一化到 2000 m、注册屏误差 16
 * ⇒ K = 2000 / 16 = 125。两侧都从本常数派生：
 * - 枢纽：`preparePingluHubTileset` 用 `K × PINGLU_HUB_MAX_SSE`；
 * - 港区：`beibu3dTiles` 清单条目用 `K × QINZHOU_MAX_SSE`。
 *
 * ## 修的是什么（2026-10-04 运行时实测）
 *
 * 港区 root GE 原由 `capRootGeometricError` 压到数据自派生的 8558 ⇒ K = 8558/32 = 267，
 * 精细层窗口是三枢纽的 **2.14×**。探针实测（`.local/3d-review/lod-ladder/`）：
 * 160 km 机位下三枢纽已退粗壳（sel=1，~1.5k tri），港区仍在拉精细层（sel=7，458283 tri）；
 * 而六个采样档（300 m~586 km）恰好**跨过**不一致区间，此前一直判绿。
 * 统一后同一探针：120 km 四资产同为细、160 km / 586 km 四资产同为粗（EXIT=0）。
 *
 * ## 为什么统一在"枢纽侧"（取小，而不是把枢纽推到港区侧）
 *
 * ① 港区精细层是重资产（作业区 7 块 ≈ 23 MB、458283 tri），远机位不再拉它，与
 * 「不一口气全加载」一致；② 三枢纽/桥梁条目既有行为不变；③ 反过来（K 取 267）只在
 * 138~297 km 多拉几块枢纽构件，代价与收益不成比例。
 * **若用户要求远景保留港区精细层，改本常数一处即可**——两侧都从它派生，
 * 不存在"改一处忘另一处"；改完须重跑 `tools/diag/lod-ladder.cjs`（形态表）。
 *
 * **失效条件**：① 相机 FOV / 视口口径变化不影响统一性（K 是比值），但若 Cesium 改掉
 * SSE 公式或 traversal 语义，K 的物理含义作废；② 某资产改为多层细化、ADD 混用或
 * REPLACE 语义变化时，单一细化开关不再代表切换距离，须按运行时探针重定。
 */
export const LOD_REFINE_GE_PER_SSE = 125
