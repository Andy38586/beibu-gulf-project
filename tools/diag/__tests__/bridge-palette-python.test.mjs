/**
 * pytest 接线（跨平台；工具缺失 fail，不 skip）。
 */
import { describe } from 'vitest'

import { definePytestCase } from '../../lib/__tests__/py-runner.mjs'

describe('桥构件色单源', () => {
  definePytestCase('探针读权威源 · PY 侧无第二份手抄', ['tools/diag/test_bridge_palette.py'])
})
