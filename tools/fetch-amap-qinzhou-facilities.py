"""
fetch-amap-qinzhou-facilities.py — 高德 POI 抓取钦州港真实设施（2026-08-06）

背景：facilityPoints.json 原钦州港 8 个设施（QZ-*）为编造数据（大榄坪 1/2 号泊位、
金谷港区码头等）。用户提供高德 Web 服务 API key，要求"把整个钦州港覆盖完，
只需要钦州港的"（2026-08-06 拍板）。

抓取策略（与用户逐轮确认）：
- 类别：港口码头（types=1503，18 个）+ 堆场（keywords=堆场）+ 保税仓储/物流
  （keywords=保税 中名称含仓储/物流）——放弃油库/储罐（高德仅收录加油站，真储罐 0 个）
- 区域：钦州港核心港区 bbox（lng 108.55~108.70 / lat 21.59~21.78），过滤
  外围旅游/古迹/偏远点（海豚湾码头、西汉古码头、坡心码头、越也码头等）
- 位置/名字：高德 POI（真实）；value/damageRate：按类型的合理估算（假数据）
- elevation：DEM 采样（backend/data/flood/dem/filled_utm48n_cut.tif，经纬度→UTM48N）
- 合并：原防城港（FCG-*）/北海港（BH-*）设施保留（淹没分析覆盖北部湾全域），
  钦州港部分整体替换为 22 个真实设施（QZ-* 重新编号）

输出：backend/data/flood/facilityPoints.json（格式与原来一致，FastAPI 零改动读取）

跑法：
  cd backend/flood-service
  ./.venv/Scripts/python.exe ../../tools/fetch-amap-qinzhou-facilities.py
"""

from __future__ import annotations

import json
import os
import urllib.parse
import urllib.request
from pathlib import Path

# 高德 key（用户提供 2026-08-06）：从本地 tools/.amap_key 读取（已 gitignore），
# 不提交仓库——防 key 泄露进 git 历史（前车之鉴：天地图 key 曾泄 7 个 commit）
_AMAP_KEY_FILE = Path(__file__).parent / ".amap_key"
AMAP_KEY = os.environ.get("AMAP_KEY", "")
if not AMAP_KEY and _AMAP_KEY_FILE.exists():
    AMAP_KEY = _AMAP_KEY_FILE.read_text(encoding="utf-8").strip()
if not AMAP_KEY:
    raise SystemExit(f"缺少高德 key：请写入环境变量 AMAP_KEY 或文件 {_AMAP_KEY_FILE}")

# 钦州港核心港区 bbox（过滤外围旅游/古迹/偏远点）
LNG0, LNG1, LAT0, LAT1 = 108.55, 108.70, 21.59, 21.78

# 输出文件：backend/data/flood/facilityPoints.json
OUT_PATH = Path(__file__).resolve().parents[1] / "backend" / "data" / "flood" / "facilityPoints.json"
# DEM（elevation 采样）
DEM_PATH = (
    Path(__file__).resolve().parents[1]
    / "backend" / "data" / "flood" / "dem" / "filled_utm48n_cut.tif"
)

# 类型 → (value 资产估算 万元, damageRate 损坏率)——合理假设的假数据
TYPE_VALUE_RATE: dict[str, tuple[int, float]] = {
    "港口码头": (15000, 0.85),
    "泊位": (15000, 0.85),
    "堆场": (6000, 0.6),
    "仓储": (8000, 0.55),
    "物流": (8000, 0.55),
}


def amap(params: dict) -> dict:
    url = "https://restapi.amap.com/v3/place/text?" + urllib.parse.urlencode(
        {**params, "key": AMAP_KEY, "output": "json"}
    )
    with urllib.request.urlopen(url, timeout=10) as r:
        return json.loads(r.read().decode("utf-8"))


def fetch_all(query: dict) -> list[dict]:
    """分页拉全量 POI（上限 6 页防死循环）。"""
    all_pois: list[dict] = []
    page = 1
    while True:
        d = amap({**query, "offset": 20, "page": page})
        pois = d.get("pois", [])
        all_pois.extend(pois)
        if len(all_pois) >= int(d.get("count", 0)) or not pois:
            break
        page += 1
        if page > 6:
            break
    return all_pois


def in_harbor(p: dict) -> bool:
    try:
        lng, lat = map(float, p.get("location", "0,0").split(","))
    except ValueError:
        return False
    return LNG0 <= lng <= LNG1 and LAT0 <= lat <= LAT1


def classify(name: str, raw_type: str) -> str:
    """高德 type 三级 → 业务分类（港口码头/堆场/仓储/物流）。"""
    if "港口码头" in raw_type or "码头" in name or "泊位" in name or "口岸" in name:
        return "港口码头"
    if "堆场" in name:
        return "堆场"
    if "仓储" in name:
        return "仓储"
    if "物流" in name:
        return "物流"
    return "港口码头"


def sample_elevation(coords: list[tuple[float, float]]) -> list[float | None]:
    """DEM 采样高程（经纬度 → UTM48N）。DEM 缺失/采样失败返回 None（降级为估算）。"""
    if not DEM_PATH.exists():
        return [None] * len(coords)
    try:
        import numpy as np
        import rasterio
        from rasterio.warp import transform_geom

        with rasterio.open(DEM_PATH) as src:
            utm_pts = []
            for lng, lat in coords:
                g = transform_geom("EPSG:4326", src.crs, {"type": "Point", "coordinates": [lng, lat]})
                utm_pts.append(tuple(g["coordinates"]))
            # src.sample 返回 shape (N,1) 的数组迭代——统一拉平取值
            vals = [float(np.asarray(v).ravel()[0]) for v in src.sample(utm_pts, indexes=1)]
        return [None if v is None else round(v, 1) for v in vals]
    except Exception as e:  # noqa: BLE001 —— DEM 采样失败降级估算
        print(f"  ! DEM 采样失败（降级为估算高程）: {e}")
        return [None] * len(coords)


def build_qinzhou_facilities() -> list[dict]:
    """抓取高德 POI → 钦州港真实设施列表（QZ-* 编号）。"""
    ports = fetch_all({"types": "1503", "city": "钦州", "citylimit": "true"})
    yards = fetch_all({"keywords": "堆场", "city": "钦州", "citylimit": "true"})
    baoshui_raw = fetch_all({"keywords": "保税", "city": "钦州", "citylimit": "true"})
    print(f"  调试: 港口码头 {len(ports)} / 堆场 {len(yards)} / 保税 {len(baoshui_raw)}")
    baoshui = [
        p
        for p in baoshui_raw
        if in_harbor(p) and ("仓储" in p.get("name", "") or "物流" in p.get("name", ""))
    ]
    print(f"  调试: 保税港区内仓储/物流 {len(baoshui)} 个")
    for p in baoshui:
        print(f"    {p.get('name')} @ {p.get('location')}")

    # 港区内港口码头 + 堆场 + 保税仓储（按 name 去重，钦州港保税港区外贸码头3号泊位与
    # 外贸码头坐标相同但名字不同——保留两个，语义不同）
    seen: set[str] = set()
    candidates: list[dict] = []
    for p in ports + yards + baoshui:
        if not in_harbor(p):
            continue
        name = p.get("name", "")
        if not name or name in seen:
            continue
        seen.add(name)
        lng, lat = map(float, p.get("location", "0,0").split(","))
        candidates.append({"name": name, "lng": lng, "lat": lat})

    # DEM 采样高程
    elevs = sample_elevation([(c["lng"], c["lat"]) for c in candidates])

    facilities = []
    for i, c in enumerate(candidates):
        cls = classify(c["name"], "")
        value, rate = TYPE_VALUE_RATE.get(cls, (8000, 0.6))
        # 简易风险推导：港口码头/泊位高风险，堆场/仓储中风险
        risk = "高" if cls in ("港口码头", "泊位") else "中"
        facilities.append(
            {
                "id": f"QZ-{i + 1:03d}",
                "name": c["name"],
                "type": cls,
                "port": "钦州港",
                "lng": round(c["lng"], 6),
                "lat": round(c["lat"], 6),
                "elevation": elevs[i] if elevs[i] is not None else 5.0,
                "value": value,
                "damageRate": rate,
                "riskLevel": risk,
                "description": f"高德 POI 抓取（{cls}）",
            }
        )
    return facilities


def main() -> None:
    qz = build_qinzhou_facilities()
    print(f"钦州港真实设施: {len(qz)} 个")
    for f in qz:
        print(f"  {f['id']} {f['name']} | {f['type']} | ({f['lng']:.4f},{f['lat']:.4f}) elev={f['elevation']}")

    # 原文件保留防城港/北海港（FCG-*/BH-*），钦州港 QZ-* 整体替换
    old = json.loads(OUT_PATH.read_text(encoding="utf-8"))
    keep = [f for f in old["facilities"] if not f["id"].startswith("QZ-")]
    print(f"保留原防城/北海: {len(keep)} 个（{sum(1 for f in keep if f['id'].startswith('FCG'))} FCG + {sum(1 for f in keep if f['id'].startswith('BH'))} BH）")

    metadata = {
        "description": "北部湾港风险影响设施点数据（钦州港=高德 POI 真实设施 2026-08-06；防城/北海=原 DEM 5x5 采样版）",
        "coordinateSystem": "EPSG:4326 (WGS84)",
        "elevationUnit": "米",
        "valueUnit": "万元",
        "version": "2.0.0",
        "createdAt": "2026-07-19",
        "updatedAt": "2026-08-06",
        "amapSource": "高德 Web 服务 API v3/place/text（types=1503 港口码头 + keywords=堆场/保税）",
        "amapKeyNote": "key 存于本脚本，勿提交到公开仓库",
    }
    merged = {"metadata": metadata, "facilities": keep + qz}
    OUT_PATH.write_text(json.dumps(merged, ensure_ascii=False, indent=2), encoding="utf-8")
    size = OUT_PATH.stat().st_size / 1024
    print(f"写出 {OUT_PATH}（{size:.1f} KB，共 {len(merged['facilities'])} 设施）")


if __name__ == "__main__":
    main()
