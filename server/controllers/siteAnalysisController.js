import { runSiteAnalysis } from '../services/siteAnalysisService.js'
import * as facilitiesRepo from '../repositories/facilitiesRepository.js'

export async function analyze(req, res) {
  try {
    const { selectedKeys, typeSettings, weights } = req.body

    if (!selectedKeys || !typeSettings) {
      return res.status(400).json({ error: '缺少必要参数: selectedKeys, typeSettings' })
    }
    
    // AUDIT-103/104: 校验权重范围（1-5）
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
    const xiaoquData = await facilitiesRepo.findXiaoqu()

    const result = runSiteAnalysis({
      selectedKeys,
      typeSettings,
      facilityData,
      xiaoquData,
      weights,
    })
    res.json(result)
  } catch (error) {
    console.error('选址分析失败:', error)
    res.status(500).json({ error: '选址分析计算失败' })
  }
}
