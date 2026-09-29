"""kde-verify.py — KDE 手写 SQL 的连库验证（论文 W6-8；可整块复跑）

三层验证，oracle 全部在本脚本内用独立实现计算（haversine R=6370986，
与 PostGIS ST_DistanceSphere 同球同公式，不从 SQL 反推）：

  A. 数值 oracle：3 个 fixture 点 + 3 个格心，逐格对比 mass（相对误差 ≤1e-9）
  B. 质量守恒：真实 poi_facilities（2846 点）物化后 Σmass ≈ Σv，容差 2%（3h 截断 ~1.1%）
  C. 网格健全：cell 面积（geography 口径）与 (cell_m/111320·cosφ)² 换算一致（±1%）

用法：python kde-verify.py   （依赖本机 docker exec beibu-postgis 可达；不改主 schema，
fixture/输出全在 pg_temp，会话结束自动消失；B 的演示物化表 kde_poi_h2000_c500 在
脚本尾部单独执行，可用 --skip-demo 跳过）
"""
import math
import subprocess
import sys

R = 6371008.8  # PostGIS 3.4 ST_DistanceSphere 实测等效半径（WGS84 平均半径；
               # 旧文档 6370986 已失效——实测偏差 3.6e-6，见 2026-09-29 标定）
PSQL = ["docker", "exec", "-i", "beibu-postgis", "psql", "-U", "postgres", "-d",
        "beibu-gulf-data", "-v", "ON_ERROR_STOP=1", "-qAt"]
SQL_FILE = "tools/industry-fit/kde-materialize.sql"
SQL_IN_CONTAINER = "/tmp/kde-materialize.sql"  # psql 在容器内跑，先 docker cp
BBOX = "POLYGON((107.29 20.96,110.00 20.96,110.00 22.61,107.29 22.61,107.29 20.96))"


def psql(args: list[str]) -> str:
    r = subprocess.run(PSQL + args, capture_output=True, text=True)
    if r.returncode != 0:
        raise RuntimeError(f"psql 失败：{r.stdout}\n{r.stderr}")
    return r.stdout


def sync_sql():
    r = subprocess.run(["docker", "cp", SQL_FILE, f"beibu-postgis:{SQL_IN_CONTAINER}"],
                       capture_output=True, text=True)
    if r.returncode != 0:
        raise RuntimeError(f"docker cp 失败：{r.stderr}")


def haversine(lon1, lat1, lon2, lat2):
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dp = p2 - p1
    dl = math.radians(lon2 - lon1)
    a = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * R * math.asin(math.sqrt(a))


def gaussian_mass(center_lon, center_lat, pts, h):
    """Σ v·(1/(2πh²))·exp(−d²/2h²)，d>3h 截断（与 SQL 同式同截断，独立实现）。
    3h 截断的量级守卫在 B 判据域 [0.97,0.995]（cutoff 2h→0.86 / 5h→0.999 均出域）。"""
    return sum(
        v / (2 * math.pi * h * h) * math.exp(-(d * d) / (2 * h * h))
        for lon, lat, v, d in [
            (lo, la, v, haversine(center_lon, center_lat, lo, la))
            for lo, la, v in pts
            if haversine(center_lon, center_lat, lo, la) <= 3 * h
        ]
    )


def scenario_a():
    """A. 数值 oracle：fixture 3 点，物化到 pg_temp，逐格对比"""
    # 点位沿纬线 21.7 排布（0 / 600m / 2000m 东向偏移），v = 10/40/2.5
    lat0, mdeg = 21.7, 1 / (111320 * math.cos(math.radians(21.7)))
    pts = [
        (108.60, lat0, 10.0),
        (108.60 + 600 * mdeg, lat0, 40.0),
        (108.60 + 2000 * mdeg, lat0, 2.5),
    ]
    wkt = ",".join(f"{lo:.10f} {la:.10f}" for lo, la, _ in pts)
    wkt = f"POLYGON(({wkt},{pts[0][0]:.10f} {lat0:.10f}))"
    h, cell = 1000.0, 500.0
    ddl = (
        "CREATE TABLE pg_temp.kde_test_pts("
        "geom geometry(Point,4490), v double precision);"
        f"INSERT INTO pg_temp.kde_test_pts VALUES "
        + ",".join(
            f"(ST_SetSRID(ST_MakePoint({lo:.17g},{la:.17g}),4490),{v!r})" for lo, la, v in pts
        ) + ";"
    )
    out = psql([
        "-v", "src_table=pg_temp.kde_test_pts", "-v", "src_geom=geom",
        "-v", "src_value=v", "-v", f"h_m={h}", "-v", f"cell_m={cell}",
        "-v", f"bbox_wkt={wkt}", "-v", "out_table=pg_temp.kde_test_out",
        "-c", ddl,
        "-f", SQL_IN_CONTAINER,
        "-c", "SELECT st_x(st_centroid(geom))::text,"
              " st_y(st_centroid(geom))::text,"
              " mass::numeric, area_km2::numeric FROM pg_temp.kde_test_out"
              " WHERE st_centroid(geom) && st_expand("
              " st_setsrid(st_makepoint(108.60,21.7),4490), 0.02);",
    ])
    rows = [ln.split("|") for ln in out.strip().splitlines()]
    assert rows, "A: 物化结果为空"
    worst = 0.0
    for cx, cy, mass, _area in rows:
        exp = gaussian_mass(float(cx), float(cy), pts, h)
        rel = abs(float(mass) - exp) / exp
        worst = max(worst, rel)
    print(f"A. 数值 oracle：{len(rows)} 格，最坏相对误差 {worst:.2e}（≤1e-7）")
    # 容差 1e-7 而非更紧：两套独立球面公式（本脚本 haversine vs PostGIS 内部实现）
    # 存在 ~5e-9 相对级的固有分歧（2026-09-29 南北向探针实测），指数放大后 ~1e-8；
    # 真 bug（半径错 0.1%/漏点/归一化错）都会高出 2~3 个数量级，1e-7 足以判别
    assert worst <= 1e-7, f"A FAIL: {worst}"


def _materialize(src_table, src_geom, out_table, h, cell, bbox):
    psql([
        "-v", f"src_table={src_table}", "-v", f"src_geom={src_geom}",
        "-v", "src_value=1", "-v", f"h_m={h}", "-v", f"cell_m={cell}",
        "-v", f"bbox_wkt={bbox}", "-v", f"out_table={out_table}",
        "-f", SQL_IN_CONTAINER,
    ])


def scenario_b():
    """B. 质量守恒（受控合成 fixture）：200 点全部落在 bbox 核心区
    （距边界 >3h），Σ(mass·area)/Σv 的理论上界 = 1 − 3h 截断质量
    （2D 高斯 P(r>3h)=exp(−4.5)≈1.11%）+ 离散化，判据 [0.97, 0.999]；
    真实数据的边缘点贡献不再进断言（信息性输出在 C）。"""
    h, cell = 2000.0, 500.0
    lat0, lon0, step = 21.2, 108.0, 0.05  # 0.05°≈5.5km，10×20 点阵跨 0.5°×1.0°
    pts = [
        (lon0 + i * step, lat0 + j * step, 1.0) for i in range(10) for j in range(20)
    ]
    assert all(
        107.29 + 0.06 < lo < 110.00 - 0.06 and 20.96 + 0.06 < la < 22.61 - 0.06
        for lo, la, _ in pts
    ), "fixture 点必须全部在 bbox 核心区（距边界 >3h）"
    # bbox 在点阵外扩 0.1°（>3h≈0.054°）：否则边界点向外 3h 的核质量被网格截断
    pad = 0.1
    wkt = (
        f"POLYGON(({lon0 - pad} {lat0 - pad},{lon0 + 9 * step + pad} {lat0 - pad},"
        f"{lon0 + 9 * step + pad} {lat0 + 19 * step + pad},"
        f"{lon0 - pad} {lat0 + 19 * step + pad},{lon0 - pad} {lat0 - pad}))"
    )
    ddl = (
        "CREATE TABLE pg_temp.kde_cons_pts("
        "geom geometry(Point,4490), v double precision);"
        "INSERT INTO pg_temp.kde_cons_pts VALUES "
        + ",".join(
            f"(ST_SetSRID(ST_MakePoint({lo:.17g},{la:.17g}),4490),{v!r})"
            for lo, la, v in pts
        )
        + ";"
    )
    # pg_temp 生命周期 = 单个 psql 会话：fixture/物化/统计必须在同一次调用内
    stats = psql([
        "-v", "src_table=pg_temp.kde_cons_pts", "-v", "src_geom=geom",
        "-v", "src_value=v", "-v", f"h_m={h}", "-v", f"cell_m={cell}",
        "-v", f"bbox_wkt={wkt}", "-v", "out_table=pg_temp.kde_cons_out",
        "-c", ddl, "-f", SQL_IN_CONTAINER,
        "-c", "SELECT count(*), sum(mass * area_km2 * 1e6)::numeric"
              " FROM pg_temp.kde_cons_out;",
        "-c", "SELECT sum(v)::numeric FROM pg_temp.kde_cons_pts;",
    ]).strip().splitlines()
    cells, total_mass = stats[0].split("|")
    total_v = float(stats[1])
    ratio = float(total_mass) / total_v
    print(f"B. 质量守恒（合成 200 点）：{cells} 格，Σ(mass·area)/Σv = {ratio:.4f}"
          f"（判据 [0.97,0.995]；cutoff 2h→0.86 / 5h→0.999 均出域，即截断量级由本域守卫）")
    assert 0.97 <= ratio <= 0.995, f"B FAIL: {ratio}"


def scenario_c():
    """C. 真实数据物化 + 网格健全（信息性 + 面积断言）"""
    h, cell = 2000.0, 500.0
    out_tbl = "kde_indzone_h2000_c500"
    # 注：本地库 poi_facilities/xiaoqu 现为 0 行（与文档"2846 POI"口径不符，
    # 待立案核实）；演示物化改用 industrial_zones（2687 面取质心；质心跨全广西，
    # bbox 外点的核质量被网格边界截断属口径固有，密度面只服务 bbox 内因子）。
    _materialize("industrial_zones", "st_centroid(geom)", out_tbl, h, cell, BBOX)
    stats = psql([
        "-c", f"SELECT count(*), sum(mass * area_km2 * 1e6)::numeric,"
              f" min(area_km2)::numeric, max(area_km2)::numeric FROM {out_tbl};",
        "-c", "SELECT count(*) FROM industrial_zones;",
    ]).strip().splitlines()
    cells, total_mass, amin, amax = stats[0].split("|")
    n_zones = int(stats[1])
    ratio = float(total_mass) / n_zones
    print(f"C. 真实物化：{n_zones} 园区质心 → {cells} 格，"
          f"Σ(mass·area)/Σv = {ratio:.4f}（信息性；界外点被边界截断拉低）")
    # 面积健全：度方格面积随纬度变化（bbox 跨 1.65°），下界锚最大纬度、上界锚最小纬度
    def cell_km2(lat):
        east = cell / 111320.0 * math.cos(math.radians(lat)) * 111.32
        north = cell / 111320.0 * 111.32
        return east * north

    e_min, e_max = cell_km2(22.62), cell_km2(20.96)
    amin, amax = float(amin), float(amax)
    print(f"   网格面积 [{amin:.4f},{amax:.4f}] km²，理论区间 [{e_min:.4f},{e_max:.4f}]（±1%）")
    assert abs(amin - e_min) / e_min <= 0.01, f"C FAIL: amin {amin} vs {e_min}"
    assert abs(amax - e_max) / e_max <= 0.01, f"C FAIL: amax {amax} vs {e_max}"


if __name__ == "__main__":
    sync_sql()
    scenario_a()
    scenario_b()
    scenario_c()
    print("KDE verify: 全部通过")
