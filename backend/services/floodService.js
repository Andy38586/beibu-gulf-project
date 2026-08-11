/**
 * floodService — 洪涝灾害评估计算层（从 controller 抽出，与 forecast/site-analysis 分层对齐：
 * controller 只管参数校验与响应格式化，业务计算在此完成）
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
      // 脏数据防御：elevation 缺失/null 时 `null <= level` 隐式转 0 造成假阳性，仅接受有限数值
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
      // value/damageRate 缺失/非数值时按 0 计（显式区分：合法 0 保留，NaN/Infinity 归 0）
      loss:
        (Number.isFinite(Number(facility.value)) ? Number(facility.value) : 0) *
        (Number.isFinite(Number(facility.damageRate)) ? Number(facility.damageRate) : 0),
    }))

  const totalLoss = Math.round(affectedFacilities.reduce((sum, f) => sum + f.loss, 0))

  return {
    affectedFacilities,
    totalLoss,
    riskLevel: floodZone.riskLevel,
    waterLevel: floodZone.waterLevel,
  }
}
