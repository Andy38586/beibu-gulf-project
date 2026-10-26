/**
 * 07b 基准判别 pytest 接线（跨平台；工具缺失 fail，不 skip）。
 */
import { describe } from 'vitest'

import { definePytestCase } from './py-runner.mjs'

describe('地形链 · 07b 基准判别（python）', () => {
  definePytestCase('水位换算跟随 DEM 基准 / fail-loud / 缺省解析（pytest 6 例）', [
    'test_post_surface_datum.py',
  ])
})
