/**
 * pytest 接线（跨平台；工具缺失 fail，不 skip）。
 */
import { describe } from 'vitest'

import { definePytestCase } from '../../lib/__tests__/py-runner.mjs'

describe('地形 heightmap-1.0 · 编解码单源（python）', () => {
  definePytestCase('六站点无手抄 / lib 行为冻结（pytest 12 例）', [
    'tools/dem-pipeline/test_terrain_enc.py',
  ])
})
