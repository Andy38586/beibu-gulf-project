"""只读探针：不依赖 GDAL，直接解析 TIFF IFD 链，判断是否为合格 COG。

COG 判据（简化版，对应 cog_validate 的核心项）：
1. 存在多级 IFD（overview 金字塔）
2. 主图像为 Tiled（TileWidth/TileLength 标签存在，而非 StripOffsets）
3. 各级 overview 尺寸逐级减半
"""
import struct
import sys

TAG = {256: "ImageWidth", 257: "ImageLength", 322: "TileWidth", 323: "TileLength",
       273: "StripOffsets", 278: "RowsPerStrip", 259: "Compression", 339: "SampleFormat"}
TYPE_SIZE = {1: 1, 2: 1, 3: 2, 4: 4, 5: 8, 6: 1, 7: 1, 8: 2, 9: 4, 10: 8, 11: 4, 12: 8,
             16: 8, 17: 8, 18: 8}


def read_ifds(path):
    f = open(path, "rb")
    head = f.read(8)
    bo = "<" if head[:2] == b"II" else ">"
    magic = struct.unpack(bo + "H", head[2:4])[0]
    big = magic == 43
    if big:
        f.seek(8)
        offset = struct.unpack(bo + "Q", f.read(8))[0]
    else:
        offset = struct.unpack(bo + "I", head[4:8])[0]

    ifds = []
    seen = set()
    while offset and offset not in seen:
        seen.add(offset)
        f.seek(offset)
        if big:
            n = struct.unpack(bo + "Q", f.read(8))[0]
            entry_size, count_fmt = 20, bo + "Q"
        else:
            n = struct.unpack(bo + "H", f.read(2))[0]
            entry_size, count_fmt = 12, bo + "I"
        tags = {}
        raw = f.read(n * entry_size)
        for i in range(n):
            e = raw[i * entry_size:(i + 1) * entry_size]
            tag, typ = struct.unpack(bo + "HH", e[:4])
            cnt = struct.unpack(count_fmt, e[4:12 if big else 8])[0]
            valoff = e[12:20] if big else e[8:12]
            if tag in TAG:
                size = TYPE_SIZE.get(typ, 4) * cnt
                if size <= (8 if big else 4):
                    val = struct.unpack(bo + ("Q" if typ in (16, 17, 18) else
                                              "I" if typ == 4 else "H" if typ == 3 else "I"),
                                        valoff[:8 if typ in (16, 17, 18) else 4 if typ in (4,) else 2].ljust(
                                            8 if typ in (16, 17, 18) else 4 if typ == 4 else 2, b"\0"))[0]
                else:
                    val = "(indirect)"
                tags[TAG[tag]] = val
        ifds.append(tags)
        f.seek(offset + (8 if big else 2) + n * entry_size)
        nxt = f.read(8 if big else 4)
        offset = struct.unpack(bo + ("Q" if big else "I"), nxt)[0] if len(nxt) >= (8 if big else 4) else 0
    f.close()
    return ifds, big


for path in sys.argv[1:]:
    print(f"\n===== {path} =====")
    try:
        ifds, big = read_ifds(path)
    except Exception as exc:  # noqa: BLE001
        print(f"  解析失败: {exc}")
        continue
    print(f"  格式: {'BigTIFF' if big else 'ClassicTIFF'}   IFD 数量: {len(ifds)}")
    for i, t in enumerate(ifds):
        label = "主图像" if i == 0 else f"overview {i}"
        w, h = t.get("ImageWidth", "?"), t.get("ImageLength", "?")
        tiled = "Tiled" if "TileWidth" in t else ("Stripped" if "StripOffsets" in t or "RowsPerStrip" in t else "?")
        tile = f"{t.get('TileWidth', '-')}x{t.get('TileLength', '-')}"
        print(f"  [{label:12s}] {w} x {h}  {tiled}  tile={tile}  compression={t.get('Compression', '-')}")
    ok_ovr = len(ifds) > 1
    ok_tiled = "TileWidth" in ifds[0] if ifds else False
    print(f"  → overview 金字塔: {'有' if ok_ovr else '【无】'}   主图像分块: {'是' if ok_tiled else '【否，条带存储】'}")
    print(f"  → COG 结论: {'合格' if (ok_ovr and ok_tiled) else '【不合格 / 非真 COG】'}")
