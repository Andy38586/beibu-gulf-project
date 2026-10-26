/**
 * pytest 接线（跨平台；工具缺失 fail，不 skip）。
 */
import { describe } from 'vitest'

import { definePytestCase } from '../../lib/__tests__/py-runner.mjs'

describe('DEM 瓦片/双线性采样单源（python）', () => {
  definePytestCase('legacy 对拍：窗口求交 / nodata / NaN 缺角 / 越界（pytest）', [
    'tools/dem-pipeline/test_tile_sample.py',
    'tools/dem-pipeline/test_bilinear.py',
  ])
})
