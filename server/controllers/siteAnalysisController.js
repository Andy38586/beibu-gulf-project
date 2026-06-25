import { runSiteAnalysis } from '../services/siteAnalysisService.js'
import * as facilitiesRepo from '../repositories/facilitiesRepository.js'

export async function analyze(req, res) {
  try {
    const { selectedKeys, typeSettings, weights } = req.body

    if (!selectedKeys || !typeSettings) {
      return res.status(400).json({ error: '缺少必要参数: selectedKeys, typeSettings' })
    }
    const facilityData = {}
    for (const key of selectedKeys) {
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
