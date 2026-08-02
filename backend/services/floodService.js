/**
 * floodService — 洪涝灾害评估业务逻辑（d041）
 *
 * 从 floodAnalysisController 抽出的计算层，与 forecast/site-analysis 分层对齐。
 * Controller 只负责参数校验 + 响应格式化，业务计算在此完成。
 */

/**
 * 灾害评估：根据水位筛选受影响设施并计算损失
 * @param {Array} facilities - 设施点数组（含 elevation/value/damageRate）
 * @param {number} level - 请求水位（米）
 * @param {object|null} floodZone - 匹配的淹没档位（含 waterLevel/riskLevel）
 * @returns {{ affectedFacilities: Array, totalLoss: number, riskLevel: string, waterLevel: number|undefined }}
 */
export function assessDisaster(facilities, level, floodZone) {
  if (!floodZone) {
    return { affectedFacilities: [], totalLoss: 0, riskLevel: '无', waterLevel: undefined }
  }

  const affectedFacilities = facilities
    .filter(
      // B-9（阶段6 复核）: elevation 缺失/null 时 `null <= level` 被 JS 隐式转 0 → 假阳性。
      // 与 filterFacilitiesInCoverage 的脏数据防御对齐：仅接受有限数值。
      (facility) =>
        facility.elevation !== null &&
        facility.elevation !== undefined &&
        Number.isFinite(Number(facility.elevation)) &&
        facility.elevation <= level
    )
    .map((facility) => ({
      id: facility.id,
      name: facility.name,
      type: facility.type,
      port: facility.port,
      lng: facility.lng,
      lat: facility.lat,
      elevation: facility.elevation,
      value: facility.value,
      damageRate: facility.damageRate,
      // B-9: value/damageRate 缺失时避免 `undefined * 0.5 = NaN` 污染 totalLoss（NaN 经 JSON 序列化为 null）
      loss: (Number(facility.value) || 0) * (Number(facility.damageRate) || 0),
    }))

  const totalLoss = Math.round(affectedFacilities.reduce((sum, f) => sum + f.loss, 0))

  return {
    affectedFacilities,
    totalLoss,
    riskLevel: floodZone.riskLevel,
    waterLevel: floodZone.waterLevel,
  }
}
