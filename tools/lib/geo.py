"""
WGS84 地理底座 —— **tools 侧 Python 唯一来源**（工具脚本一律从这里取，不再各自手抄）。

与 JS 侧 `tools/lib/geo.mjs` 同口径：常量名、语义、返回形状逐一对应。
本件与消费站点的「第二份手抄」由 `tools/lib/test_geo.py` 的扫描型判据钉住
（改一侧不报错 = 漂移）；站点侧只准 `from geo import …`，不得再写 6378137 / 111320 字面量。
"""

import math

import numpy as np

#: WGS84 长半轴（米）与扁率 —— 与 tools/lib/geo.mjs 的 WGS84_A / WGS84_F 同值
WGS84_A = 6378137.0
WGS84_F = 1 / 298.257223563
WGS84_E2 = WGS84_F * (2 - WGS84_F)

#: 每度经纬弧长（米）—— 北部湾纬度带的米级近似，与 JS 侧 DEG_M_LNG / DEG_M_LAT 同值
DEG_M_LNG = 111320
DEG_M_LAT = 110574

#: 反算迭代次数（与 JS 侧 ecefToGeo 一致；实测 4 次以上逐位收敛，见接力状态 §26/§27）
_ITER = 8


def ecef_to_geo(p):
    """ECEF (x, y, z) → (经度°, 纬度°, 椭球高 m)。

    入参吃 (N, 3) 数组与 3 元序列两种形状：前者返回三个等长数组，后者返回三个 float。
    迭代 `_ITER` 次牛顿法（与 JS 侧同一算法）；高在循环后重算一次（收敛值，与循环内末次实测逐位相同）。
    """
    arr = np.asarray(p, dtype=np.float64)
    scalar = arr.ndim == 1
    if scalar:
        arr = arr.reshape(1, 3)
    x, y, z = arr[:, 0], arr[:, 1], arr[:, 2]
    lng = np.degrees(np.arctan2(y, x))
    p2 = np.hypot(x, y)
    lat = np.arctan2(z, p2 * (1 - WGS84_E2))
    for _ in range(_ITER):
        n = WGS84_A / np.sqrt(1 - WGS84_E2 * np.sin(lat) ** 2)
        lat = np.arctan2(z, p2 * (1 - (WGS84_E2 * n) / (n + p2 / np.cos(lat) - n)))
    n = WGS84_A / np.sqrt(1 - WGS84_E2 * np.sin(lat) ** 2)
    h = p2 / np.cos(lat) - n
    lat = np.degrees(lat)
    if scalar:
        return float(lng[0]), float(lat[0]), float(h[0])
    return lng, lat, h


def m_per_deg(lat_deg):
    """纬度 `lat_deg`（度）处每度经、纬弧长（米）—— 经向随纬度收缩。"""
    lat = math.radians(lat_deg)
    return DEG_M_LNG * math.cos(lat), DEG_M_LAT
