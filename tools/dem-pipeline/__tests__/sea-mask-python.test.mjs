/**
 * pytest 接线（跨平台；工具缺失 fail，不 skip）。
 */
import { describe } from 'vitest'

import { definePytestCase } from '../../lib/__tests__/py-runner.mjs'

describe('海陆 DEM · 海掩膜三条判据（python）', () => {
  definePytestCase('海岸线 / 测深确认 / 源 DEM 判陆（pytest 5 例）', [
    'tools/dem-pipeline/test_sea_mask.py',
  ])
})
