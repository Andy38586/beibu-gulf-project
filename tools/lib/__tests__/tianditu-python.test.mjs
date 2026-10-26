/**
 * pytest 接线（跨平台；工具缺失 fail，不 skip）。
 */
import { describe } from 'vitest'

import { definePytestCase } from './py-runner.mjs'

describe('天地图取图三件套单源 · Python 侧（python）', () => {
  definePytestCase('两站点无手抄 / 权威源行为冻结（pytest 4 例）', ['tools/lib/test_tianditu.py'])
})
