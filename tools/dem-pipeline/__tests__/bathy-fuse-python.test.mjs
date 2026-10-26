/**
 * 14-bathy-fuse 的 pytest 接线（跨平台；工具缺失 fail，不 skip）。
 */
import { describe } from 'vitest'

import { definePytestCase } from './py-runner.mjs'

describe('近岸测深 · 融合与验收入口（python）', () => {
  definePytestCase('红线拒收 / 基准换算 / 融合面（pytest 7 例）', ['test_bathy_fuse.py'])
})
