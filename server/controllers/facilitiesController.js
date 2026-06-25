import * as facilitiesRepo from '../repositories/facilitiesRepository.js'

export async function getByType(req, res) {
  try {
    const data = await facilitiesRepo.findByType(req.params.type)
    if (!data) {
      return res.status(404).json({ error: `未知的设施类型: ${req.params.type}` })
    }
    res.json(data)
  } catch (error) {
    console.error('获取设施数据失败:', error)
    res.status(500).json({ error: '获取设施数据失败' })
  }
}
export async function getXiaoqu(req, res) {
  try {
    const data = await facilitiesRepo.findXiaoqu()
    res.json(data)
  } catch (error) {
    console.error('获取小区数据失败:', error)
    res.status(500).json({ error: '获取小区数据失败' })
  }
}
