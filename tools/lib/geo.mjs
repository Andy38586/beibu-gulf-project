/**
 * WGS84 地理底座 —— **tools 侧唯一来源**（工具脚本一律从这里取椭球参数与经纬↔ECEF 换算，
 * 不再各自手抄一份）。
 *
 * 为什么必须单源：椭球参数与正反算原本散在 8 个脚本里各抄一份，改一处不报错、只让交付包与
 * 探针的落位悄悄错开（AGENTS §七-7）。判据 `tools/lib/__tests__/geo.test.mjs` 以全仓扫描兜住
 * 第二份手抄（常量字面量与同名局部实现两路）。
 *
 * 口径：经纬度单位为度、椭球高为米；ECEF 为地心地固直角坐标（X 轴穿 0° 子午线）。
 * 反算统一用 8 次迭代——本仓原有 6 / 8 / 12 次迭代与 Bowring 闭式四种实现，2026-10-16 在 15 个
 * 采样点上实测互差 ≤1.4e-14 度（≈1.6e-9 m），故合并为一份不改变任何输出。
 */

/** 长半轴（米） */
export const WGS84_A = 6378137.0
/** 扁率 */
export const WGS84_F = 1 / 298.257223563
/** 第一偏心率平方 */
export const WGS84_E2 = WGS84_F * (2 - WGS84_F)

/** 赤道处 1° 经度对应的米数（≈ 2πa/360）；经度方向的实际长度还要再乘 cos(纬度) */
export const DEG_M_LNG = 111320
/** 赤道处 1° 纬度对应的米数（≈ 子午圈曲率半径 × π/180） */
export const DEG_M_LAT = 110574

const D2R = Math.PI / 180
const R2D = 180 / Math.PI

/** 经纬度（度，椭球高米）→ ECEF（米） */
export function geoToEcef(lon, lat, h = 0) {
  const L = lon * D2R
  const B = lat * D2R
  const N = WGS84_A / Math.sqrt(1 - WGS84_E2 * Math.sin(B) ** 2)
  return [
    (N + h) * Math.cos(B) * Math.cos(L),
    (N + h) * Math.cos(B) * Math.sin(L),
    (N * (1 - WGS84_E2) + h) * Math.sin(B),
  ]
}

/**
 * ECEF（米）→ [经度°, 纬度°, 椭球高 m]。
 *
 * 入参是三元数组——仓内调用点原本就是数组、数组解构或展开形态，标量形态会让 4 处调用点
 * 各写一次数组字面量。
 */
export function ecefToGeo(p) {
  const [x, y, z] = p
  const lon = Math.atan2(y, x)
  const p2 = Math.hypot(x, y)
  let lat = Math.atan2(z, p2 * (1 - WGS84_E2))
  let h = 0
  for (let i = 0; i < 8; i++) {
    const N = WGS84_A / Math.sqrt(1 - WGS84_E2 * Math.sin(lat) ** 2)
    h = p2 / Math.cos(lat) - N
    lat = Math.atan2(z, p2 * (1 - (WGS84_E2 * N) / (N + h)))
  }
  return [lon * R2D, lat * R2D, h]
}

/** 以锚点建 ENU→ (lon, lat, h椭球) → [E, N, U]；T 为列优先 4×4（交付包 root.transform 同款） */
export function makeToEnu(T) {
  const R = [T[0], T[1], T[2], T[4], T[5], T[6], T[8], T[9], T[10]]
  const O = [T[12], T[13], T[14]]
  return (lon, lat, h = 0) => {
    const P = geoToEcef(lon, lat, h)
    const d = [P[0] - O[0], P[1] - O[1], P[2] - O[2]]
    return [
      R[0] * d[0] + R[1] * d[1] + R[2] * d[2],
      R[3] * d[0] + R[4] * d[1] + R[5] * d[2],
      R[6] * d[0] + R[7] * d[1] + R[8] * d[2],
    ]
  }
}

/** ENU(e, n, u) → [经度°, 纬度°]（局部 → ECEF → 经纬；只要平面落位，不带椭球高） */
export function makeEnuToLngLat(T) {
  return (e, n, u) => {
    const x = T[0] * e + T[4] * n + T[8] * u + T[12]
    const y = T[1] * e + T[5] * n + T[9] * u + T[13]
    const z = T[2] * e + T[6] * n + T[10] * u + T[14]
    const [lon, lat] = ecefToGeo([x, y, z])
    return [lon, lat]
  }
}
