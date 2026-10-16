"""GLB（binary glTF 2.0）读链 —— tools 侧 Python 唯一来源。

与 JS 侧 `tools/lib/glb.mjs` 同口径：只切 JSON 块与 BIN 块，不校验 magic / version。

- `read_glb(path)` → `(json, bin)`：`json` 是 dict，`bin` 是 `bytes`（不可变）；
  要就地改 BIN 的站点自己 `bytearray(bin)`（现只有 preview-roads-vertfollow.py 一处）。
- `accessor(js, bin_, i)` → `(count, 分量)` 的 `numpy.ndarray`，dtype = componentType 原生宽度
  （5126→float32、5123→uint16 …），带 `bufferView.byteStride` 时按步长取（as_strided）；
  要 float64 运算的站点自行 `.astype(np.float64)`。

本件与消费站点的第二份手抄由 `tools/lib/test_glb.py` 的扫描型判据钉住；
站点侧只准 `from glb import accessor, read_glb`，不得再写 chunk 类型字面量。
"""

import json
import struct

import numpy as np

#: GLB chunk 类型（小端 uint32）
JSON_CHUNK = 0x4E4F534A
BIN_CHUNK = 0x004E4942

#: accessor.componentType → (struct 格式字符, 元素字节宽)；只列规范允许的六种
CS = {5120: ('b', 1), 5121: ('B', 1), 5122: ('h', 2), 5123: ('H', 2), 5125: ('I', 4), 5126: ('f', 4)}

#: accessor.type → 分量数
NC = {'SCALAR': 1, 'VEC2': 2, 'VEC3': 3, 'VEC4': 4}


def read_glb(path):
    """切出 GLB 的 JSON 块与 BIN 块。"""
    b = open(path, 'rb').read()
    off, js, bin_ = 12, None, None
    while off + 8 <= len(b):
        ln, ty = struct.unpack_from('<II', b, off)
        d = b[off + 8:off + 8 + ln]
        if ty == JSON_CHUNK:
            js = json.loads(d)
        elif ty == BIN_CHUNK:
            bin_ = d
        off += 8 + ln + ((4 - ln % 4) % 4)
    return js, bin_


def accessor(js, bin_, i):
    """按 accessor 索引取数 → (count, 分量) 的 ndarray，dtype 为 componentType 原生宽度。"""
    a = js['accessors'][i]
    bv = js['bufferViews'][a['bufferView']]
    fmt, sz = CS[a['componentType']]
    nc = NC[a['type']]
    st = bv.get('byteStride') or sz * nc
    base = bv.get('byteOffset', 0) + a.get('byteOffset', 0)
    arr = np.frombuffer(bin_, dtype=np.dtype('<' + fmt), count=a['count'] * nc, offset=base)
    if st == sz * nc:
        return arr.reshape(a['count'], nc)
    return np.array(np.lib.stride_tricks.as_strided(arr, shape=(a['count'], nc), strides=(st, sz)))
