import { beforeEach, describe, expect, it, vi } from 'vitest'

import { BusinessError } from '../src/common/errors/business-error'
import { SiteAnalysisController } from '../src/modules/site-analysis/controllers/site-analysis.controller'
import { SiteAnalysisRepository } from '../src/modules/site-analysis/repositories/site-analysis.repository'
import {
  SiteAnalysisResult,
  SiteAnalysisService,
} from '../src/modules/site-analysis/services/site-analysis.service'

// 移植 Express controllers/__tests__/siteAnalysisController.test.js 4 用例语义并扩展。
// 分层后职责：controller 只做请求形状校验（必填/权重/半径/weights），数据获取、
// 设施类型合法性校验与计算编排下沉 SiteAnalysisService.analyze。
// Express 版走 next(error)；Nest 版直接 throw BusinessError（由全局异常过滤器转 HTTP 状态），
// 故断言改为 rejects.toMatchObject({ bizCode: 400001 })。

const OK_RESULT = {
  error: null,
  coverage: { type: 'Polygon' },
  matchedXiaoqu: [],
  facilityPoi: {},
}

interface ControllerHarness {
  controller: SiteAnalysisController
  analyze: ReturnType<typeof vi.fn>
}

function makeController(runResult: unknown = OK_RESULT): ControllerHarness {
  const analyze = vi.fn().mockResolvedValue(runResult)
  const service = { analyze } as unknown as SiteAnalysisService
  return { controller: new SiteAnalysisController(service), analyze }
}

interface ServiceHarness {
  service: SiteAnalysisService
  runSiteAnalysis: ReturnType<typeof vi.fn>
  findByType: ReturnType<typeof vi.fn>
  findXiaoqu: ReturnType<typeof vi.fn>
}

function makeService(
  overrides: { availableTypes?: string[]; runResult?: SiteAnalysisResult } = {}
): ServiceHarness {
  const findByType = vi.fn().mockResolvedValue([])
  const findXiaoqu = vi.fn().mockResolvedValue([])
  const repository = {
    getAvailableTypes: () => overrides.availableTypes ?? ['hospital', 'school'],
    findByType,
    findXiaoqu,
  } as unknown as SiteAnalysisRepository
  // spatial 仅 runSiteAnalysis 内部使用，本套用例已 stub 该方法，传空桩即可
  const service = new SiteAnalysisService({} as never, repository)
  const runSiteAnalysis = vi
    .spyOn(service, 'runSiteAnalysis')
    .mockResolvedValue(overrides.runResult ?? OK_RESULT)
  return { service, runSiteAnalysis, findByType, findXiaoqu }
}

beforeEach(() => {
  vi.restoreAllMocks()
})

describe('SiteAnalysisController.analyze — 请求形状校验', () => {
  it('radius 为负 → 400（INVALID_PARAMS），不进入 service', async () => {
    const { controller, analyze } = makeController()
    await expect(
      controller.analyze({
        selectedKeys: ['hospital'],
        typeSettings: { hospital: { radius: '-5' as unknown as number } },
        weights: {},
      })
    ).rejects.toMatchObject({ bizCode: 400001 })
    expect(analyze).not.toHaveBeenCalled()
  })

  it('radius 非数字 → 400（INVALID_PARAMS）', async () => {
    const { controller, analyze } = makeController()
    await expect(
      controller.analyze({
        selectedKeys: ['hospital'],
        typeSettings: { hospital: { radius: 'abc' as unknown as number } },
        weights: {},
      })
    ).rejects.toMatchObject({ bizCode: 400001 })
    expect(analyze).not.toHaveBeenCalled()
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

  it('radius 合法 → 委托 service.analyze 并原样返回', async () => {
    const { controller, analyze } = makeController()
    const result = await controller.analyze({
      selectedKeys: ['hospital'],
      typeSettings: { hospital: { radius: '3' as unknown as number } },
      weights: {},
    })
    expect(analyze).toHaveBeenCalledTimes(1)
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

  it('importance 越界（1-5 外）→ 400，早于 service 调用', async () => {
    const { controller, analyze } = makeController()
    await expect(
      controller.analyze({
        selectedKeys: ['unknown_type'],
        typeSettings: { unknown_type: { importance: 9 } },
      })
    ).rejects.toMatchObject({ bizCode: 400001, message: expect.stringContaining('应在 1-5 之间') })
    // 校验顺序：形状校验先于业务编排，service 不会被触达
    expect(analyze).not.toHaveBeenCalled()
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

  it('service 返回 error → 转 422（ANALYSIS_FAILED），不用 200 携带错误体', async () => {
    const { controller } = makeController({
      error: '请至少选择一种设施类型',
      coverage: null,
      matchedXiaoqu: [],
      facilityPoi: {},
    })
    await expect(controller.analyze({ selectedKeys: [], typeSettings: {} })).rejects.toMatchObject({
      bizCode: 422001,
      status: 422,
    })
  })

  it('service 返回 empty 合法空结果 → 原样返回不抛错', async () => {
    const { controller } = makeController({
      error: null,
      empty: true,
      emptyReason: 'school 的覆盖范围与其他类型无重叠区域',
      coverage: null,
      matchedXiaoqu: [],
      facilityPoi: {},
    })
    const result = (await controller.analyze({
      selectedKeys: ['hospital'],
      typeSettings: { hospital: { defaultRadius: 3, importance: 3 } },
    })) as { empty: boolean }
    expect(result.empty).toBe(true)
  })
})

describe('SiteAnalysisService.analyze — 类型校验与数据获取编排', () => {
  it('未知设施类型 → 400（文案带可用类型清单），不触发数据拉取', async () => {
    const { service, findByType } = makeService({ availableTypes: ['hospital', 'school'] })
    await expect(
      service.analyze({ selectedKeys: ['airport'], typeSettings: {} })
    ).rejects.toMatchObject({
      bizCode: 400001,
      message: '未知设施类型: airport，可用类型: hospital, school',
    })
    expect(findByType).not.toHaveBeenCalled()
  })

  it('city 透传至 repository（非法值由 repository 回落默认城市，不 4xx）', async () => {
    const { service, findByType, findXiaoqu } = makeService()
    await service.analyze({
      selectedKeys: ['hospital'],
      typeSettings: { hospital: { defaultRadius: 3, importance: 3 } },
      city: 'bh',
    })
    expect(findByType).toHaveBeenCalledWith('hospital', 'bh')
    expect(findXiaoqu).toHaveBeenCalledWith('bh')
  })

  it('数据就绪后委托 runSiteAnalysis 并透传 weights/city 组装结果', async () => {
    const { service, runSiteAnalysis } = makeService()
    await service.analyze({
      selectedKeys: ['hospital'],
      typeSettings: { hospital: { defaultRadius: 3, importance: 3 } },
      weights: { hospital: 5 },
    })
    expect(runSiteAnalysis).toHaveBeenCalledWith(
      expect.objectContaining({
        selectedKeys: ['hospital'],
        weights: { hospital: 5 },
        facilityData: expect.objectContaining({ hospital: [] }),
        xiaoquData: [],
      })
    )
  })
})
