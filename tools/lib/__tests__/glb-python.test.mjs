/**
 * pytest 接线（跨平台；工具缺失 fail，不 skip）。
 */
import { describe } from 'vitest'

import { definePytestCase } from './py-runner.mjs'

describe('GLB 读链单源 · Python 侧（python）', () => {
  definePytestCase('12 站点无手抄 / 权威源真语料取数（pytest 5 例）', ['tools/lib/test_glb.py'])
})
