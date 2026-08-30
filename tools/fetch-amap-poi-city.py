#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""
按「钦州市区口径」批量采集三市市区选址 POI（钦州 / 北海 / 防城港）。

═══ 口径对齐（重要）═══
既有 backend/data/site-selection/qz_*.json 经核查全部只含【钦南区 + 钦北区】，
即「只抓市辖区、不含下辖县/县级市」。本脚本沿用同一口径：

    钦州市  : 钦南区 450702 / 钦北区 450703
    北海市  : 海城区 450502 / 银海区 450503 / 铁山港区 450512
    防城港市: 港口区 450602 / 防城区 450603

与既有数据保持同构：输出字段仅 id / name / lng / lat / district，
不新增字段，避免破坏 frontend 与 facilitiesRepository 的既有契约。

═══ 为什么用「矩形网格」而不是 keywords+city 分页 ═══
高德 v3/place/text 单关键词有分页深度限制：实测 海城区+"公交站"
count=281，逐页翻到第 10 页即返回空，只拿到 225 条——静默丢数据。
改用 v3/place/polygon + 自适应四分：某格 count 超出实收数就四等分递归下钻，
直到每格都能取满。矩形是 bbox 会覆盖邻区，抓回后按 adname 严格过滤。

═══ 类型白名单（对齐既有钦州数据）═══
高德关键词检索会混入同名异类（搜"小学"进"中学"、搜"商场"进"便利店"），
故按高德 type 末级分类精确准入；个别分类需名称二次确认（CONDITIONAL_LEAF）。
实测：北海"超市"关键词下 便民商店/便利店 占 559/825，而既有钦州 mall 数据
0 条便利店 —— 必须剔，否则三城选址结果不可比。

产出
----
    cleaned : backend/data/site-selection/<prefix>_<type>.json
    cache   : tools/.poi_cache/grid_*.json               (原始响应，复跑不重抓)
    rejects : tools/.poi_cache/_rejected_<city>_<type>.json  (被剔除点，供复核)

用法
----
    python tools/fetch-amap-poi-city.py                  # 抓北海 + 防城港
    python tools/fetch-amap-poi-city.py --cities bh fcg qz
    python tools/fetch-amap-poi-city.py --force          # 清空网格缓存重抓
"""

import argparse
import json
import os
import time

import requests

# ============================== 配置 ==============================

# 高德 Web 服务 Key：从 tools/.amap_key 读取，与既有采集脚本 fetch-amap-poi.mjs 同一约定。
# 禁止硬编码进仓库：CI 的 gitleaks 默认规则（generic-api-key）会拦截，泄露后须轮换。
_AMAP_KEY_FILE = os.path.join(os.path.dirname(os.path.abspath(__file__)), ".amap_key")
try:
    with open(_AMAP_KEY_FILE, encoding="utf-8") as _f:
        AMAP_KEY = _f.read().strip()
except FileNotFoundError:
    raise SystemExit(
        f"缺少高德 Key 文件：{_AMAP_KEY_FILE}\n"
        "请创建该文件，内容只放 key 一行（已被 gitignore，勿提交）"
    )

POLY_URL = "https://restapi.amap.com/v3/place/polygon"

# (adcode, 区名, bbox) —— bbox 取自高德 v3/config/district 行政区划边界外接矩形
DISTRICTS = {
    "qz": [
        ("450702", "钦南区", (108.4091, 21.5755, 109.1541, 22.1292)),
        ("450703", "钦北区", (108.1837, 21.9104, 108.9463, 22.4633)),
    ],
    "bh": [
        ("450502", "海城区", (109.0412, 20.8984, 109.2228, 21.6016)),  # 含涠洲岛
        ("450503", "银海区", (109.0381, 21.3859, 109.4010, 21.6867)),
        ("450512", "铁山港区", (109.3301, 21.4357, 109.6075, 21.6740)),
    ],
    "fcg": [
        ("450602", "港口区", (108.3289, 21.5331, 108.5970, 21.7464)),
        ("450603", "防城区", (107.4815, 21.4893, 108.5293, 21.9944)),
    ],
}

# 设施类型 → (检索关键词列表, type 末级白名单, 名称兜底词列表)
CATEGORY_RULES = {
    "hospital": (
        ["医院"],
        {"综合医院", "三级甲等医院", "骨科医院", "专科医院", "卫生院", "诊所",
         "医疗保健服务场所", "急救中心", "疾病预防机构"},
        ["医院"],
    ),
    "primary_school": (["小学"], {"小学"}, ["小学"]),
    "middle_school": (["中学"], {"中学"}, ["中学", "实验学校", "初中部", "高中"]),
    "park": (["公园"], {"公园", "公园广场", "风景名胜", "风景区"}, ["公园"]),
    "bus_station": (["公交站"], {"公交车站相关"}, ["公交站"]),
    "mall": (
        ["商场", "超市"],
        {"普通商场", "商场", "购物中心", "超市", "综合市场", "农副产品市场",
         "果品市场", "水产海鲜市场", "蔬菜市场"},
        [],  # 无统一名称主词，不做名称兜底
    ),
    "xiaoqu": (["小区"], {"住宅小区", "住宅区", "别墅"}, ["小区"]),
}

# 边界分类：type 末级命中 left 时，还需名称含 must 之一 且 不含 never 之一才保留
CONDITIONAL_LEAF = {
    # "商务住宅相关" 混杂公寓/公租房/村庄（实测含"铁山港区南康镇塘西村"）
    "xiaoqu": ({"商务住宅相关"},
               ("小区", "公寓", "花园", "家园", "公馆", "府", "湾", "城", "邸", "苑"),
               ("村", "工业区", "公共租赁", "回建区", "生活区")),
}

# 类型专属名称黑名单：即便 type 白名单命中也要剔（实测"住宅小区"里混有
# "中国能源建设集团…生活区"这类单位生活区，不是可选址的居住小区）
NEVER_WORDS = {
    "xiaoqu": ["村", "工业区", "公共租赁", "回建区", "生活区", "公司", "集团", "厂区", "宿舍", "安置区"],
}

# 名称黑名单：剔除 POI 内部子设施/出入口（沿用 gis_work/clean.py 思路）
BAD_WORDS = [
    "东门", "西门", "南门", "北门", "正门", "侧门", "后门", "停车场", "停车区",
    "食堂", "宿舍", "体育馆", "运动场", "后勤", "行政楼", "快递", "教师公寓",
    "学生公寓", "公厕", "厕所", "警务室", "门卫", "保安室",
]

# 北部湾业务区域（与 backend/services/siteAnalysisService.js 一致）
BBOX = {"lng_min": 105, "lng_max": 115, "lat_min": 18, "lat_max": 25}

POLY_PAGE_SIZE = 20     # place/polygon 单页上限 20
POLY_MAX_PAGE = 25      # 单格最多 500 条
MAX_DEPTH = 3           # 四分递归深度上限
SLEEP = 0.35            # 限速：高德 key 约 3 QPS，0.35s 留余量
RETRY = 4               # 失败重试次数（指数退避）

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CACHE_DIR = os.path.join(ROOT, "tools", ".poi_cache")
OUT_DIR = os.path.join(ROOT, "backend", "data", "site-selection")


# ============================== 抓取 ==============================

def _get(url, params, session):
    """带指数退避的 GET；返回 dict 或 None。限流码退避重试，其余错误为终态。"""
    for attempt in range(RETRY):
        try:
            resp = session.get(url, params=params, timeout=12)
            data = resp.json()
        except Exception as e:  # noqa: BLE001 - 采集脚本，异常需重试而非崩溃
            wait = SLEEP * (2 ** attempt)
            print(f"      [重试 {attempt + 1}/{RETRY}] 请求异常 {e}，{wait:.1f}s 后重试")
            time.sleep(wait)
            continue

        code = str(data.get("infocode", ""))
        if data.get("status") == "1":
            return data
        if code in ("10021", "10029", "209429", "10045"):
            wait = SLEEP * (2 ** attempt)
            print(f"      [重试 {attempt + 1}/{RETRY}] 限流 infocode={code}，{wait:.1f}s 后重试")
            time.sleep(wait)
            continue
        print(f"      [!] 接口错误 infocode={code} info={data.get('info')}")
        return None
    return None


def split_rect(rect, rows=2, cols=2):
    """矩形等分 → [(lng1,lat1,lng2,lat2), ...]"""
    lng1, lat1, lng2, lat2 = rect
    out = []
    for r in range(rows):
        for c in range(cols):
            a1 = lat1 + (lat2 - lat1) * r / rows
            a2 = lat1 + (lat2 - lat1) * (r + 1) / rows
            o1 = lng1 + (lng2 - lng1) * c / cols
            o2 = lng1 + (lng2 - lng1) * (c + 1) / cols
            out.append((o1, a1, o2, a2))
    return out


def fetch_polygon(keyword, rect, session, depth=0, collected=None):
    """矩形检索 + 自适应四分。返回 (collected, 该格是否仍有遗漏)"""
    if collected is None:
        collected = []

    polygon = f"{rect[0]:.6f},{rect[1]:.6f}|{rect[2]:.6f},{rect[3]:.6f}"
    safe = polygon.replace("|", "_").replace(",", "-").replace(".", "p")
    cache_file = os.path.join(CACHE_DIR, f"grid_{keyword}_{safe}.json")

    if os.path.exists(cache_file):
        with open(cache_file, "r", encoding="utf-8") as f:
            collected.extend(json.load(f))
        return collected, False

    pois, reported = [], None
    for page in range(1, POLY_MAX_PAGE + 1):
        data = _get(POLY_URL, {
            "key": AMAP_KEY,
            "keywords": keyword,
            "polygon": polygon,
            "offset": str(POLY_PAGE_SIZE),
            "page": str(page),
            "extensions": "base",
        }, session)
        if data is None:
            break
        if reported is None:
            try:
                reported = int(data.get("count", 0))
            except (TypeError, ValueError):
                reported = 0
        batch = data.get("pois", [])
        if not batch:
            break
        for p in batch:
            loc = p.get("location", "")
            if "," not in loc:
                continue
            lng_s, lat_s = loc.split(",", 1)
            try:
                lng, lat = float(lng_s), float(lat_s)
            except ValueError:
                continue
            pois.append({
                "id": p.get("id"), "name": p.get("name"),
                "lng": lng, "lat": lat,
                "district": p.get("adname", ""),
                "type": p.get("type", ""), "typecode": p.get("typecode", ""),
                "address": p.get("address", ""), "_kw": keyword,
            })
        if len(batch) < POLY_PAGE_SIZE:
            break
        time.sleep(SLEEP)

    # 该格仍取不满 → 继续四分下钻
    shortfall = reported is not None and (reported - len(pois)) > POLY_PAGE_SIZE
    if shortfall and depth < MAX_DEPTH:
        for sub in split_rect(rect):
            fetch_polygon(keyword, sub, session, depth + 1, collected)
        return collected, False

    with open(cache_file, "w", encoding="utf-8") as f:
        json.dump(pois, f, ensure_ascii=False, indent=1)
    collected.extend(pois)
    return collected, shortfall


# ============================== 清洗 ==============================

def leaf_type(ptype):
    return (ptype or "").split(";")[-1]


def clean(pois, type_key, target_districts):
    """行政区过滤 → 坐标校验 → 类型白名单（含条件保留/名称兜底）→ 名称黑名单 → 去重"""
    leaf_ok, name_fallback = CATEGORY_RULES[type_key][1], CATEGORY_RULES[type_key][2]
    cond = CONDITIONAL_LEAF.get(type_key)
    kept, rejected = [], []

    for p in pois:
        name = p.get("name") or ""
        lt = leaf_type(p.get("type"))
        reason = None

        # 1) 行政区：只要目标市辖区（矩形 bbox 会溢出到邻区/下辖县）
        if p.get("district") not in target_districts:
            reason = f"非目标市辖区({p.get('district')})"
        # 2) 坐标有效性与业务区域
        elif not isinstance(p.get("lng"), float) or not isinstance(p.get("lat"), float):
            reason = "坐标缺失"
        elif p["lng"] == 0 and p["lat"] == 0:
            reason = "零坐标"
        elif not (BBOX["lng_min"] <= p["lng"] <= BBOX["lng_max"] and BBOX["lat_min"] <= p["lat"] <= BBOX["lat_max"]):
            reason = "超出北部湾范围"
        else:
            # 3) 类型准入：白名单 → 条件保留 → 名称兜底
            if lt in leaf_ok:
                pass
            elif cond and lt in cond[0]:
                must, never = cond[1], cond[2]
                if not any(m in name for m in must) or any(n in name for n in never):
                    reason = f"边界类型未过名称校验({lt})"
            elif name_fallback and any(m in name for m in name_fallback):
                pass
            else:
                reason = f"类型不符({lt})"

        # 4) 名称黑名单（通用 + 类型专属）
        if reason is None:
            hit = next((w for w in BAD_WORDS if w in name), None)
            if hit:
                reason = f"名称黑名单({hit})"
            else:
                hit = next((w for w in NEVER_WORDS.get(type_key, []) if w in name), None)
                if hit:
                    reason = f"类型专属黑名单({hit})"

        if reason:
            rejected.append({"id": p["id"], "name": name, "lng": p.get("lng"),
                             "lat": p.get("lat"), "district": p.get("district"),
                             "type": p.get("type"), "_reason": reason})
            continue
        kept.append(p)

    # 5) 去重：先按 id，再按 名称+坐标（多关键词合并如 商场/超市 会撞）
    seen_id, seen_nc, out = set(), set(), []
    for p in kept:
        if p["id"] in seen_id:
            continue
        nc = (p["name"], round(p["lng"], 6), round(p["lat"], 6))
        if nc in seen_nc:
            continue
        seen_id.add(p["id"])
        seen_nc.add(nc)
        out.append({"id": p["id"], "name": p["name"], "lng": p["lng"],
                    "lat": p["lat"], "district": p["district"]})
    return out, rejected


# ============================== 主流程 ==============================

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--cities", nargs="+", default=["bh", "fcg"], choices=list(DISTRICTS))
    ap.add_argument("--types", nargs="+", default=list(CATEGORY_RULES), choices=list(CATEGORY_RULES))
    ap.add_argument("--force", action="store_true", help="清空网格抓取缓存后重抓")
    args = ap.parse_args()

    os.makedirs(OUT_DIR, exist_ok=True)
    os.makedirs(CACHE_DIR, exist_ok=True)

    if args.force:
        n = 0
        for f in os.listdir(CACHE_DIR):
            if f.startswith("grid_"):
                os.remove(os.path.join(CACHE_DIR, f))
                n += 1
        print(f"已清空网格抓取缓存 {n} 个文件")

    session = requests.Session()
    summary = {}

    for city in args.cities:
        districts = DISTRICTS[city]
        names = [d[1] for d in districts]
        print(f"\n{'=' * 66}\n城市 {city}：{' / '.join(names)}\n{'=' * 66}")
        summary[city] = {}

        for type_key in args.types:
            keywords = CATEGORY_RULES[type_key][0]
            raw_all = []
            for adcode, adname, bbox in districts:
                print(f"  [{type_key}] {adname}")
                for kw in keywords:
                    pois, _ = fetch_polygon(kw, bbox, session, depth=0)
                    # 矩形溢出：按 adname 精确保留本区
                    raw_all.extend([p for p in pois if p.get("district") == adname])
                print(f"      本区累计 {len(raw_all)} 条")

            cleaned, rejected = clean(raw_all, type_key, set(names))

            out_path = os.path.join(OUT_DIR, f"{city}_{type_key}.json")
            with open(out_path, "w", encoding="utf-8") as f:
                json.dump(cleaned, f, ensure_ascii=False, indent=2)

            with open(os.path.join(CACHE_DIR, f"_rejected_{city}_{type_key}.json"), "w", encoding="utf-8") as f:
                json.dump(rejected, f, ensure_ascii=False, indent=1)

            by_dist = {}
            for p in cleaned:
                by_dist[p["district"]] = by_dist.get(p["district"], 0) + 1
            summary[city][type_key] = {"raw": len(raw_all), "kept": len(cleaned),
                                       "rejected": len(rejected), "by_district": by_dist}
            print(f"    -> {city}_{type_key}.json  区内 {len(raw_all)} / 保留 {len(cleaned)} "
                  f"/ 剔除 {len(rejected)}  {by_dist}")

    print(f"\n{'=' * 66}\n汇总\n{'=' * 66}")
    for city, types in summary.items():
        total = sum(v["kept"] for v in types.values())
        print(f"\n{city}: 合计 {total} 条")
        for k, v in types.items():
            print(f"  {k:16s} {v['kept']:5d}  (区内 {v['raw']}, 剔除 {v['rejected']}) {v['by_district']}")

    with open(os.path.join(CACHE_DIR, "_summary.json"), "w", encoding="utf-8") as f:
        json.dump(summary, f, ensure_ascii=False, indent=2)


if __name__ == "__main__":
    main()
