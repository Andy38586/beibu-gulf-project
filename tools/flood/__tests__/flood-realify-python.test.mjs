/**
 * pytest 接线（跨平台；工具缺失 fail，不 skip）。
 */
import { describe } from 'vitest'

import { definePytestCase } from '../../lib/__tests__/py-runner.mjs'

describe('flood 生成侧 · 溯源与废弃件收口（python）', () => {
  definePytestCase('DEM md5 接线 / 不写废弃件 / 无陆地写 null（pytest 2 例）', [
    'tools/flood/test_flood_realify.py',
  ])
})
