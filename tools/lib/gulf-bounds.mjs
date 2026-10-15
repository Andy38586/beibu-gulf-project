/**
 * 北部湾业务边界 —— **tools 侧唯一来源**（工具脚本一律从这里取，不再各自手抄）。
 *
 * 权威 = `backend/src/common/constants/gis.constants.ts` 的 `GULF_BOUNDS`；
 * 本件与之逐字段对账由 `tools/v3-guard/constants-audit.mjs` 强制（改一侧不报错 = 漂移）。
 * 前端侧镜像 `frontend/src/shared/utils/crs.ts` 的 `BEIBU_GULF_BBOX` 同样由该守卫对账。
 */
export const GULF_BOUNDS = { minLng: 105, maxLng: 115, minLat: 18, maxLat: 25 }
