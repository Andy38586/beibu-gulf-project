"""flood_realify.py 的生成侧契约断言（pytest）。

钉三件事（都是 2026-10-04 收口的承重点）：
  ① 不再写已废弃件 floodArea.json，也不再写 terrainProfile.json（唯一写入方是
     rederive-terrain-profiles.py）——把写入步加回来，test_no_retired_outputs_* 必红；
  ② 产物自述必须带**本次 DEM** 的 md5（04-B10 溯源）——把 demMd5 换成硬编码，
     test_dem_provenance_* 必红；
  ③ riskLevel 由权威分段派生、逐档不同码——把 risk_label 换成固定「中风险」，
     test_risk_labels_* 必红。

全部在临时目录里用合成 DEM/夹具跑，不碰 backend/data。
运行：backend/algorithm-service/.venv/Scripts/python.exe -m pytest tools/flood/test_flood_realify.py -q
"""

from __future__ import annotations

import gzip
import hashlib
import json
import sys
from pathlib import Path

import numpy as np
import pytest
import rasterio
from rasterio.transform import from_origin

sys.path.insert(0, str(Path(__file__).resolve().parent))

import flood_realify as fr  # noqa: E402

NOD = 32767.0
W = H = 240
TRANSFORM = from_origin(600000.0, 2400000.0, 30.0, 30.0)


def _write_dem(path: Path) -> str:
    """合成地表：西半 10m 陆地、中缝一列 1m 低地、东半 -6m 水深（海陆一体形态）。"""
    dem = np.full((H, W), 10, dtype=np.int16)
    dem[:, W // 2 :] = -6
    dem[:, W // 2 - 1 : W // 2] = 1  # 岸线低地
    with rasterio.open(
        path,
        "w",
        driver="GTiff",
        height=H,
        width=W,
        count=1,
        dtype="int16",
        crs="EPSG:32648",
        transform=TRANSFORM,
        nodata=NOD,
    ) as dst:
        dst.write(dem, 1)
    return hashlib.md5(path.read_bytes()).hexdigest()


@pytest.fixture()
def sandbox(tmp_path, monkeypatch):
    """把 flood_realify 的落盘路径整体重定向到 tmp_path，并铺好夹具。"""
    dem = tmp_path / "landsea_utm48n.tif"
    md5 = _write_dem(dem)

    facility = tmp_path / "facilityPoints.json"
    facility.write_text(
        json.dumps(
            {
                "metadata": {"updatedAt": "1970-01-01"},
                "facilities": [
                    {
                        "id": "T-1",
                        "name": "夹具设施",
                        "type": "泊位码头",
                        "port": "钦州港",
                        "lng": 0.0,
                        "lat": 0.0,
                        "value": 100,
                        "damageRate": 0.5,
                    },
                    {
                        "id": "T-2",
                        "name": "岸线边夹具设施",
                        "type": "泊位码头",
                        "port": "钦州港",
                        "lng": 0.0,
                        "lat": 0.0,
                        "value": 100,
                        "damageRate": 0.5,
                    },
                    {
                        "id": "T-3",
                        "name": "离岸夹具设施（窗口全水）",
                        "type": "泊位码头",
                        "port": "钦州港",
                        "lng": 0.0,
                        "lat": 0.0,
                        "value": 100,
                        "damageRate": 0.5,
                    },
                ],
            },
            ensure_ascii=False,
        ),
        encoding="utf-8",
    )
    water = tmp_path / "waterLevel.json"
    water.write_text(
        json.dumps(
            {
                "metadata": {"source": "simulated"},
                "verticalDatum": "理论深度基准面",
                "baseLevels": [{"id": "msl", "height": 2.5}],
            },
            ensure_ascii=False,
        ),
        encoding="utf-8",
    )
    levels = tmp_path / "flood_levels.json.gz"
    with gzip.open(levels, "wt", encoding="utf-8") as f:
        json.dump({f"{i / 10:.1f}": {"featureCount": 0, "floodedKm2": 0.0, "features": []}
                   for i in range(251)}, f)
    terrain = tmp_path / "terrainProfile.json"
    terrain.write_text(json.dumps({"metadata": {"t": 1}, "profiles": []}), encoding="utf-8")

    # 设施经纬度：取 DEM 内某点（用 DEM CRS→4326 反算，保证落在西半陆地上）
    x, y = TRANSFORM * (40 + 0.5, 40 + 0.5)
    from rasterio.warp import transform as warp

    lon, lat = warp("EPSG:32648", "EPSG:4326", [x], [y])
    fac = json.loads(facility.read_text(encoding="utf-8"))
    fac["facilities"][0]["lng"], fac["facilities"][0]["lat"] = lon[0], lat[0]
    # T-2 落在岸线低地那一列：5x5 窗口同时含 10/1/-6，取陆地最小应为 1（不是海底 -6）
    x2, y2 = TRANSFORM * (W // 2 - 1 + 0.5, 40 + 0.5)
    lon2, lat2 = warp("EPSG:32648", "EPSG:4326", [x2], [y2])
    fac["facilities"][1]["lng"], fac["facilities"][1]["lat"] = lon2[0], lat2[0]
    # T-3 落在离岸 ~900m 处：±600m 内无陆地 → 高程必须写 null（不编水深）
    x3, y3 = TRANSFORM * (W // 2 + 30 + 0.5, 40 + 0.5)
    lon3, lat3 = warp("EPSG:32648", "EPSG:4326", [x3], [y3])
    fac["facilities"][2]["lng"], fac["facilities"][2]["lat"] = lon3[0], lat3[0]
    facility.write_text(json.dumps(fac, ensure_ascii=False), encoding="utf-8")

    monkeypatch.setattr(fr, "FLOOD_DIR", tmp_path)
    monkeypatch.setattr(fr, "STATS_PATH", tmp_path / "floodStatistics.json")
    monkeypatch.setattr(fr, "FACILITY", facility)
    monkeypatch.setattr(fr, "WL_PATH", water)
    monkeypatch.setattr(fr, "LEVELS_GZ", levels)
    monkeypatch.setattr(fr, "DEM_SOURCE", dem)
    monkeypatch.setattr(fr, "DEM_LABEL", f"{dem.name}（夹具地表）")
    monkeypatch.setattr(fr, "DEM_MD5", md5)
    return {"dir": tmp_path, "md5": md5, "facility": facility, "terrain": terrain}


def test_no_retired_outputs_and_dem_provenance(sandbox):
    before = sandbox["terrain"].read_bytes()
    fr.main()

    # ① 废弃件不许复活、不许被改写
    assert not (sandbox["dir"] / "floodArea.json").exists(), "floodArea.json 已于 z154 下线"
    assert sandbox["terrain"].read_bytes() == before, "terrainProfile 唯一写入方是 rederive 脚本"

    # ② 溯源：产物自述里的 md5 必须等于本次输入 DEM 的 md5
    stats = json.loads((sandbox["dir"] / "floodStatistics.json").read_text(encoding="utf-8"))
    assert stats["metadata"]["demMd5"] == sandbox["md5"]
    fac = json.loads(sandbox["facility"].read_text(encoding="utf-8"))
    assert fac["metadata"]["demMd5"] == sandbox["md5"]

    # ③ 设施高程确实来自这份 DEM（西半 10m 陆地）
    by_id = {f["id"]: f for f in fac["facilities"]}
    assert by_id["T-1"]["elevation"] == 10.0
    # ④ 5x5 窗口只取陆地最小值：岸线那列窗口含 10/1/-6，取 1 而不是海底 -6
    assert by_id["T-2"]["elevation"] == 1.0
    # ⑤ 窗口外扩后仍无正高程（ASTER 港区填海面读 0）→ 取填海面 0m，而不是水深 -6m
    assert by_id["T-3"]["elevation"] == 0.0
    assert fac["metadata"]["elevationFlatZero"]["ids"] == ["T-3"]
    assert all(f["elevation"] >= 0 for f in fac["facilities"]), "设施高程不得为水深负值"


def test_risk_labels_derived_from_authoritative_bands(sandbox):
    fr.main()
    stats = json.loads((sandbox["dir"] / "floodStatistics.json").read_text(encoding="utf-8"))
    got = {row["waterLevel"]: row["riskLevelCode"] for row in stats["statistics"]}
    want = {lv: fr.RISK_CODE[fr.risk_label(lv)] for lv in fr.LEVELS}
    assert got == want
    assert len(set(got.values())) > 1, "6 档全写同一个码即 d057 复发"
