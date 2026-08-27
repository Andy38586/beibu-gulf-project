// @vitest-environment node
/**
 * siteAnalysisController.analyze 回归测试（B-4 / P0 半径校验）
 * 背景：siteAnalysisController.js:43 校验 typeSettings 各项 radius（若提供必须为正数），
 * 非法 radius（NaN / <=0）应返回 400（INVALID_PARAMS），不进入 runSiteAnalysis。
 * 本测试锁定（审计编号：B-4）：
 * - radius 为负 / 非数字 → 400，且不调用 runSiteAnalysis
 * - radius 合法 → 进入 runSiteAnalysis 并正常返回
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { BusinessError, ErrorCode } from '../../utils/BusinessError.js'

vi.mock('../../repositories/facilitiesRepository.js', () => ({
  getAvailableTypes: vi.fn(),
  findByType: vi.fn(),
  findXiaoqu: vi.fn(),
}))

vi.mock('../../services/siteAnalysisService.js', () => ({
  runSiteAnalysis: vi.fn(),
}))

import {
  findByType,
  findXiaoqu,
  getAvailableTypes,
} from '../../repositories/facilitiesRepository.js'
import { runSiteAnalysis } from '../../services/siteAnalysisService.js'
import { analyze } from '../siteAnalysisController.js'

function createRes() {
  return { json: vi.fn(), status: vi.fn().mockReturnThis() }
}
function createNext() {
  return vi.fn()
}

beforeEach(() => {
  vi.clearAllMocks()
  getAvailableTypes.mockReturnValue(['hospital', 'school'])
  findByType.mockResolvedValue([])
  findXiaoqu.mockResolvedValue([])
})

describe('siteAnalysisController.analyze — radius 校验（B-4）', () => {
  it('radius 为负 → 400（INVALID_PARAMS），不进入 runSiteAnalysis', async () => {
    const req = {
      body: {
        selectedKeys: ['hospital'],
        typeSettings: { hospital: { radius: '-5' } },
        weights: {},
      },
    }
    const res = createRes()
    const next = createNext()
    await analyze(req, res, next)
    expect(next).toHaveBeenCalledTimes(1)
    const err = next.mock.calls[0][0]
    expect(err).toBeInstanceOf(BusinessError)
    expect(err.code).toBe(ErrorCode.INVALID_PARAMS.code)
    expect(runSiteAnalysis).not.toHaveBeenCalled()
  })

  it('radius 非数字 → 400（INVALID_PARAMS）', async () => {
    const req = {
      body: {
        selectedKeys: ['hospital'],
        typeSettings: { hospital: { radius: 'abc' } },
        weights: {},
      },
    }
    const res = createRes()
    const next = createNext()
    await analyze(req, res, next)
    expect(next).toHaveBeenCalledTimes(1)
    const err = next.mock.calls[0][0]
    expect(err).toBeInstanceOf(BusinessError)
    expect(err.code).toBe(ErrorCode.INVALID_PARAMS.code)
    expect(runSiteAnalysis).not.toHaveBeenCalled()
  })

  it('非法权重（0~10 外）→ 400', async () => {
    const req = {
      body: {
        selectedKeys: ['hospital'],
        typeSettings: { hospital: { radius: '3' } },
        weights: { hospital: 99 },
      },
    }
    const res = createRes()
    const next = createNext()
    await analyze(req, res, next)
    expect(next).toHaveBeenCalledTimes(1)
    const err = next.mock.calls[0][0]
    expect(err).toBeInstanceOf(BusinessError)
    expect(err.code).toBe(ErrorCode.INVALID_PARAMS.code)
  })

  it('radius 合法 → 进入 runSiteAnalysis 并正常返回 200', async () => {
    runSiteAnalysis.mockReturnValue({
      error: null,
      coverage: { type: 'Polygon' },
      matchedXiaoqu: [],
      facilityPoi: {},
    })
    const req = {
      body: {
        selectedKeys: ['hospital'],
        typeSettings: { hospital: { radius: '3' } },
        weights: {},
      },
    }
    const res = createRes()
    const next = createNext()
    await analyze(req, res, next)
    expect(runSiteAnalysis).toHaveBeenCalledTimes(1)
    expect(next).not.toHaveBeenCalled()
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ code: 200 }))
  })
})
