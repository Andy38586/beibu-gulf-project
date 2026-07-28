import * as facilitiesRepo from '../repositories/facilitiesRepository.js'
import { BusinessError, ErrorCode } from '../utils/BusinessError.js'

export async function getByType(req, res, next) {
  try {
    const data = await facilitiesRepo.findByType(req.params.type)
    if (!data) {
      throw new BusinessError(ErrorCode.NOT_FOUND, `未知的设施类型: ${req.params.type}`)
    }
    res.json(data)
  } catch (error) {
    if (!(error instanceof BusinessError)) {
      console.error('获取设施数据失败:', error)
    }
    next(error)
  }
}
export async function getXiaoqu(req, res, next) {
  try {
    const data = await facilitiesRepo.findXiaoqu()
    res.json(data)
  } catch (error) {
    if (!(error instanceof BusinessError)) {
      console.error('获取小区数据失败:', error)
    }
    next(error)
  }
}
