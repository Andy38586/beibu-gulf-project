import { readPorts } from '../repositories/portsRepository.js'
import { BusinessError, ErrorCode } from '../utils/BusinessError.js'
import { logger } from '../utils/logger.js'
import { sendSuccess } from '../utils/response.js'

// 港口为公开只读数据，无需登录（静态 JSON 直读，无需 repository 装饰层）
export async function getAll(req, res, next) {
  try {
    const ports = await readPorts()
    sendSuccess(res, ports)
  } catch (error) {
    if (!(error instanceof BusinessError)) {
      logger.error('获取港口列表失败:', error)
    }
    next(error)
  }
}
