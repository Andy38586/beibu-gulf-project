import { runSiteAnalysis } from '../services/siteAnalysisService.js'
import * as facilitiesRepo from '../repositories/facilitiesRepository.js'

export async function analyze(req, res) {
  try {
    const { selectedKeys, typeSettings, weights } = req.body

    if (!selectedKeys || !typeSettings) {
      return res.status(400).json({ error: '缺少必要参数: selectedKeys, typeSettings' })
    }
    
    // FIX:103/104: 校验权重范围（1-5）
    if (typeSettings) {
      for (const [key, setting] of Object.entries(typeSettings)) {
        if (setting.importance !== undefined) {
          const importance = Number(setting.importance)
          if (isNaN(importance) || importance < 1 || importance > 5) {
            return res.status(400).json({ 
              error: `设施类型 ${key} 的权重值无效，应在 1-5 之间` 
            })
          }
        }
      }
    }
    
    const facilityData = {}
    const validTypes = facilitiesRepo.getAvailableTypes()
    for (const key of selectedKeys) {
      if (!validTypes.includes(key)) {
        return res.status(400).json({ error: `未知设施类型: ${key}，可用类型: ${validTypes.join(', ')}` })
      }
      facilityData[key] = await facilitiesRepo.findByType(key)
    }

    // FIX:P1-08: 半径校验（typeSettings 各项 radius 若提供必须为正数）
    for (const [key, setting] of Object.entries(typeSettings)) {
      if (setting.radius !== undefined) {
        const radius = Number(setting.radius)
        if (isNaN(radius) || radius <= 0) {
          return res.status(400).json({ error: `设施类型 ${key} 的半径无效，应为正数` })
        }
      }
    }

    // FIX:P2-08: 权重校验（若提供，逐项为 0~10 的有限数）
    if (weights !== undefined) {
      if (typeof weights !== 'object' || weights === null || Array.isArray(weights)) {
        return res.status(400).json({ error: 'weights 应为对象' })
      }
      for (const [key, w] of Object.entries(weights)) {
        const weight = Number(w)
        if (isNaN(weight) || !isFinite(weight) || weight < 0 || weight > 10) {
          return res.status(400).json({ error: `权重 ${key} 无效，应为 0-10 之间的数字` })
        }
      }
    }

    const xiaoquData = await facilitiesRepo.findXiaoqu()

    const result = runSiteAnalysis({
      selectedKeys,
      typeSettings,
      facilityData,
      xiaoquData,
      weights,
    })
    // FIX:P1-09: 业务失败以 422 返回，不再用 200 携带错误体
    if (result && result.error) {
      return res.status(422).json({ error: result.error })
    }
    res.json(result)
  } catch (error) {
    // FIX:P1-08: 参数错误返回 400
    if (error.code === 'INVALID_PARAMS') {
      return res.status(400).json({ error: error.message })
    }
    console.error('选址分析失败:', error)
    res.status(500).json({ error: '选址分析计算失败' })
  }
}
