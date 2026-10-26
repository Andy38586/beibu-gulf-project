/**
 * pytest 接线（跨平台；工具缺失 fail，不 skip）。
 */
import { describe } from 'vitest'

import { definePytestCase } from '../../lib/__tests__/py-runner.mjs'

describe('flood engine · 永久水体种子（python）', () => {
  definePytestCase('陆地 DEM 行为不变 / 含测深 DEM 连通正确', [
    'tools/flood/engine/test_flood_engine.py',
  ])
})
