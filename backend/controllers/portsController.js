import { readStaticJson } from '../utils/readStaticJson.js'
import { BusinessError, ErrorCode } from '../utils/BusinessError.js'
import { logger } from '../utils/logger.js'
import { sendSuccess } from '../utils/response.js'

// 港口列表为公开只读数据，无需登录（静态 JSON 直读，repository 装饰层已删，见 P10）
export async function getAll(req, res, next) {
  try {
    const ports = await readStaticJson('ports.json')
    sendSuccess(res, ports)
  } catch (error) {
    if (!(error instanceof BusinessError)) {
      logger.error('获取港口列表失败:', error)
    }
    next(error)
  }
}
