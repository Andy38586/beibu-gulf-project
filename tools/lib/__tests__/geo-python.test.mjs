/**
 * pytest 接线（跨平台；工具缺失 fail，不 skip）。
 */
import { describe } from 'vitest'

import { definePytestCase } from './py-runner.mjs'

describe('地理底座单源 · Python 侧（python）', () => {
  definePytestCase('12 站点无手抄 / 权威源行为冻结（pytest 5 例）', ['tools/lib/test_geo.py'])
})
