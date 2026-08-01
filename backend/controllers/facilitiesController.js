import * as facilitiesRepo from '../repositories/facilitiesRepository.js'
import { BusinessError, ErrorCode } from '../utils/BusinessError.js'
import { logger } from '../utils/logger.js'
import { sendSuccess } from '../utils/response.js'

export async function getByType(req, res, next) {
  try {
    const data = await facilitiesRepo.findByType(req.params.type)
    if (!data) {
      throw new BusinessError(ErrorCode.NOT_FOUND, `未知的设施类型: ${req.params.type}`)
    }
    sendSuccess(res, data)
  } catch (error) {
    if (!(error instanceof BusinessError)) {
      logger.error('获取设施数据失败:', error)
    }
    next(error)
  }
}
export async function getXiaoqu(req, res, next) {
  try {
    const data = await facilitiesRepo.findXiaoqu()
    sendSuccess(res, data)
  } catch (error) {
    if (!(error instanceof BusinessError)) {
      logger.error('获取小区数据失败:', error)
    }
    next(error)
  }
}
