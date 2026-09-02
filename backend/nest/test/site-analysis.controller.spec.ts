import { beforeEach, describe, expect, it, vi } from 'vitest'

import { BusinessError } from '../src/common/errors/business-error'
import { SiteAnalysisController } from '../src/modules/site-analysis/controllers/site-analysis.controller'
import { SiteAnalysisRepository } from '../src/modules/site-analysis/repositories/site-analysis.repository'
import { SiteAnalysisService } from '../src/modules/site-analysis/services/site-analysis.service'

// 移植 Express controllers/__tests__/siteAnalysisController.test.js（B-4 / P0 半径校验）4 用例语义。
// Express 版走 next(error)；Nest 版直接 throw BusinessError（由全局异常过滤器转 HTTP 状态），
// 故断言改为 rejects.toMatchObject({ bizCode: 400001 })。
// 径向：controller 内 runSiteAnalysis 以 stub 注入（对齐 Express vi.mock 模式），
// 只验 controller 自身校验顺序与错误码，不牵连真实计算。

const OK_RESULT = {
  error: null,
  coverage: { type: 'Polygon' },
  matchedXiaoqu: [],
  facilityPoi: {},
}

function makeController(overrides: { availableTypes?: string[]; runResult?: unknown } = {}): {
  controller: SiteAnalysisController
  runSiteAnalysis: ReturnType<typeof vi.fn>
  findByType: ReturnType<typeof vi.fn>
  findXiaoqu: ReturnType<typeof vi.fn>
} {
  const runSiteAnalysis = vi.fn().mockReturnValue(overrides.runResult ?? OK_RESULT)
  const findByType = vi.fn().mockResolvedValue([])
  const findXiaoqu = vi.fn().mockResolvedValue([])
  const repository = {
    getAvailableTypes: () => overrides.availableTypes ?? ['hospital', 'school'],
    findByType,
    findXiaoqu,
  } as unknown as SiteAnalysisRepository
  const service = { runSiteAnalysis } as unknown as SiteAnalysisService
  return {
    controller: new SiteAnalysisController(repository, service),
    runSiteAnalysis,
    findByType,
    findXiaoqu,
  }
}

beforeEach(() => {
  vi.restoreAllMocks()
})

describe('SiteAnalysisController.analyze — 参数校验（B-4）', () => {
  it('radius 为负 → 400（INVALID_PARAMS），不进入 runSiteAnalysis', async () => {
    const { controller, runSiteAnalysis } = makeController()
    await expect(
      controller.analyze({
        selectedKeys: ['hospital'],
        typeSettings: { hospital: { radius: '-5' as unknown as number } },
        weights: {},
      })
    ).rejects.toMatchObject({ bizCode: 400001 })
    expect(runSiteAnalysis).not.toHaveBeenCalled()
  })

  it('radius 非数字 → 400（INVALID_PARAMS）', async () => {
    const { controller, runSiteAnalysis } = makeController()
    await expect(
      controller.analyze({
        selectedKeys: ['hospital'],
        typeSettings: { hospital: { radius: 'abc' as unknown as number } },
        weights: {},
      })
    ).rejects.toMatchObject({ bizCode: 400001 })
    expect(runSiteAnalysis).not.toHaveBeenCalled()
  })

  it('非法权重（0~10 外）→ 400', async () => {
    const { controller } = makeController()
    await expect(
      controller.analyze({
        selectedKeys: ['hospital'],
        typeSettings: { hospital: { radius: '3' as unknown as number } },
        weights: { hospital: 99 },
      })
    ).rejects.toMatchObject({ bizCode: 400001 })
  })

  it('radius 合法 → 进入 runSiteAnalysis 并原样返回', async () => {
    const { controller, runSiteAnalysis } = makeController()
    const result = await controller.analyze({
      selectedKeys: ['hospital'],
      typeSettings: { hospital: { radius: '3' as unknown as number } },
      weights: {},
    })
    expect(runSiteAnalysis).toHaveBeenCalledTimes(1)
    expect(result).toMatchObject({ error: null })
  })

  it('缺 selectedKeys 或 typeSettings → 400（缺少必要参数）', async () => {
    const a = makeController()
    await expect(a.controller.analyze({ typeSettings: {} })).rejects.toThrow(BusinessError)
    await expect(a.controller.analyze({ typeSettings: {} })).rejects.toMatchObject({
      bizCode: 400001,
      message: '缺少必要参数: selectedKeys, typeSettings',
    })

    const b = makeController()
    await expect(b.controller.analyze({ selectedKeys: ['hospital'] })).rejects.toMatchObject({
      bizCode: 400001,
    })

    const c = makeController()
    await expect(c.controller.analyze(undefined)).rejects.toMatchObject({ bizCode: 400001 })
  })

  it('importance 越界（1-5 外）→ 400，早于设施类型校验', async () => {
    const { controller, findByType } = makeController()
    await expect(
      controller.analyze({
        selectedKeys: ['unknown_type'],
        typeSettings: { unknown_type: { importance: 9 } },
      })
    ).rejects.toMatchObject({ bizCode: 400001, message: expect.stringContaining('应在 1-5 之间') })
    // 校验顺序：importance 先于未知类型检查，故不会走到 repository
    expect(findByType).not.toHaveBeenCalled()
  })

  it('未知设施类型 → 400（文案带可用类型清单）', async () => {
    const { controller } = makeController({ availableTypes: ['hospital', 'school'] })
    await expect(
      controller.analyze({ selectedKeys: ['airport'], typeSettings: {} })
    ).rejects.toMatchObject({
      bizCode: 400001,
      message: '未知设施类型: airport，可用类型: hospital, school',
    })
  })

  it('weights 非对象 / 数组 / null → 400（weights 应为对象）', async () => {
    const { controller } = makeController()
    await expect(
      controller.analyze({
        selectedKeys: ['hospital'],
        typeSettings: { hospital: { defaultRadius: 3, importance: 3 } },
        weights: [1, 2],
      })
    ).rejects.toMatchObject({ bizCode: 400001, message: 'weights 应为对象' })
  })

  it('city 透传至 repository（非法值由 repository 回落默认城市，controller 不 4xx）', async () => {
    const { controller, findByType, findXiaoqu } = makeController()
    await controller.analyze({
      selectedKeys: ['hospital'],
      typeSettings: { hospital: { defaultRadius: 3, importance: 3 } },
      city: 'bh',
    })
    expect(findByType).toHaveBeenCalledWith('hospital', 'bh')
    expect(findXiaoqu).toHaveBeenCalledWith('bh')
  })

  it('service 返回 error → 转 422（ANALYSIS_FAILED），不用 200 携带错误体', async () => {
    const { controller } = makeController({
      runResult: {
        error: '请至少选择一种设施类型',
        coverage: null,
        matchedXiaoqu: [],
        facilityPoi: {},
      },
    })
    await expect(controller.analyze({ selectedKeys: [], typeSettings: {} })).rejects.toMatchObject({
      bizCode: 422001,
      status: 422,
    })
  })

  it('service 返回 empty 合法空结果 → 原样返回不抛错（8-1）', async () => {
    const { controller } = makeController({
      runResult: {
        error: null,
        empty: true,
        emptyReason: 'school 的覆盖范围与其他类型无重叠区域',
        coverage: null,
        matchedXiaoqu: [],
        facilityPoi: {},
      },
    })
    const result = (await controller.analyze({
      selectedKeys: ['hospital'],
      typeSettings: { hospital: { defaultRadius: 3, importance: 3 } },
    })) as { empty: boolean }
    expect(result.empty).toBe(true)
  })
})
