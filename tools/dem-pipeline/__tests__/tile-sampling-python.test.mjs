/**
 * F74/F75 共享采样件的 pytest 接线（跨平台；工具缺失 fail，不 skip）。
 */
import { describe } from 'vitest'

import { definePytestCase } from './py-runner.mjs'

describe('DEM 瓦片/双线性采样单源（python）', () => {
  definePytestCase('legacy 对拍：窗口求交 / nodata / NaN 缺角 / 越界（pytest）', [
    'test_tile_sample.py',
    'test_bilinear.py',
  ])
})
